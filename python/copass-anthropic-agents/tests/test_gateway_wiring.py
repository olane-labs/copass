"""ADR 0029 — gateway-MCP wiring on ``ManagedAgentBackendV2``.

When the backend is constructed (or invoked) with the gateway flag on,
``agents.create`` MUST advertise the unified MCP gateway server in
``mcp_servers`` and prepend an ``mcp_toolset`` tool entry (server name
matching). When the flag is off, the legacy custom-tool path must be
preserved exactly — no ``mcp_servers``, no ``mcp_toolset``. The
per-invocation override via ``context.handles[USE_GATEWAY_MCP_HANDLE]``
takes precedence over the constructor flag so the runtime can flip the
path per-request without re-instantiating the singleton.

Per ADR 0001 §7 the tests target :class:`ManagedAgentBackendV2`. The
gateway-wiring contract carries over from v1 unchanged — v2 inherits
ADR 0029's surface — so the assertions are identical except for the
backend type and the new mandatory ``registry`` kwarg.
"""

from __future__ import annotations

import pytest

from copass_anthropic_agents import (
    AgentTool,
    AgentToolRegistry,
    ToolSpec,
)
from copass_anthropic_agents.backends.in_memory_provider_binding_registry import (
    InMemoryProviderBindingRegistry,
)
from copass_anthropic_agents.backends.managed_agent_backend_v2 import (
    DEFAULT_GATEWAY_MCP_NAME,
    DEFAULT_GATEWAY_MCP_URL,
    ManagedAgentBackendV2,
)


class _DummyTool(AgentTool):
    def __init__(self, name: str) -> None:
        self._name = name

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name=self._name,
            description=self._name,
            input_schema={"type": "object", "properties": {}},
        )

    async def invoke(self, arguments, *, context=None):
        return {}


def _make_backend(**kwargs) -> ManagedAgentBackendV2:
    return ManagedAgentBackendV2(
        api_key="sk-fake-test",
        registry=InMemoryProviderBindingRegistry(),
        **kwargs,
    )


# --- _specs_to_tools: flag gates the mcp_toolset entry ---------------------


def test_specs_to_tools_flag_off_emits_no_mcp_toolset() -> None:
    """Legacy path must remain byte-identical: only ``custom`` tool
    entries, no ``mcp_toolset``. Stage 1 of the cutover lands the flag
    OFF in every env; this is the regression guard."""
    backend = _make_backend(use_gateway_mcp=False)
    specs = [ToolSpec(name="a", description="tool a", input_schema={"type": "object"})]
    tools = backend._specs_to_tools(specs)
    assert all(t["type"] == "custom" for t in tools)
    assert not any(t.get("type") == "mcp_toolset" for t in tools)


def test_specs_to_tools_flag_on_prepends_mcp_toolset() -> None:
    """Gateway path prepends a single ``mcp_toolset`` entry pointing
    at the gateway server by name. ``permission_policy: always_allow``
    is the accepted trade-off — gateway enforcement is the real
    boundary (ADR 0029 §Accepted Trade-Offs §3).

    Per ``BetaManagedAgentsMCPToolsetParams``, ``permission_policy``
    lives under ``default_config`` (not at the top level), and is
    itself a typed dict ``{"type": "always_allow"}``. A flat
    ``"permission_policy": "always_allow"`` at the top level is
    rejected by the API as
    ``tools.0.permission_policy: Extra inputs are not permitted``."""
    backend = _make_backend(use_gateway_mcp=True)
    specs = [ToolSpec(name="a", description="tool a", input_schema={"type": "object"})]
    tools = backend._specs_to_tools(specs)
    # mcp_toolset comes FIRST so Anthropic resolves it ahead of custom
    # tools — matters when both surface tools with the same name.
    assert tools[0]["type"] == "mcp_toolset"
    assert tools[0]["mcp_server_name"] == DEFAULT_GATEWAY_MCP_NAME
    # No flat ``permission_policy`` at the top level — that shape is
    # what the API rejected in the 1.2.0 prod run.
    assert "permission_policy" not in tools[0]
    assert tools[0]["default_config"] == {
        "permission_policy": {"type": "always_allow"},
    }
    # Custom tools still come through behind the toolset.
    assert any(t["type"] == "custom" and t["name"] == "a" for t in tools)


def test_specs_to_tools_per_invocation_override_on_top_of_constructor_off() -> None:
    """Per-invocation gateway-on must work even when the constructor
    flag is off — that's how the runtime experiments per-run without
    re-creating the backend singleton."""
    backend = _make_backend(use_gateway_mcp=False)
    specs = [ToolSpec(name="a", description="tool a", input_schema={"type": "object"})]
    tools = backend._specs_to_tools(specs, use_gateway_mcp=True)
    assert tools[0]["type"] == "mcp_toolset"


# --- _provision_anthropic_agent: flag gates the mcp_servers kwarg ----------
#
# v1's ``_ensure_agent_id`` is split in v2: the cache-or-mint plumbing moves
# into :class:`ProviderBindingRegistry`, and the actual ``agents.create`` /
# ``environments.create`` calls live in ``_provision_anthropic_agent`` (the
# closure the registry invokes exactly once across racing callers). The
# gateway-wiring contract — flag-off → no ``mcp_servers``, flag-on →
# single gateway server + matching ``mcp_toolset`` — is unchanged in v2.


