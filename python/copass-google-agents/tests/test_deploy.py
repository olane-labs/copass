"""Unit tests for ``deploy_adk_agent``.

Live deploys are out of scope — these tests drive the helper against
a fake ``vertexai.Client`` to verify we assemble the right
``create(agent=..., config=...)`` payload and surface arg validation
before the network call.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, List

import httpx
import pytest
import respx

from copass_google_agents._proxy_tool import (
    DEFAULT_DISPATCH_PATH,
    copass_dispatch,
)
from copass_google_agents.deploy import (
    DEFAULT_MCP_PROXY_REQUIREMENTS,
    DEFAULT_REQUIREMENTS,
    deploy_adk_agent,
    deploy_adk_agent_with_mcp_proxy,
)


@dataclass
class _FakeAgentEngines:
    created: List[dict] = field(default_factory=list)

    def create(self, *, agent: Any, config: dict) -> Any:
        self.created.append({"agent": agent, "config": dict(config)})
        return object()  # opaque handle


@dataclass
class _FakeVertexClient:
    agent_engines: _FakeAgentEngines = field(default_factory=_FakeAgentEngines)


# ──────────────────────────────────────────────────────────────────────
# Argument validation
# ──────────────────────────────────────────────────────────────────────


def _base_kwargs(**overrides: Any) -> dict:
    kw = {
        "display_name": "support-agent",
        "project": "my-proj",
        "system_prompt": "You are helpful.",
        "copass_api_url": "https://api.copass.id",
        "staging_bucket": "gs://my-bucket",
        "vertex_client": _FakeVertexClient(),
    }
    kw.update(overrides)
    return kw


@pytest.mark.parametrize(
    "missing",
    [
        "display_name",
        "project",
        "system_prompt",
        "copass_api_url",
    ],
)
def test_rejects_missing_required_arg(missing: str) -> None:
    kwargs = _base_kwargs(**{missing: ""})
    with pytest.raises(ValueError, match=missing):
        deploy_adk_agent(**kwargs)


def test_rejects_non_gcs_staging_bucket() -> None:
    kwargs = _base_kwargs(staging_bucket="my-bucket")
    with pytest.raises(ValueError, match="gs://"):
        deploy_adk_agent(**kwargs)


def test_rejects_missing_staging_bucket() -> None:
    kwargs = _base_kwargs(staging_bucket="")
    with pytest.raises(ValueError, match="staging_bucket"):
        deploy_adk_agent(**kwargs)


def test_deploy_adk_agent_no_longer_accepts_copass_api_key() -> None:
    """The 1.0 breaking change: passing the deprecated kwarg raises.

    Python's strict-kwargs check on ``def f(*, ...)`` rejects unknown
    keyword arguments with ``TypeError``. This test pins the breaking
    change so callers get a clear migration signal at import time
    rather than a silent no-op.
    """
    with pytest.raises(TypeError):
        deploy_adk_agent(  # type: ignore[call-arg]
            **_base_kwargs(copass_api_key="olk_test")
        )


def test_deploy_adk_agent_with_mcp_proxy_no_longer_accepts_copass_api_key() -> None:
    """The 1.0 breaking change for the MCP-proxy variant."""
    with pytest.raises(TypeError):
        deploy_adk_agent_with_mcp_proxy(  # type: ignore[call-arg]
            display_name="support-agent",
            project="my-proj",
            system_prompt="You are helpful.",
            copass_mcp_url="https://mcp.copass.com/mcp",
            copass_api_key="olk_test",  # type: ignore[arg-type]
            staging_bucket="gs://my-bucket",
            vertex_client=_FakeVertexClient(),
        )


# ──────────────────────────────────────────────────────────────────────
# create() payload shape
# ──────────────────────────────────────────────────────────────────────


def test_create_payload_bakes_env_vars_and_requirements() -> None:
    fake_client = _FakeVertexClient()
    deploy_adk_agent(**_base_kwargs(vertex_client=fake_client))

    assert len(fake_client.agent_engines.created) == 1
    call = fake_client.agent_engines.created[0]
    config = call["config"]
    assert config["display_name"] == "support-agent"
    assert config["staging_bucket"] == "gs://my-bucket"
    assert config["requirements"] == DEFAULT_REQUIREMENTS
    assert config["agent_framework"] == "google-adk"
    # COPASS_API_KEY is no longer baked in — only COPASS_API_URL.
    assert config["env_vars"] == {
        "COPASS_API_URL": "https://api.copass.id",
    }


def test_create_payload_custom_requirements_override_default() -> None:
    fake_client = _FakeVertexClient()
    deploy_adk_agent(
        **_base_kwargs(
            vertex_client=fake_client,
            requirements=["my-custom-pkg==1.2.3"],
        )
    )
    config = fake_client.agent_engines.created[0]["config"]
    assert config["requirements"] == ["my-custom-pkg==1.2.3"]


def test_create_payload_custom_dispatch_path_included() -> None:
    fake_client = _FakeVertexClient()
    deploy_adk_agent(
        **_base_kwargs(
            vertex_client=fake_client,
            dispatch_path="/api/v2/dispatch",
        )
    )
    env = fake_client.agent_engines.created[0]["config"]["env_vars"]
    assert env["COPASS_DISPATCH_PATH"] == "/api/v2/dispatch"


def _unwrap_agent(adk_app):
    """Reach the inner ``google.adk.Agent`` through the ``AdkApp`` wrapper.

    ``deploy_adk_agent`` wraps the raw Agent in ``vertexai.agent_engines
    .AdkApp`` before handing it to ``agent_engines.create``. Different
    SDK versions expose the inner agent under ``.agent`` or ``._agent``;
    probe both to stay forward-compatible.
    """
    raw = getattr(adk_app, "agent", None)
    if raw is None:
        raw = getattr(adk_app, "_agent", None)
    if raw is None:
        # Current vertexai build stashes the Agent in a private
        # ``_tmpl_attrs`` dict under the ``agent`` key. Use this as a
        # last resort so tests don't lock us to one SDK minor version.
        tmpl = getattr(adk_app, "_tmpl_attrs", None)
        if isinstance(tmpl, dict):
            raw = tmpl.get("agent")
    assert raw is not None, (
        "expected AdkApp to expose the wrapped Agent via .agent, ._agent, "
        "or ._tmpl_attrs['agent']"
    )
    return raw


def test_created_agent_has_copass_dispatch_tool() -> None:
    fake_client = _FakeVertexClient()
    deploy_adk_agent(**_base_kwargs(vertex_client=fake_client))
    adk_app = fake_client.agent_engines.created[0]["agent"]
    agent = _unwrap_agent(adk_app)
    # ADK Agent stores tools under .tools — verify copass_dispatch is
    # bound. The function object identity is preserved because we
    # pass it by reference from the proxy module.
    assert any(t is copass_dispatch for t in agent.tools)


def test_extra_tools_appended_after_dispatch_proxy() -> None:
    fake_client = _FakeVertexClient()

    def my_extra_tool(x: str) -> dict:
        """Example extra tool."""
        return {"x": x}

    deploy_adk_agent(
        **_base_kwargs(
            vertex_client=fake_client,
            extra_tools=[my_extra_tool],
        )
    )
    adk_app = fake_client.agent_engines.created[0]["agent"]
    agent = _unwrap_agent(adk_app)
    assert agent.tools[0] is copass_dispatch
    assert any(t is my_extra_tool for t in agent.tools[1:])


# ──────────────────────────────────────────────────────────────────────
# Proxy-tool module constants sanity
# ──────────────────────────────────────────────────────────────────────


def test_default_dispatch_path() -> None:
    assert DEFAULT_DISPATCH_PATH == "/api/v1/agents/dispatch"


def test_default_mcp_proxy_requirements_pin_versions() -> None:
    """Pin the upgraded floor versions so an accidental downgrade fails CI."""
    assert "google-cloud-aiplatform[agent_engines,adk]==1.149.0" in DEFAULT_MCP_PROXY_REQUIREMENTS
    assert "google-adk==1.32.0" in DEFAULT_MCP_PROXY_REQUIREMENTS


# ──────────────────────────────────────────────────────────────────────
# Proxy-tool — API key flows from session state, not env vars
# ──────────────────────────────────────────────────────────────────────


@dataclass
class _FakeToolContext:
    """Minimal stand-in for ADK's ``ToolContext``.

    ADK exposes ``state`` as a ``MappingProxyType`` view — match that
    so the tool's ``hasattr(state, 'get')`` probe behaves the same as
    in production.
    """
    state: Any
    user_id: str = "user-abc"
    session_id: str = "session-xyz"


@respx.mock
async def test_proxy_tool_reads_api_key_from_tool_context_state(monkeypatch) -> None:
    """The 1.0 contract: copass_dispatch reads the API key from
    ``tool_context.state['copass_api_key']`` and includes it as a
    Bearer header on the outgoing POST."""
    monkeypatch.setenv("COPASS_API_URL", "https://api.copass.id")
    monkeypatch.delenv("COPASS_API_KEY", raising=False)

    route = respx.post(
        "https://api.copass.id/api/v1/agents/dispatch"
    ).mock(return_value=httpx.Response(200, json={"ok": True}))

    ctx = _FakeToolContext(
        state=MappingProxyType({"copass_api_key": "olk_test"}),
    )
    result = await copass_dispatch(
        tool_name="any.tool",
        arguments={"foo": "bar"},
        tool_context=ctx,
    )

    assert result == {"ok": True}
    assert route.called
    sent = route.calls.last.request
    assert sent.headers["authorization"] == "Bearer olk_test"
    assert sent.headers["content-type"] == "application/json"


async def test_proxy_tool_returns_error_when_state_missing_api_key(monkeypatch) -> None:
    """Without ``copass_api_key`` in session state, the tool must
    return the documented error dict (NOT raise) — the agent surface
    treats tool errors as recoverable per the ADK contract."""
    monkeypatch.setenv("COPASS_API_URL", "https://api.copass.id")
    monkeypatch.delenv("COPASS_API_KEY", raising=False)

    ctx = _FakeToolContext(state=MappingProxyType({}))
    result = await copass_dispatch(
        tool_name="any.tool",
        arguments={},
        tool_context=ctx,
    )

    assert "error" in result
    assert "copass_api_key" in result["error"]


async def test_proxy_tool_returns_error_when_api_url_missing(monkeypatch) -> None:
    """COPASS_API_URL stays env-var sourced; missing it yields an error."""
    monkeypatch.delenv("COPASS_API_URL", raising=False)

    ctx = _FakeToolContext(
        state=MappingProxyType({"copass_api_key": "olk_test"}),
    )
    result = await copass_dispatch(
        tool_name="any.tool",
        arguments={},
        tool_context=ctx,
    )
    assert "error" in result
    assert "COPASS_API_URL" in result["error"]
