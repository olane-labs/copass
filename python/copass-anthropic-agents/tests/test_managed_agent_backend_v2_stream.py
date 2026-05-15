"""ManagedAgentBackendV2 — stream-level integration tests with a stubbed Anthropic.

Covers ADR 0001 §7 net-new tests:

- **#1 (stale-rehydrate-resistance)** —
  :func:`test_unknown_event_id_in_requires_action_aborts_via_interrupt`.
  Asserts that an unknown id in ``requires_action`` aborts via
  ``user.interrupt`` rather than calling ``events.list``.

- **#2 (SSE-vs-requires_action race)** —
  :func:`test_requires_action_before_use_events_buffers_until_arrival`.
  Asserts that when the use events arrive before ``requires_action``
  (the normal SSE ordering), the cycle resolves cleanly.

- **#6 (policy timeout enforcement)** —
  :func:`test_total_timeout_yields_agent_finish_error`.
  Asserts that an indefinitely-streaming SDK yields
  ``AgentFinish(policy_total_timeout)`` within budget instead of
  blocking.

Also covers Decision 3's structural invariant:
:func:`test_no_in_process_caches_after_stream`.
"""

from __future__ import annotations

import asyncio

import pytest

from copass_anthropic_agents.backends.backend_run_policy import BackendRunPolicy
from copass_anthropic_agents.backends.in_memory_provider_binding_registry import (
    InMemoryProviderBindingRegistry,
)
from copass_anthropic_agents.backends.managed_agent_backend_v2 import (
    STOP_REASON_END_TURN,
    STOP_REASON_POLICY_TOTAL_TIMEOUT,
    STOP_REASON_REQUIRES_ACTION_MISSING_EVENT_ID,
    ManagedAgentBackendV2,
)
from copass_core_agents.base_agent import BaseAgent
from copass_core_agents.base_tool import AgentTool, ToolSpec
from copass_core_agents.events import AgentFinish, AgentToolCall, AgentToolResult
from copass_core_agents.invocation_context import AgentInvocationContext
from copass_core_agents.scope import AgentScope
from copass_core_agents.tool_registry import AgentToolRegistry


# --- Stub SDK fixtures -------------------------------------------------------
#
# The stubs deliberately model only the surface ``ManagedAgentBackendV2``
# touches: ``beta.agents.create``, ``beta.environments.create``,
# ``beta.sessions.create``, ``beta.sessions.delete``,
# ``beta.sessions.events.send``, and ``beta.sessions.events.stream``.
# Anything else (``events.list``) is intentionally absent — if v2 ever
# reaches for it the test crashes loudly, which is the regression
# guard for ADR 0001 Decision 2.


class _StubSdkEvent:
    """Bag-of-attributes for one SSE event."""

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


class _StubStopReason:
    def __init__(self, *, type: str, event_ids=None):
        self.type = type
        self.event_ids = event_ids or []


class _StubStream:
    """Async-iterable SDK stream. Yields the configured events in order."""

    def __init__(self, events):
        self._events = list(events)
        self._idx = 0
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._idx >= len(self._events):
            raise StopAsyncIteration
        evt = self._events[self._idx]
        self._idx += 1
        # Tiny await so timeout tests can fire while the iterator is
        # mid-flight.
        await asyncio.sleep(0)
        return evt

    async def close(self):
        self.closed = True


class _StubInfiniteStream:
    """Async-iterable SDK stream that never terminates and never yields.

    Used by the total-timeout enforcement test — modeling a wedged
    session by blocking on an event that never arrives.
    """

    def __init__(self):
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        # Sleep forever. The total-timeout wrapper has to cut us off.
        await asyncio.sleep(3600)
        raise StopAsyncIteration  # pragma: no cover

    async def close(self):
        self.closed = True


class _StubEvents:
    def __init__(self, stream):
        self._stream = stream
        self.sent: list[dict] = []

    async def stream(self, session_id):
        return self._stream

    async def send(self, session_id, events):
        self.sent.append({"session_id": session_id, "events": events})


class _StubSessions:
    def __init__(self, stream):
        self.events = _StubEvents(stream)
        self.created: list[dict] = []
        self.deleted: list[str] = []

    async def create(self, **kwargs):
        self.created.append(kwargs)

        class _S:
            id = "sesn_test_1"

        return _S()

    async def delete(self, session_id):
        self.deleted.append(session_id)


