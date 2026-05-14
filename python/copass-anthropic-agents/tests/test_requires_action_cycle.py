"""RequiresActionCycle — cycle-barrier and stale-rehydrate-resistance tests.

Maps to ADR 0001 §7 net-new tests **#1 (stale-rehydrate-resistance)**
and **#5 (cycle-barrier enforcement)**. These are the type-level
guards whose absence caused the May 2026 prod failure (see ADR §1.1).
"""

from __future__ import annotations

import pytest

from copass_anthropic_agents.backends.managed_agent_backend_v2 import (
    ManagedAgentBackendV2,
)
from copass_anthropic_agents.backends.pending_tool_call import (
    CustomToolCall,
    McpToolCall,
)
from copass_anthropic_agents.backends.requires_action_cycle import (
    MissingPendingToolCallError,
    OutOfCycleReplyError,
    RequiresActionCycle,
)


def test_cycle_construction_with_empty_requested_ids_is_valid() -> None:
    """Degenerate edge case — empty set is a valid cycle (no replies
    needed). Locked here so a future tightening doesn't accidentally
    reject the case."""
    cycle = RequiresActionCycle(cycle_id="c1", requested_ids=frozenset())

    assert cycle.cycle_id == "c1"
    assert cycle.requested_ids == frozenset()
    assert cycle.executed_ids == set()


def test_cycle_calls_resolves_buffered_events() -> None:
    """Happy path: requested ids resolve to the matching buffered
    :class:`PendingToolCall` instances."""
    a = CustomToolCall(event_id="sevt_a", name="t", arguments={})
    b = McpToolCall(event_id="sevt_b", name="m")
    cycle = RequiresActionCycle(
        cycle_id="c1", requested_ids=frozenset({"sevt_a", "sevt_b"}),
    )
    events_by_id = {"sevt_a": a, "sevt_b": b}

    calls = cycle.calls(events_by_id)

    # Calls are returned in sorted-by-id order; assert by event_id
    # because :class:`CustomToolCall` carries a dict ``arguments`` and
    # is therefore unhashable for set membership comparison.
    assert [c.event_id for c in calls] == ["sevt_a", "sevt_b"]


def test_cycle_calls_raises_when_event_id_not_in_events_by_id() -> None:
    """ADR 0001 §7 test #1: when ``requires_action`` cites an id the
    SSE stream never surfaced, :meth:`RequiresActionCycle.calls`
    raises :class:`MissingPendingToolCallError`. There is no fallback
    to ``events.list`` — that was the prod failure's root cause."""
    cycle = RequiresActionCycle(
        cycle_id="c1", requested_ids=frozenset({"sevt_a"}),
    )
    events_by_id = {"sevt_b": CustomToolCall(
        event_id="sevt_b", name="t", arguments={},
    )}

    with pytest.raises(MissingPendingToolCallError) as exc_info:
        cycle.calls(events_by_id)

    assert "sevt_a" in exc_info.value.missing_ids
    # The known ids are surfaced for debugging — the May 2026 incident
    # blew up because the buffered ids weren't visible at log time.
    assert exc_info.value.known_ids == ["sevt_b"]


def test_v1_rehydrate_path_does_not_exist_in_v2() -> None:
    """Smoke check: the v1 ``_rehydrate_pending_tool_events`` method
    is not in v2. If a future refactor reintroduces it, the structural
    fix Decision 2 enforces has regressed."""
    assert getattr(
        ManagedAgentBackendV2, "_rehydrate_pending_tool_events", None
    ) is None


