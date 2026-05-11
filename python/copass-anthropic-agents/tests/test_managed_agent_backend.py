"""ManagedAgentBackend — message normalization, fingerprinting, tools payload.

Integration-level flow (``stream``, ``run``) is exercised by the
server-side Copass repo's end-to-end tests with a live Anthropic key.
Here we verify the vendor-neutral plumbing that can be tested without
network I/O.
"""

from __future__ import annotations

import pytest

from copass_anthropic_agents import (
    AgentTool,
    AgentToolRegistry,
    ManagedAgentBackend,
    ToolSpec,
)
from copass_anthropic_agents.backends.managed_agent_backend import (
    _IDLE_EVENT_TYPES,
    _KNOWN_NOOP_EVENT_TYPES,
    _TERMINATED_EVENT_TYPES,
    _TOOL_USE_EVENT_TYPES,
    _build_user_event_for_tool_use,
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


def _make_backend() -> ManagedAgentBackend:
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
    backend = ManagedAgentBackend(api_key="sk-fake", include_builtin_toolset=True)
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


def test_build_user_event_for_custom_tool_use_returns_custom_result() -> None:
    evt = _build_user_event_for_tool_use(
        source_type="agent.custom_tool_use",
        event_id="sevt_custom_1",
        result={"value": 1},
        error=None,
    )
    assert evt["type"] == "user.custom_tool_result"
    assert evt["custom_tool_use_id"] == "sevt_custom_1"
    # Content carries the serialized result so the model can read it back.
    assert evt["content"][0]["type"] == "text"
    assert "value" in evt["content"][0]["text"]


def test_build_user_event_for_mcp_tool_use_returns_confirmation() -> None:
    evt = _build_user_event_for_tool_use(
        source_type="agent.mcp_tool_use",
        event_id="sevt_mcp_1",
        result={},
        error=None,
    )
    assert evt["type"] == "user.tool_confirmation"
    assert evt["tool_use_id"] == "sevt_mcp_1"
    assert evt["result"] == "allow"
    assert "custom_tool_use_id" not in evt


def test_build_user_event_for_builtin_tool_use_returns_confirmation() -> None:
    evt = _build_user_event_for_tool_use(
        source_type="agent.tool_use",
        event_id="sevt_builtin_1",
        result={},
        error=None,
    )
    assert evt["type"] == "user.tool_confirmation"
    assert evt["tool_use_id"] == "sevt_builtin_1"
    assert evt["result"] == "allow"


def test_build_user_event_for_unknown_source_does_not_raise() -> None:
    # Defensive: if Anthropic ships a new tool-use envelope we don't yet
    # model, the backend should still emit *some* reply rather than crash
    # the run. The reply will likely be rejected by the API, but
    # ``_send_events_soft`` catches that and surfaces a soft AgentFinish.
    evt = _build_user_event_for_tool_use(
        source_type="agent.future_tool_use",
        event_id="sevt_future_1",
        result={"ok": True},
        error=None,
    )
    assert evt["type"] in (
        "user.custom_tool_result",
        "user.tool_confirmation",
    )


def test_tool_use_event_types_include_all_three_envelopes() -> None:
    # If this set ever shrinks, server-side tool calls will fall through
    # to the unknown-event-type warning and the requires_action signal
    # will arrive with un-buffered ids — the exact failure mode that
    # stranded the May 2026 sessions.
    assert "agent.custom_tool_use" in _TOOL_USE_EVENT_TYPES
    assert "agent.tool_use" in _TOOL_USE_EVENT_TYPES
    assert "agent.mcp_tool_use" in _TOOL_USE_EVENT_TYPES


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
    backend = _make_backend()
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
    backend = _make_backend()
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