class _StubAgents:
    def __init__(self):
        self.created: list[dict] = []

    async def create(self, **kwargs):
        self.created.append(kwargs)

        class _A:
            id = "agnt_test_1"

        return _A()


class _StubEnvironments:
    def __init__(self):
        self.created: list[dict] = []

    async def create(self, **kwargs):
        self.created.append(kwargs)

        class _E:
            id = "env_test_1"

        return _E()


class _StubBeta:
    def __init__(self, stream):
        self.agents = _StubAgents()
        self.environments = _StubEnvironments()
        self.sessions = _StubSessions(stream)


class _StubClient:
    def __init__(self, stream):
        self.beta = _StubBeta(stream)


# --- Agent + tool fixtures --------------------------------------------------


class _EchoTool(AgentTool):
    def __init__(self, name: str, result):
        self._name = name
        self._result = result

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name=self._name,
            description="echo",
            input_schema={"type": "object", "properties": {}},
        )

    async def invoke(self, arguments, *, context=None):
        return self._result


class _StubBackendForAgent:
    """Minimal backend stand-in so :class:`BaseAgent` accepts our agent.

    Never called by the tests — the real v2 backend is what drives
    behavior. ``BaseAgent`` requires *some* backend in the constructor
    even if we go through ``.stream(...)`` on v2 directly.
    """

    async def run(self, *args, **kwargs):
        raise AssertionError("not used")

    def stream(self, *args, **kwargs):
        raise AssertionError("not used")


def _agent_with_tool(tool: AgentTool) -> BaseAgent:
    reg = AgentToolRegistry()
    reg.add(tool)
    return BaseAgent(
        identity="test-agent",
        model="claude-sonnet-4-5",
        system_prompt="you are a test",
        backend=_StubBackendForAgent(),  # type: ignore[arg-type]
        tools=reg,
    )


def _ctx() -> AgentInvocationContext:
    return AgentInvocationContext(
        scope=AgentScope(user_id="u-test-1"),
        trace_id="trace-1",
    )


def _make_backend(
    stream: _StubStream | _StubInfiniteStream,
    *,
    policy: BackendRunPolicy = None,
) -> ManagedAgentBackendV2:
    client = _StubClient(stream)
    backend = ManagedAgentBackendV2(
        client=client,  # type: ignore[arg-type]
        registry=InMemoryProviderBindingRegistry(),
        policy=policy or BackendRunPolicy.default(),
    )
    return backend


# --- Tests ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_end_turn_yields_finish_and_no_cycle() -> None:
    """Smoke check: a stream that just emits ``end_turn`` produces an
    ``AgentFinish(end_turn)`` and no tool-call events."""
    stream = _StubStream([
        _StubSdkEvent(
            type="session.thread_status_idle",
            id="idle_1",
            stop_reason=_StubStopReason(type="end_turn"),
        ),
    ])
    backend = _make_backend(stream)
    agent = _agent_with_tool(_EchoTool("echo", {"k": "v"}))

    events = []
    async for evt in backend.stream(agent, "hello", _ctx()):
        events.append(evt)

    assert any(
        isinstance(e, AgentFinish) and e.stop_reason == STOP_REASON_END_TURN
        for e in events
    )