@pytest.mark.asyncio
async def test_cycle_send_replies_refuses_reply_for_unrequested_id() -> None:
    """ADR 0001 §7 test #5: out-of-cycle reply ids raise BEFORE the
    POST. v1 would have sent the wrong envelope and let Anthropic's
    400 validator catch it; v2 catches it at the type / code layer."""
    cycle = RequiresActionCycle(
        cycle_id="c1", requested_ids=frozenset({"sevt_a"}),
    )

    # Try to send a reply for ``sevt_b`` — not in the cycle.
    bad_reply = {
        "type": "user.custom_tool_result",
        "custom_tool_use_id": "sevt_b",
        "content": [],
    }

    sends_attempted: list = []

    class _FakeClient:
        class beta:
            class sessions:
                class events:
                    @staticmethod
                    async def send(session_id, events):
                        sends_attempted.append(events)

    with pytest.raises(OutOfCycleReplyError) as exc_info:
        await cycle.send_replies(_FakeClient(), "sesn_1", [bad_reply])

    assert exc_info.value.reply_id == "sevt_b"
    # The barrier MUST refuse BEFORE the POST — otherwise the May 2026
    # failure mode (stale id reaching events.send) is still live.
    assert sends_attempted == []


@pytest.mark.asyncio
async def test_cycle_send_replies_posts_when_ids_match() -> None:
    """Happy path: in-cycle replies POST exactly once and record
    against ``executed_ids``."""
    cycle = RequiresActionCycle(
        cycle_id="c1", requested_ids=frozenset({"sevt_a"}),
    )
    reply = {
        "type": "user.custom_tool_result",
        "custom_tool_use_id": "sevt_a",
        "content": [{"type": "text", "text": "{\"result\": {}}"}],
    }

    sends_attempted: list = []

    class _FakeEvents:
        async def send(self, session_id, events):
            sends_attempted.append((session_id, events))

    class _FakeSessions:
        def __init__(self):
            self.events = _FakeEvents()

    class _FakeBeta:
        def __init__(self):
            self.sessions = _FakeSessions()

    class _FakeClient:
        def __init__(self):
            self.beta = _FakeBeta()

    await cycle.send_replies(_FakeClient(), "sesn_1", [reply])

    assert len(sends_attempted) == 1
    assert sends_attempted[0] == ("sesn_1", [reply])
    assert cycle.executed_ids == {"sevt_a"}


@pytest.mark.asyncio
async def test_cycle_send_replies_validates_tool_confirmation_envelopes() -> None:
    """``user.tool_confirmation`` carries the id as ``tool_use_id``,
    not ``custom_tool_use_id``. The cycle's barrier looks at both
    fields — failing to do so would let server/MCP confirmations
    through without validation."""
    cycle = RequiresActionCycle(
        cycle_id="c1", requested_ids=frozenset({"sevt_srv"}),
    )
    good_reply = {
        "type": "user.tool_confirmation",
        "tool_use_id": "sevt_srv",
        "result": "allow",
    }
    bad_reply = {
        "type": "user.tool_confirmation",
        "tool_use_id": "sevt_other",
        "result": "allow",
    }

    class _FakeEvents:
        async def send(self, session_id, events):
            pass

    class _Client:
        class beta:
            class sessions:
                events = _FakeEvents()

    # Good reply: succeeds.
    await cycle.send_replies(_Client(), "sesn_1", [good_reply])
    assert "sevt_srv" in cycle.executed_ids

    # Bad reply: refused.
    cycle2 = RequiresActionCycle(
        cycle_id="c2", requested_ids=frozenset({"sevt_srv"}),
    )
    with pytest.raises(OutOfCycleReplyError):
        await cycle2.send_replies(_Client(), "sesn_1", [bad_reply])


@pytest.mark.asyncio
async def test_cycle_send_replies_refuses_reply_with_no_id() -> None:
    """A reply envelope with neither ``custom_tool_use_id`` nor
    ``tool_use_id`` is malformed — the cycle refuses to forward it
    rather than let Anthropic 400 on it."""
    cycle = RequiresActionCycle(
        cycle_id="c1", requested_ids=frozenset({"sevt_a"}),
    )
    bad_reply = {"type": "user.interrupt"}  # no tool id

    class _FakeEvents:
        async def send(self, session_id, events):
            pass

    class _Client:
        class beta:
            class sessions:
                events = _FakeEvents()

    with pytest.raises(OutOfCycleReplyError):
        await cycle.send_replies(_Client(), "sesn_1", [bad_reply])
