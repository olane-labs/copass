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
async def test_requires_action_arrives_before_use_events_drains_stream() -> None:
    """Regression for staging incident 2026-05-14 — the Concierge
    4-tool burst surfaced ``requires_action`` BEFORE the matching
    ``agent.custom_tool_use`` events.

    Phase 1's ``_await_pending_calls`` had a TODO ("no live trace
    shows this") and aborted immediately on a miss. Staging proved
    the assumption wrong: the SSE iterator yielded
    ``session.thread_status_idle`` with
    ``stop_reason.type='requires_action'`` ahead of the use events,
    causing v2 to interrupt with empty post-tool synthesis. v2 must
    drain additional events from the stream until every requested id
    is buffered, then resolve the cycle cleanly.
    """
    stream = _StubStream([
        # requires_action FIRST, before any use events.
        _StubSdkEvent(
            type="session.thread_status_idle",
            id="idle_1",
            stop_reason=_StubStopReason(
                type="requires_action",
                event_ids=["sevt_a", "sevt_b"],
            ),
        ),
        # Use events arrive AFTER — out-of-order on the wire. v2 must
        # drain these into the buffer to satisfy the cycle.
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
        # After we POST the replies, model emits end_turn.
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

    # Both tool calls surfaced.
    tool_calls = [e for e in events if isinstance(e, AgentToolCall)]
    assert len(tool_calls) == 2
    assert {c.call_id for c in tool_calls} == {"sevt_a", "sevt_b"}

    # Both tools executed.
    tool_results = [e for e in events if isinstance(e, AgentToolResult)]
    assert len(tool_results) == 2

    # End cleanly with end_turn — NOT requires_action_missing_event_id.
    assert events[-1] == AgentFinish(
        stop_reason=STOP_REASON_END_TURN,
        usage={},
        session_id="sesn_test_1",
    )

    # Replies POSTed for both ids. No events.list call (the stub
    # doesn't expose one, so the test would crash).
    sent = backend._client.beta.sessions.events.sent  # type: ignore[attr-defined]
    # 1 user.message + 1 batched cycle reply (both custom_tool_results).
    assert len(sent) == 2
    assert sent[0]["events"][0]["type"] == "user.message"
    reply_ids = {e["custom_tool_use_id"] for e in sent[1]["events"]}
    assert reply_ids == {"sevt_a", "sevt_b"}


@pytest.mark.asyncio
async def test_unknown_event_id_in_requires_action_aborts_via_interrupt() -> None:
    """ADR 0001 §7 test #1 (stale-rehydrate-resistance).

    ``requires_action`` cites an id the SSE stream never surfaced. v2
    must POST ``user.interrupt`` and yield
    ``AgentFinish(requires_action_missing_event_id)`` rather than
    fall back to ``events.list``. (The stub deliberately has no
    ``events.list`` attribute — a regression that tries to call it
    will crash loudly.)
    """
    stream = _StubStream([
        # requires_action with no matching use event in the buffer.
        _StubSdkEvent(
            type="session.thread_status_idle",
            id="idle_1",
            stop_reason=_StubStopReason(
                type="requires_action", event_ids=["sevt_stale"],
            ),
        ),
    ])
    backend = _make_backend(stream)
    agent = _agent_with_tool(_EchoTool("echo", {"k": "v"}))

    events = []
    async for evt in backend.stream(agent, "hello", _ctx()):
        events.append(evt)

    # Final event is AgentFinish with the locked stop_reason string.
    finishes = [e for e in events if isinstance(e, AgentFinish)]
    assert len(finishes) == 1
    assert finishes[0].stop_reason == STOP_REASON_REQUIRES_ACTION_MISSING_EVENT_ID

    # user.interrupt was POSTed.
    sent = backend._client.beta.sessions.events.sent  # type: ignore[attr-defined]
    sent_types = [s["events"][0]["type"] for s in sent]
    assert "user.interrupt" in sent_types

    # Decision 2 invariant: no events.list call. The stub has no
    # ``events.list`` attribute; accessing it would raise. Assert
    # explicitly:
    assert not hasattr(
        backend._client.beta.sessions.events,  # type: ignore[attr-defined]
        "list",
    ), "v2 must never call events.list during a live stream (ADR 0001 Decision 2)"


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