@pytest.mark.asyncio
async def test_requires_action_before_use_events_buffers_until_arrival() -> None:
    """ADR 0001 §7 test #2 (SSE-vs-requires_action race).

    Normal SSE ordering: the use event arrives BEFORE the
    ``requires_action`` envelope. v2 buffers the use event into
    ``events_by_id``, then the ``requires_action`` cycle resolves the
    requested id against the buffer, executes the tool, sends the
    reply, and finishes with ``end_turn``.
    """
    stream = _StubStream([
        # Use event first (the SSE-ordering invariant).
        _StubSdkEvent(
            type="agent.custom_tool_use",
            id="sevt_a",
            name="echo",
            input={"q": "x"},
        ),
        # Then requires_action citing sevt_a.
        _StubSdkEvent(
            type="session.thread_status_idle",
            id="idle_1",
            stop_reason=_StubStopReason(
                type="requires_action", event_ids=["sevt_a"],
            ),
        ),
        # After we POST the reply, the model resumes and emits end_turn.
        _StubSdkEvent(
            type="session.thread_status_idle",
            id="idle_2",
            stop_reason=_StubStopReason(type="end_turn"),
        ),
    ])
    backend = _make_backend(stream)
    agent = _agent_with_tool(_EchoTool("echo", {"k": "v"}))

    events = []
    async for evt in backend.stream(agent, "hello", _ctx()):
        events.append(evt)

    # The tool call surfaced as an AgentToolCall event.
    tool_calls = [e for e in events if isinstance(e, AgentToolCall)]
    assert len(tool_calls) == 1
    assert tool_calls[0].name == "echo"

    # And as an AgentToolResult event after execution.
    tool_results = [e for e in events if isinstance(e, AgentToolResult)]
    assert len(tool_results) == 1
    assert tool_results[0].result == {"k": "v"}

    # Final event is AgentFinish(end_turn).
    assert events[-1] == AgentFinish(
        stop_reason=STOP_REASON_END_TURN,
        usage={},
        session_id="sesn_test_1",
    )

    # The user.message + the cycle reply were sent. No events.list call —
    # the stub doesn't even expose one.
    sent = backend._client.beta.sessions.events.sent  # type: ignore[attr-defined]
    assert len(sent) == 2
    assert sent[0]["events"][0]["type"] == "user.message"
    assert sent[1]["events"][0]["type"] == "user.custom_tool_result"
    assert sent[1]["events"][0]["custom_tool_use_id"] == "sevt_a"


@pytest.mark.asyncio
async def test_requires_action_before_use_events_continues_stream_no_tool_execution() -> None:  # noqa: E501
    """Hypothetical out-of-order SSE delivery — requires_action arrives
    before the matching ``agent.custom_tool_use`` events.

    1.4.1 added a drain inside ``_await_pending_calls`` that pulled
    events from the stream to satisfy this case. 1.4.3 removed it:
    the drain raced the outer ``async for sdk_event in stream`` loop
    and ate subsequent text deltas (staging 2026-05-16 incident).

    In 1.4.3 this scenario produces:
    - The cycle fails (no buffered ids) → log warning + continue.
    - Use events that arrive AFTER are still consumed by the outer
      loop and yielded as :class:`AgentToolCall`.
    - But the tools are NOT executed and no replies are POSTed —
      we missed the chance during the cycle's lifetime.
    - The run ends with whatever terminal event the stream provides
      (here, ``end_turn`` because the model knew the tools were
      server-executed and didn't need our reply).

    For genuinely custom tools where Anthropic IS waiting on a
    ``user.custom_tool_result``, this scenario would hang the
    session and the outer ``total_timeout_s`` would fire. That's
    the trade-off documented in the ``_await_pending_calls``
    docstring: drain-once-and-eat-streaming is worse than don't-drain-
    and-occasionally-stall, because the former hits production every
    Concierge multi-tool turn (staging 2026-05-16) while the latter
    is a hypothetical out-of-order race we've never observed.
    """
    stream = _StubStream([
        _StubSdkEvent(
            type="session.thread_status_idle",
            id="idle_1",
            stop_reason=_StubStopReason(
                type="requires_action",
                event_ids=["sevt_a", "sevt_b"],
            ),
        ),
        _StubSdkEvent(
            type="agent.custom_tool_use",
            id="sevt_a",
            name="echo",
            input={"q": "x"},
        ),
        _StubSdkEvent(
            type="agent.custom_tool_use",
            id="sevt_b",
            name="echo",
            input={"q": "y"},
        ),
        _StubSdkEvent(
            type="session.thread_status_idle",
            id="idle_2",
            stop_reason=_StubStopReason(type="end_turn"),
        ),
    ])
    backend = _make_backend(stream)
    agent = _agent_with_tool(_EchoTool("echo", {"k": "v"}))

    events = []
    async for evt in backend.stream(agent, "hello", _ctx()):
        events.append(evt)

    # AgentToolCall fires for both — the outer loop reads them after
    # the cycle fails and yields them as observed-but-unanswered.
    tool_calls = [e for e in events if isinstance(e, AgentToolCall)]
    assert {c.call_id for c in tool_calls} == {"sevt_a", "sevt_b"}

    # Tools were NOT executed locally (the cycle had already failed
    # by the time the use events surfaced). No AgentToolResult, no
    # reply POSTed.
    tool_results = [e for e in events if isinstance(e, AgentToolResult)]
    assert tool_results == []

    sent = backend._client.beta.sessions.events.sent  # type: ignore[attr-defined]
    assert all(
        s["events"][0]["type"] != "user.custom_tool_result" for s in sent
    )
    assert all(
        s["events"][0]["type"] != "user.interrupt" for s in sent
    )

    # Run ended cleanly with end_turn from the model.
    assert events[-1].stop_reason == STOP_REASON_END_TURN


