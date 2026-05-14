"""RequiresActionCycle — per-cycle state object for a single
``requires_action`` round.

The cycle scopes reply construction to the server-authoritative
``stop.event_ids`` carried by the ``requires_action`` envelope. The
class refuses (at construction or at enqueue time) to accept ids
from prior cycles. This is the type-level guard whose absence
caused the May 2026 prod failure (ADR 0001 §1.1):

1. ``requires_action`` arrives carrying ids ``[sevt_NEW_A, sevt_NEW_B]``.
2. v1's local buffer is stale; the rehydrate path pulls prior-turn
   ids in from ``events.list``.
3. v1 sends ``user.custom_tool_result`` for the prior-turn ids.
4. The next ``events.send`` 400s on the *new* still-pending ids.

v2 eliminates the path:

- ``calls()`` resolves the requested ids against the in-stream
  ``events_by_id`` map. A missing id raises
  :class:`MissingPendingToolCallError` — the caller catches, POSTs
  ``user.interrupt``, and yields ``AgentFinish(error)``. There is no
  fall-back to ``events.list``.
- ``send_replies()`` validates every reply's id against
  ``requested_ids`` BEFORE the POST. Mismatch raises
  :class:`OutOfCycleReplyError`. Anthropic's 400 envelope-mismatch
  validator is no longer the first detection layer.

The class also distinguishes :class:`anthropic.BadRequestError` from
transient 5xx on the POST path: :class:`BadRequestError` is terminal
for the session (the server's view of "pending" is what's wrong, not
the network), so the caller propagates it as ``AgentFinish(error)``.
Transient 5xx remains out of scope for Phase 1 (ADR 0001 §8 Decision 8).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, List, Optional

from copass_anthropic_agents.backends.pending_tool_call import PendingToolCall

if TYPE_CHECKING:
    # Lazy / typing-only import: library adopters who don't install the
    # Anthropic SDK should not crash at module load.
    from anthropic import AsyncAnthropic  # noqa: F401

logger = logging.getLogger(__name__)


class MissingPendingToolCallError(LookupError):
    """A ``requires_action.event_id`` was not in ``events_by_id``.

    Inherits from :class:`LookupError` so consumers catching the broad
    family still trap it, but defines its own class so the v2 backend
    can pattern-match on the specific failure to fire ``user.interrupt``
    rather than swallow the broader category.
    """

    def __init__(self, missing_ids: List[str], known_ids: List[str]) -> None:
        self.missing_ids = list(missing_ids)
        self.known_ids = list(known_ids)
        super().__init__(
            f"RequiresActionCycle: event_id(s) {self.missing_ids!r} not in "
            f"buffered events {self.known_ids!r}. The SSE stream did not "
            "surface these tool-use events before the requires_action "
            "envelope arrived; rehydrate-from-log is not a valid recovery "
            "path during a live stream (ADR 0001 Decision 2)."
        )


class OutOfCycleReplyError(ValueError):
    """A reply envelope's id was not in this cycle's ``requested_ids``.

    The structural guarantee Decision 2 calls out: replies for ids
    from a prior cycle cannot reach ``events.send``. This is the
    exception the cycle raises when a caller tries.
    """

    def __init__(self, reply_id: str, requested_ids: List[str]) -> None:
        self.reply_id = reply_id
        self.requested_ids = list(requested_ids)
        super().__init__(
            f"RequiresActionCycle: reply id {reply_id!r} is not in this "
            f"cycle's requested_ids {self.requested_ids!r}. Replies for "
            "ids from prior cycles cannot be sent (ADR 0001 Decision 2)."
        )


def _reply_id(reply: dict) -> Optional[str]:
    """Extract the tool-use id from a reply envelope, regardless of
    envelope shape.

    ``user.custom_tool_result`` carries the id as ``custom_tool_use_id``;
    ``user.tool_confirmation`` carries it as ``tool_use_id``. The
    cycle's barrier check has to know about both — they're the same
    logical id under two different field names.
    """
    if "custom_tool_use_id" in reply:
        return reply["custom_tool_use_id"]
    if "tool_use_id" in reply:
        return reply["tool_use_id"]
    return None


@dataclass
class RequiresActionCycle:
    """One ``requires_action`` round — scoped to the ids the server requested.

    Attributes:
        cycle_id: Stable id for the cycle (typically the
            ``requires_action`` envelope's own id, so log lines correlate
            with the SDK event stream).
        requested_ids: Server-authoritative set of ``sevt_*`` ids the
            session is waiting on. Frozen at construction.
        executed_ids: Ids we have constructed-and-sent a reply for in
            this cycle. Mutated during the cycle as
            :meth:`send_replies` accepts each envelope.
    """

    cycle_id: str
    requested_ids: frozenset[str]
    executed_ids: set[str] = field(default_factory=set)

    def calls(
        self, events_by_id: dict[str, PendingToolCall]
    ) -> List[PendingToolCall]:
        """Resolve ``requested_ids`` against the SSE stream's local
        buffer.

        Returns the resolved :class:`PendingToolCall` list in the
        original ``requested_ids`` iteration order. Raises
        :class:`MissingPendingToolCallError` if any id is not in
        ``events_by_id`` — the caller is expected to POST
        ``user.interrupt`` and yield ``AgentFinish(error)``.

        Never calls ``events.list``. There is no rehydrate path during
        a live stream (ADR 0001 Decision 2).
        """
        missing = [eid for eid in self.requested_ids if eid not in events_by_id]
        if missing:
            raise MissingPendingToolCallError(
                missing_ids=missing,
                known_ids=list(events_by_id.keys()),
            )
        # Iterate ``requested_ids`` (server-authoritative ordering).
        # ``frozenset`` order is unstable across CPython runs; sort for
        # deterministic test output. Anthropic does not require a
        # specific reply order — the API correlates by id.
        return [events_by_id[eid] for eid in sorted(self.requested_ids)]

    async def send_replies(
        self,
        client: "AsyncAnthropic",
        session_id: str,
        replies: List[dict],
    ) -> None:
        """POST ``replies`` to ``events.send`` for this cycle's session.

        Validates every reply's id against ``requested_ids`` BEFORE the
        POST — out-of-cycle ids raise :class:`OutOfCycleReplyError`
        rather than reach the server. On success, records each id in
        ``executed_ids``.

        :class:`anthropic.BadRequestError` propagates to the caller —
        Phase 1 caller (the v2 backend) catches and emits
        ``AgentFinish(error)``. Transient 5xx is not specially handled
        in Phase 1 (ADR 0001 §8 Decision 8).
        """
        for reply in replies:
            rid = _reply_id(reply)
            if rid is None or rid not in self.requested_ids:
                raise OutOfCycleReplyError(
                    reply_id=str(rid),
                    requested_ids=list(self.requested_ids),
                )

        # All replies validated. Single ``events.send`` for the batch
        # — the API accepts an array, and a single POST is the only
        # way to keep the cycle atomic from the server's perspective
        # (a partial reply set leaves the session pending).
        await client.beta.sessions.events.send(session_id, events=replies)

        for reply in replies:
            rid = _reply_id(reply)
            if rid is not None:
                self.executed_ids.add(rid)


def is_cycle_complete(cycle: RequiresActionCycle) -> bool:
    """Convenience: every requested id has been replied to."""
    return cycle.executed_ids >= cycle.requested_ids


__all__ = [
    "RequiresActionCycle",
    "MissingPendingToolCallError",
    "OutOfCycleReplyError",
    "is_cycle_complete",
]
