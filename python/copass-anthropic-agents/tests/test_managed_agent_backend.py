"""ManagedAgentBackendV2 — message normalization, fingerprinting, tools payload.

Integration-level flow (``stream``, ``run``) is exercised by the
server-side Copass repo's end-to-end tests with a live Anthropic key.
Here we verify the vendor-neutral plumbing that can be tested without
network I/O.

These tests originally targeted v1's :class:`ManagedAgentBackend`. Per
ADR 0001 §7 the contract assertions repoint to
:class:`ManagedAgentBackendV2`; v1 stays callable through Phase 1 but
the helper-shape contract is now owned by v2's per-variant
:class:`PendingToolCall` reply builders.
"""

from __future__ import annotations

from typing import get_args

import pytest

from copass_anthropic_agents import (
    AgentTool,
    AgentToolRegistry,
    ManagedAgentBackend,
    ToolSpec,
)
from copass_anthropic_agents.backends._stream_event_types import (
    _IDLE_EVENT_TYPES,
    _KNOWN_NOOP_EVENT_TYPES,
    _TERMINATED_EVENT_TYPES,
)
from copass_anthropic_agents.backends.in_memory_provider_binding_registry import (
    InMemoryProviderBindingRegistry,
)
from copass_anthropic_agents.backends.managed_agent_backend_v2 import (
    ManagedAgentBackendV2,
)
from copass_anthropic_agents.backends.pending_tool_call import (
    CustomToolCall,
    McpToolCall,
    PendingToolCall,
    ServerToolCall,
    from_sdk_event,
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


def _make_backend() -> ManagedAgentBackendV2:
    """Construct a v2 backend stub for vendor-neutral plumbing tests.

    v2-only helpers (``_normalize_messages``, ``_specs_to_tools``,
    ``_fingerprint_agent``) preserve v1's semantics so the contract
    tests carry over with this helper swap.
    """
    return ManagedAgentBackendV2(
        api_key="sk-fake-test",
        registry=InMemoryProviderBindingRegistry(),
    )


def _make_v1_backend() -> ManagedAgentBackend:
    """v1 helper for the v1-only ``_send_events_soft`` tests.

    Phase 1 keeps v1 callable and on-by-default, so these tests
    continue to exercise v1's helper. Phase 4 of ADR 0001 deletes the
    helper and the tests together.
    """
    return ManagedAgentBackend(api_key="sk-fake-test")


def test_normalize_messages_from_string() -> None:
    backend = _make_backend()
    out = backend._normalize_messages("hello")
    assert out == [
        {"type": "user.message", "content": [{"type": "text", "text": "hello"}]}
    ]


def test_normalize_messages_from_list() -> None:
    backend = _make_backend()
    out = backend._normalize_messages(
        [{"role": "user", "content": "one"}, {"role": "user", "content": "two"}]
    )
    assert len(out) == 2
    assert out[0]["content"][0]["text"] == "one"
    assert out[1]["content"][0]["text"] == "two"


def test_normalize_messages_skips_non_user() -> None:
    backend = _make_backend()
    out = backend._normalize_messages(
        [
            {"role": "assistant", "content": "should be dropped"},
            {"role": "user", "content": "kept"},
        ]
    )
    assert len(out) == 1
    assert out[0]["content"][0]["text"] == "kept"


def test_specs_to_tools_without_builtin_toolset() -> None:
    backend = _make_backend()
    specs = [
        ToolSpec(name="a", description="tool a", input_schema={"type": "object"}),
        ToolSpec(name="b", description="tool b", input_schema={"type": "object"}),
    ]
    tools = backend._specs_to_tools(specs)
    assert len(tools) == 2
    assert {t["type"] for t in tools} == {"custom"}
    assert [t["name"] for t in tools] == ["a", "b"]


def test_specs_to_tools_with_builtin_toolset() -> None:
    backend = ManagedAgentBackendV2(
        api_key="sk-fake",
        include_builtin_toolset=True,
        registry=InMemoryProviderBindingRegistry(),
    )
    specs = [ToolSpec(name="a", description="tool a", input_schema={"type": "object"})]
    tools = backend._specs_to_tools(specs)
    assert tools[0] == {"type": "agent_toolset_20260401"}
    assert tools[1]["type"] == "custom"


def test_fingerprint_stable_for_identical_config() -> None:
    backend = _make_backend()

    class _A:
        model = "m"
        system_prompt = "sp"
        identity = "id"

    reg = AgentToolRegistry()
    reg.add(_DummyTool("tool"))
    fp1 = backend._fingerprint_agent(_A(), reg)
    fp2 = backend._fingerprint_agent(_A(), reg)
    assert fp1 == fp2


def test_fingerprint_differs_when_prompt_changes() -> None:
    backend = _make_backend()

    class _A:
        model = "m"
        system_prompt = "sp-one"
        identity = "id"

    class _B:
        model = "m"
        system_prompt = "sp-two"
        identity = "id"

    reg = AgentToolRegistry()
    reg.add(_DummyTool("tool"))
    assert backend._fingerprint_agent(_A(), reg) != backend._fingerprint_agent(_B(), reg)


def test_fingerprint_differs_when_tools_change() -> None:
    backend = _make_backend()

    class _A:
        model = "m"
        system_prompt = "sp"
        identity = "id"

    reg_one = AgentToolRegistry()
    reg_one.add(_DummyTool("alpha"))
    reg_two = AgentToolRegistry()
    reg_two.add(_DummyTool("alpha"))
    reg_two.add(_DummyTool("beta"))
    assert backend._fingerprint_agent(_A(), reg_one) != backend._fingerprint_agent(_A(), reg_two)


# --- Reply-envelope routing -------------------------------------------------
#
# Regression coverage for the May 2026 incident where every agent.tool_use /
# agent.mcp_tool_use was being answered with a user.custom_tool_result. The
# server kept those events as pending — the next events.send returned 400
# ``waiting on responses to events [sevt_...]`` and the run failed mid-turn.
#
# v1's single string-dispatch ``_build_user_event_for_tool_use`` is replaced
# in v2 by per-variant ``PendingToolCall`` reply builders. Each variant owns
# its reply shape; the parser routes by class, not by string.


def test_build_user_event_for_custom_tool_use_returns_custom_result() -> None:
    """``CustomToolCall.build_reply_from_result`` builds the
    ``user.custom_tool_result`` envelope. The result dict is JSON-
    serialized into the ``content[0].text`` payload."""
    call = CustomToolCall(event_id="sevt_custom_1", name="t", arguments={})
    evt = call.build_reply_from_result({"value": 1}, None)
    assert evt["type"] == "user.custom_tool_result"
    assert evt["custom_tool_use_id"] == "sevt_custom_1"
    # Content carries the serialized result so the model can read it back.
    assert evt["content"][0]["type"] == "text"
    assert "value" in evt["content"][0]["text"]


def test_build_user_event_for_mcp_tool_use_returns_confirmation() -> None:
    """``McpToolCall.build_reply`` returns ``user.tool_confirmation(allow)``
    — never ``user.custom_tool_result``. Anthropic 400s on the wrong
    envelope (the May 2026 incident)."""
    evt = McpToolCall(event_id="sevt_mcp_1", name="x").build_reply()
    assert evt["type"] == "user.tool_confirmation"
    assert evt["tool_use_id"] == "sevt_mcp_1"
    assert evt["result"] == "allow"
    assert "custom_tool_use_id" not in evt


def test_build_user_event_for_builtin_tool_use_returns_confirmation() -> None:
    """``ServerToolCall.build_reply`` returns the same shape as
    :class:`McpToolCall`'s; the routing inside Anthropic is the only
    distinction, so v2 keeps the variants separate."""
    evt = ServerToolCall(event_id="sevt_builtin_1", name="bash").build_reply()
    assert evt["type"] == "user.tool_confirmation"
    assert evt["tool_use_id"] == "sevt_builtin_1"
    assert evt["result"] == "allow"


def test_unknown_envelope_is_a_type_error() -> None:
    """ADR 0001 §7 flips this test: v1 emitted a defensive fallback
    envelope; v2 makes an unknown envelope a programmer error. The
    sealed union refuses construction so the gap surfaces in a failing
    test rather than as silently-mis-routed prod replies."""
    class _UnknownEvt:
        type = "agent.future_tool_use"
        id = "sevt_future_1"
        name = "?"

    with pytest.raises(TypeError):
        from_sdk_event(_UnknownEvt())


def test_tool_use_event_types_include_all_three_envelopes() -> None:
    """v1's ``_TOOL_USE_EVENT_TYPES`` frozenset is replaced by the
    :data:`PendingToolCall` sealed union. ``typing.get_args`` is the
    test-time equivalent of "is this envelope modeled?"."""
    variants = set(get_args(PendingToolCall))
    assert variants == {CustomToolCall, ServerToolCall, McpToolCall}


def test_idle_event_types_include_thread_scoped_alias() -> None:
    # The Anthropic beta API has been moving session lifecycle from
    # session-scoped to thread-scoped envelopes. If the alias drops out,
    # the requires_action signal goes unrecognized and tool execution
    # never fires.
    assert "session.status_idle" in _IDLE_EVENT_TYPES
    assert "session.thread_status_idle" in _IDLE_EVENT_TYPES


def test_terminated_event_types_include_thread_scoped_alias() -> None:
    assert "session.status_terminated" in _TERMINATED_EVENT_TYPES
    assert "session.thread_status_terminated" in _TERMINATED_EVENT_TYPES


def test_known_noop_event_types_cover_observed_lifecycle_events() -> None:
    # Events seen in the May 11 2026 prod trace that previously logged
    # as ``unknown event type`` — listed here so they're explicitly
    # acknowledged as control-flow-irrelevant.
    for evt_type in (
        "session.status_running",
        "session.thread_status_running",
        "user.message",
        "user.custom_tool_result",
        "user.tool_confirmation",
        "span.model_request_start",
        "agent.thinking",
    ):
        assert evt_type in _KNOWN_NOOP_EVENT_TYPES, evt_type


@pytest.mark.asyncio
async def test_send_events_soft_returns_exception_on_400_and_sends_interrupt() -> None:
    # On a 400 from events.send, the backend must NOT propagate the
    # exception — it should catch it, fire a best-effort user.interrupt,
    # and return the exception so the streaming generator can emit a
    # soft AgentFinish(error). Without this, the streaming generator
    # crashed mid-yield and the credit-gate release was skipped.
    #
    # v1-only test — v2's send path is structurally different
    # (``RequiresActionCycle.send_replies`` + BadRequestError catch).
    # Stays green through Phase 1; deleted with v1 in Phase 4.
    backend = _make_v1_backend()
    sent_payloads: list[list[dict]] = []

    class _BoomEvents:
        async def send(self, session_id, events):
            sent_payloads.append(events)
            if len(sent_payloads) == 1:
                raise RuntimeError("simulated 400")

    class _Sessions:
        def __init__(self) -> None:
            self.events = _BoomEvents()

    class _Beta:
        def __init__(self) -> None:
            self.sessions = _Sessions()

    class _Client:
        def __init__(self) -> None:
            self.beta = _Beta()

    backend._client = _Client()
    result = await backend._send_events_soft(
        session_id="sesn_test",
        events=[{"type": "user.custom_tool_result"}],
    )
    assert isinstance(result, RuntimeError)
    # Two sends: the original reply (raised) + the best-effort interrupt.
    assert len(sent_payloads) == 2
    assert sent_payloads[1][0]["type"] == "user.interrupt"


@pytest.mark.asyncio
async def test_send_events_soft_returns_none_on_success() -> None:
    # v1-only test — see the matching ``_send_events_soft`` note above.
    backend = _make_v1_backend()
    sent_payloads: list[list[dict]] = []

    class _OkEvents:
        async def send(self, session_id, events):
            sent_payloads.append(events)

    class _Sessions:
        def __init__(self) -> None:
            self.events = _OkEvents()

    class _Beta:
        def __init__(self) -> None:
            self.sessions = _Sessions()

    class _Client:
        def __init__(self) -> None:
            self.beta = _Beta()

    backend._client = _Client()
    result = await backend._send_events_soft(
        session_id="sesn_test",
        events=[{"type": "user.tool_confirmation"}],
    )
    assert result is None
    assert len(sent_payloads) == 1