@pytest.mark.asyncio
class _StubTextBlock:
    """Minimal stand-in for an ``agent.message.content[i]`` text block."""

    def __init__(self, text: str) -> None:
        self.type = "text"
        self.text = text


@pytest.mark.asyncio
async def test_unresolved_requires_action_keeps_stream_open_for_final_message() -> None:  # noqa: E501
    # Imported here (rather than at module top) so the test file's
    # other tests stay compatible with the existing import block.
    from copass_core_agents.events import AgentTextDelta as _AgentTextDelta
    """Regression for staging incident 2026-05-16.

    Anthropic console transcript showed the agent ran to completion —
    preamble + tool calls + 14kB final ``agent.message`` with the
    full result — but our client received only the preamble. Root
    cause: v2's stream loop ``break``d out on
    ``MissingPendingToolCallError`` and POSTed ``user.interrupt``
    while Anthropic was already 35 seconds into generating the final
    answer.

    For sessions using server-executed tool surfaces (``mcp_toolset``
    via the gateway, ``agent_toolset_20260401`` built-ins), Anthropic
    does NOT wait for the client to reply to ``requires_action``.
    The model continues generating regardless. v2 must keep
    consuming the stream so the final text deltas reach the client.

    This test pins the contract: when a ``requires_action`` cycle
    fails to resolve, v2 logs a warning and **continues the stream
    loop**. Subsequent ``agent.message`` deltas surface as
    ``AgentTextDelta`` events; the run ends naturally with
    ``end_turn`` from the model, not with our forced
    ``AgentFinish(error)``.
    """
    stream = _StubStream([
        # Preamble text that the model emits before tool calls.
        _StubSdkEvent(
            type="agent.message",
            id="msg_preamble",
            content=[
                _StubTextBlock("Let me check that…"),
            ],
        ),
        # requires_action with an id v2 cannot resolve (no matching
        # use event was streamed, and the stub deliberately has no
        # events.list to fall back to).
        _StubSdkEvent(
            type="session.thread_status_idle",
            id="idle_1",
            stop_reason=_StubStopReason(
                type="requires_action", event_ids=["sevt_server_executed"],
            ),
        ),
        # The KEY assertion: events AFTER an unresolved requires_action
        # must still reach the caller. Anthropic ran tools server-side,
        # produced the final answer, and is streaming it back. v2 must
        # not have broken out of the loop.
        _StubSdkEvent(
            type="agent.message",
            id="msg_final",
            content=[
                _StubTextBlock(
                    "Here's your full sales picture for last week: …",
                ),
            ],
        ),
        # Natural end_turn from the model — NOT a forced
        # AgentFinish(error) from v2's old interrupt path.
        _StubSdkEvent(
            type="session.thread_status_idle",
            id="idle_2",
            stop_reason=_StubStopReason(type="end_turn"),
        ),
    ])
    backend = _make_backend(stream)
    agent = _agent_with_tool(_EchoTool("echo", {"k": "v"}))

    events = []
    async for evt in backend.stream(agent, "hello", _ctx()):
        events.append(evt)

    # The preamble AND the final answer both reached the caller as
    # AgentTextDelta. Before this fix, only the preamble surfaced.
    text_deltas = [e for e in events if isinstance(e, _AgentTextDelta)]
    delta_texts = [e.text for e in text_deltas]
    assert "Let me check that…" in delta_texts
    assert any(
        "Here's your full sales picture" in t for t in delta_texts
    ), (
        "v2 must keep the stream loop alive across an unresolved "
        "requires_action so post-tool text deltas reach the caller "
        "(staging 2026-05-16 regression)"
    )

    # The run ended naturally with end_turn from the model, NOT with
    # a forced AgentFinish(requires_action_missing_event_id) from v2.
    finishes = [e for e in events if isinstance(e, AgentFinish)]
    assert len(finishes) == 1
    assert finishes[0].stop_reason == STOP_REASON_END_TURN

    # v2 did NOT POST user.interrupt — that was actively hostile to
    # the server-driven session in the old behavior.
    sent = backend._client.beta.sessions.events.sent  # type: ignore[attr-defined]
    sent_types = [s["events"][0]["type"] for s in sent]
    assert "user.interrupt" not in sent_types, (
        "v2 must not interrupt a session whose tools are server-executed; "
        "Anthropic keeps generating regardless of our reply"
    )