@pytest.mark.asyncio
async def test_provision_anthropic_agent_flag_off_does_not_send_mcp_servers() -> None:
    """Legacy ``agents.create`` payload must not include ``mcp_servers`` —
    adding it would change Anthropic's billing / routing posture for
    every existing deployment running flag-off."""
    agent_captured: list[dict] = []
    env_captured: list[dict] = []

    class _FakeAgents:
        async def create(self, **kwargs):
            agent_captured.append(kwargs)

            class _A:
                id = "agnt_off_1"

            return _A()

    class _FakeEnvironments:
        async def create(self, **kwargs):
            env_captured.append(kwargs)

            class _E:
                id = "env_off_1"

            return _E()

    class _FakeBeta:
        def __init__(self) -> None:
            self.agents = _FakeAgents()
            self.environments = _FakeEnvironments()

    class _Client:
        def __init__(self) -> None:
            self.beta = _FakeBeta()

    backend = _make_backend(use_gateway_mcp=False)
    backend._client = _Client()
    reg = AgentToolRegistry()
    reg.add(_DummyTool("alpha"))

    class _Agent:
        model = "claude-test"
        system_prompt = "sp"
        identity = "id1"

    binding = await backend._provision_anthropic_agent(
        agent=_Agent(),
        effective_tools=reg,
        use_gateway_mcp=False,
        fingerprint="fp-test",
        for_version=1,
    )
    assert binding.agent_id == "agnt_off_1"
    assert binding.environment_id == "env_off_1"
    assert len(agent_captured) == 1
    assert "mcp_servers" not in agent_captured[0]


@pytest.mark.asyncio
async def test_provision_anthropic_agent_flag_on_sends_gateway_mcp_servers() -> None:
    """Gateway path must register the single ``mcp.copass.com`` server
    with name matching the ``mcp_toolset`` entry. One server, one
    tool shim — see ADR 0029 §Stage 1 invariants."""
    agent_captured: list[dict] = []

    class _FakeAgents:
        async def create(self, **kwargs):
            agent_captured.append(kwargs)

            class _A:
                id = "agnt_on_1"

            return _A()

    class _FakeEnvironments:
        async def create(self, **kwargs):
            class _E:
                id = "env_on_1"

            return _E()

    class _FakeBeta:
        def __init__(self) -> None:
            self.agents = _FakeAgents()
            self.environments = _FakeEnvironments()

    class _Client:
        def __init__(self) -> None:
            self.beta = _FakeBeta()

    backend = _make_backend(use_gateway_mcp=True)
    backend._client = _Client()
    reg = AgentToolRegistry()
    reg.add(_DummyTool("alpha"))

    class _Agent:
        model = "claude-test"
        system_prompt = "sp"
        identity = "id1"

    binding = await backend._provision_anthropic_agent(
        agent=_Agent(),
        effective_tools=reg,
        use_gateway_mcp=True,
        fingerprint="fp-test",
        for_version=1,
    )
    assert binding.agent_id == "agnt_on_1"
    assert len(agent_captured) == 1
    create_kwargs = agent_captured[0]
    assert "mcp_servers" in create_kwargs
    servers = list(create_kwargs["mcp_servers"])
    assert len(servers) == 1
    assert servers[0]["name"] == DEFAULT_GATEWAY_MCP_NAME
    assert servers[0]["type"] == "url"
    assert servers[0]["url"] == DEFAULT_GATEWAY_MCP_URL
    # And the mcp_toolset tool entry must reference the same name.
    tools = list(create_kwargs["tools"])
    toolset_entries = [t for t in tools if t.get("type") == "mcp_toolset"]
    assert len(toolset_entries) == 1
    assert toolset_entries[0]["mcp_server_name"] == DEFAULT_GATEWAY_MCP_NAME


# --- Fingerprint includes the gateway settings -----------------------------


def test_fingerprint_differs_when_gateway_flag_flips() -> None:
    """Cache poisoning guard: ``_ensure_agent_id`` keys its cache on
    the fingerprint, so flipping the gateway flag MUST yield a
    different fingerprint — otherwise a flag-on caller would receive
    the flag-off agent id and the gateway wiring would be silently
    skipped."""
    backend_off = _make_backend(use_gateway_mcp=False)
    backend_on = _make_backend(use_gateway_mcp=True)
    reg = AgentToolRegistry()
    reg.add(_DummyTool("alpha"))

    class _Agent:
        model = "m"
        system_prompt = "sp"
        identity = "id"

    fp_off = backend_off._fingerprint_agent(_Agent(), reg)
    fp_on = backend_on._fingerprint_agent(_Agent(), reg)
    assert fp_off != fp_on


def test_fingerprint_per_invocation_override_changes_fingerprint() -> None:
    backend = _make_backend(use_gateway_mcp=False)
    reg = AgentToolRegistry()
    reg.add(_DummyTool("alpha"))

    class _Agent:
        model = "m"
        system_prompt = "sp"
        identity = "id"

    fp_default = backend._fingerprint_agent(_Agent(), reg)
    fp_override = backend._fingerprint_agent(
        _Agent(), reg, use_gateway_mcp=True,
    )
    assert fp_default != fp_override
