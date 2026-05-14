"""Stream-event-type membership constants for the managed-agents SSE loop.

Pure constants extracted so v1 and v2 stream parsers cannot drift on
which SDK-vs-thread-scoped envelope names are recognized for lifecycle
control flow. v1 currently retains its own inline copies (PR-B does
not cross-cut v1); a follow-up cleanup can redirect v1 to import from
here. v2 imports these directly.

The three sets cover:

- :data:`_IDLE_EVENT_TYPES`: envelope names that surface the
  ``stop_reason`` block carrying ``requires_action`` / ``end_turn``.
- :data:`_TERMINATED_EVENT_TYPES`: terminal envelopes the stream
  emits when the session is shut down externally.
- :data:`_KNOWN_NOOP_EVENT_TYPES`: lifecycle / observability events
  the stream emits that do NOT drive control flow. Explicit allowlist
  so the catch-all "unknown event type" warning is reserved for
  genuine schema drift.
"""

from __future__ import annotations


# Anthropic has been migrating session lifecycle from session-scoped to
# thread-scoped envelopes (``session.thread_status_idle`` etc.) ahead of the
# Python SDK's release cadence. Treat the new names as aliases of the SDK
# constants so we don't silently miss the requires_action signal — that's
# what stranded sessions in May 2026 incidents (sevt_ ids pending forever).
_IDLE_EVENT_TYPES = frozenset({
    "session.status_idle",
    "session.thread_status_idle",
})


_TERMINATED_EVENT_TYPES = frozenset({
    "session.status_terminated",
    "session.thread_status_terminated",
})


# Lifecycle / observability events that don't drive control flow. Listed so
# the catch-all "unknown event type" warning doesn't fire on every session
# — that warning is reserved for genuine schema drift we should investigate.
# Includes server echoes of events we sent (``user.*``), since the SDK
# replays them on the same stream.
_KNOWN_NOOP_EVENT_TYPES = frozenset({
    "session.status_running",
    "session.status_rescheduled",
    "session.deleted",
    "session.thread_status_running",
    "user.message",
    "user.custom_tool_result",
    "user.tool_confirmation",
    "user.tool_result",
    "user.interrupt",
    "agent.thinking",
    "agent.thread_context_compacted",
    "agent.tool_result",
    "agent.mcp_tool_result",
    "span.model_request_start",
})


__all__ = [
    "_IDLE_EVENT_TYPES",
    "_TERMINATED_EVENT_TYPES",
    "_KNOWN_NOOP_EVENT_TYPES",
]