@pytest.mark.asyncio
async def test_total_timeout_yields_agent_finish_error() -> None:
    """ADR 0001 §7 test #6 (policy timeout enforcement).

    Configure a 0.1s ``total_timeout_s`` against a stream that never
    yields ``end_turn``. v2 must yield ``AgentFinish(policy_total_timeout)``
    within budget + small epsilon, NOT block indefinitely.
    """
    stream = _StubInfiniteStream()
    backend = _make_backend(
        stream,
        policy=BackendRunPolicy(
            max_cycles=20, cycle_timeout_s=60.0, total_timeout_s=0.1,
        ),
    )
    agent = _agent_with_tool(_EchoTool("echo", {"k": "v"}))

    started = asyncio.get_event_loop().time()
    events = []
    async for evt in backend.stream(agent, "hello", _ctx()):
        events.append(evt)
    elapsed = asyncio.get_event_loop().time() - started

    # Bounded — the assertion lets a generous slack so test isn't flaky
    # under load.
    assert elapsed < 5.0, (
        f"Total-timeout did not cut off the stream: elapsed={elapsed:.2f}s"
    )

    finishes = [e for e in events if isinstance(e, AgentFinish)]
    assert any(
        f.stop_reason == STOP_REASON_POLICY_TOTAL_TIMEOUT for f in finishes
    )


@pytest.mark.asyncio
async def test_no_in_process_caches_after_stream() -> None:
    """Decision 3's structural invariant. The backend has neither
    ``_agent_ids`` nor ``_environment_id`` — those are v1's
    cost-surprise vectors. The ``ProviderBindingRegistry`` carries
    the equivalent state."""
    stream = _StubStream([
        _StubSdkEvent(
            type="session.thread_status_idle",
            id="idle_1",
            stop_reason=_StubStopReason(type="end_turn"),
        ),
    ])
    backend = _make_backend(stream)
    agent = _agent_with_tool(_EchoTool("echo", {"k": "v"}))

    async for _ in backend.stream(agent, "hello", _ctx()):
        pass

    assert not hasattr(backend, "_agent_ids")
    assert not hasattr(backend, "_environment_id")


@pytest.mark.asyncio
async def test_text_delta_surfaces_as_agent_text_delta() -> None:
    """An ``agent.message`` block with text emits an
    :class:`AgentTextDelta` per text block. Smoke test for the happy
    path."""
    from copass_core_agents.events import AgentTextDelta

    class _Block:
        def __init__(self, text):
            self.type = "text"
            self.text = text

    stream = _StubStream([
        _StubSdkEvent(
            type="agent.message",
            id="msg_1",
            content=[_Block("hello "), _Block("world")],
        ),
        _StubSdkEvent(
            type="session.thread_status_idle",
            id="idle_1",
            stop_reason=_StubStopReason(type="end_turn"),
        ),
    ])
    backend = _make_backend(stream)
    agent = _agent_with_tool(_EchoTool("echo", {"k": "v"}))

    events = []
    async for evt in backend.stream(agent, "hello", _ctx()):
        events.append(evt)

    deltas = [e.text for e in events if isinstance(e, AgentTextDelta)]
    assert deltas == ["hello ", "world"]


@pytest.mark.asyncio
async def test_provisioning_uses_registry_with_anthropic_provider_key() -> None:
    """The backend uses ``provider='anthropic_managed'`` for the
    registry key (Decision 3 — future ``openai_responses`` binding
    lives alongside, not in place of)."""
    stream = _StubStream([
        _StubSdkEvent(
            type="session.thread_status_idle",
            id="idle_1",
            stop_reason=_StubStopReason(type="end_turn"),
        ),
    ])
    backend = _make_backend(stream)
    agent = _agent_with_tool(_EchoTool("echo", {"k": "v"}))

    async for _ in backend.stream(agent, "hello", _ctx()):
        pass

    # The registry stored a binding under ``anthropic_managed``.
    binding = await backend._registry.get_binding(  # type: ignore[attr-defined]
        user_id="u-test-1",
        agent_id="test-agent",
        provider="anthropic_managed",
        for_version=1,
    )
    assert binding is not None
    assert binding.agent_id == "agnt_test_1"
    assert binding.environment_id == "env_test_1"
