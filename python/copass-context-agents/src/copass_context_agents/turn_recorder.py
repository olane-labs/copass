"""CopassTurnRecorder — mirror agent turns into a Copass Context Window.

Python analogue of the TypeScript ``CopassWindowCallback``
(``typescript/packages/langchain/src/callback.ts``). Fire-and-forget
recorder for ``user`` / ``assistant`` turns emitted by provider
backends' :class:`AgentEvent` streams (Anthropic
:class:`ManagedAgentBackend`, Google :class:`GoogleAgentBackend`, …).

Event-driven: pass each event to :meth:`record_event`, or wrap the
stream with :meth:`record_stream` for a drop-in ``async for``.

Deduplication: ``role + sha256(content[:500])`` — stable across
restarts so an existing window's pre-seeded turns don't get
re-recorded.

Assistant-turn coalescing: :class:`AgentTextDelta` events are
buffered; one LLM response becomes one ``assistant`` turn in the
window, not N partial deltas. Flushes on :class:`AgentFinish` or when
the next user turn arrives.

Latency: pushes to the Context Window run in the background via
``asyncio.create_task``, so the agent loop never blocks on the ingest
HTTP round-trip (~100–300 ms/call). Pending tasks are tracked on
``self._pending_pushes``; call :meth:`flush` at end-of-session to
guarantee no turn is dropped. :meth:`record_stream` handles the flush
in its ``finally`` block, so the default path through a provider's
``stream()`` override is leak-free without user work.

Provenance: ``copass_core.types.ChatMessage`` carries an optional
``name`` field (ADR 0022). Pass ``author=...`` to record assistant
turns with that name; the recorder forwards it as
``ChatMessage.name`` so the underlying ``ContextWindow`` lifts it
onto the ingest envelope's ``speaker`` field. The legacy
``include_author_prefix`` flag (which used to embed
``"[author=...]\\n"`` into ``content``) still works for
backward compat but is deprecated — prefer the typed ``author``
path which keeps the body clean and the speaker structured.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import AsyncIterator, Optional

from copass_core.context_window import ContextWindow
from copass_core.types import ChatMessage
from copass_core_agents.events import (
    AgentEvent,
    AgentFinish,
    AgentTextDelta,
    AgentToolCall,
    AgentToolResult,
)

logger = logging.getLogger(__name__)


class CopassTurnRecorder:
    """Push agent turns into a Copass :class:`ContextWindow`.

    Args:
        window: The :class:`ContextWindow` to mirror turns into.
        include_tool_events: When True, record ``AgentToolCall`` /
            ``AgentToolResult`` as ``system`` turns. Default False —
            tool output is noisy and the retrieval graph already
            indexes the underlying content, so recording it would
            double-count.
        author: Optional identifier for whoever is running the agent
            (``"agent"``, ``"user"``, or something richer like
            ``"agent:support-bot"``). Recorded on assistant turns as
            ``ChatMessage.name`` (ADR 0022); the underlying
            :class:`ContextWindow` forwards it as the envelope's
            ``speaker`` field. When ``include_author_prefix`` is True,
            also embedded as a legacy ``"[author=...]\\n"`` prefix in
            ``content`` for backward compat with consumers that read
            the body string directly.
        include_author_prefix: Deprecated. When True, assistant turns
            are stored as ``"[author=...]\\n<content>"`` in the body
            in addition to the typed ``ChatMessage.name`` carry. Off
            by default — the typed envelope path is preferred and the
            prefix marginally pollutes the embedding.
    """

    def __init__(
        self,
        *,
        window: ContextWindow,
        include_tool_events: bool = False,
        author: Optional[str] = None,
        include_author_prefix: bool = False,
    ) -> None:
        self._window = window
        self._include_tool_events = include_tool_events
        self._author = author
        self._include_author_prefix = include_author_prefix
        self._seen: set[str] = set()
        self._pending_assistant_text: list[str] = []
        self._pending_pushes: set[asyncio.Task] = set()

        # Seed dedupe set with whatever turns the window already has,
        # so resuming a conversation doesn't double-record.
        for turn in window.get_turns():
            self._seen.add(self._dedupe_key(turn))

    # ── Public recording API ───────────────────────────────────────

    async def record_user(self, content: str) -> None:
        """Record a user turn. Drops empty content. Flushes any
        in-flight assistant text first — a new user turn finalizes
        the prior assistant response."""
        await self._flush_assistant()
        await self._record(ChatMessage(role="user", content=content))

    async def record_assistant_delta(self, text: str) -> None:
        """Buffer an assistant text delta. Flushed by
        :meth:`flush_assistant`, :meth:`record_event` (on
        :class:`AgentFinish`), or :meth:`record_user`."""
        if text:
            self._pending_assistant_text.append(text)

    async def flush_assistant(self) -> None:
        """Coalesce buffered deltas into one assistant turn."""
        await self._flush_assistant()

    async def record_event(self, event: AgentEvent) -> None:
        """Ingest one :class:`AgentEvent`. Convenience for drivers
        that already iterate over the backend's event stream."""
        if isinstance(event, AgentTextDelta):
            await self.record_assistant_delta(event.text)
        elif isinstance(event, AgentFinish):
            await self._flush_assistant()
        elif isinstance(event, AgentToolCall):
            if self._include_tool_events:
                await self._record(
                    ChatMessage(
                        role="system",
                        content=f"[tool_call name={event.name!r} args={event.arguments!r}]",
                    )
                )
        elif isinstance(event, AgentToolResult):
            if self._include_tool_events:
                await self._record(
                    ChatMessage(
                        role="system",
                        content=(
                            f"[tool_result name={event.name!r} "
                            f"result={event.result!r}]"
                        ),
                    )
                )

    async def record_stream(
        self, stream: AsyncIterator[AgentEvent]
    ) -> AsyncIterator[AgentEvent]:
        """Wrap a backend event stream — records every event and
        re-yields it unchanged. Drop-in for existing ``async for``
        loops::

            async for evt in recorder.record_stream(agent.stream(...)):
                ...

        Awaits :meth:`flush` in a ``finally`` block so pending
        background pushes complete before the wrapper returns.
        Callers that drive events through :meth:`record_event`
        directly (without going through this wrapper) must call
        ``await recorder.flush()`` themselves at end-of-session.
        """
        try:
            async for event in stream:
                await self.record_event(event)
                yield event
        finally:
            await self.flush()

    async def flush(self) -> None:
        """Await every in-flight ingestion task. Call at
        end-of-session to guarantee no turn is dropped. Idempotent;
        safe to call even when nothing is pending."""
        pending = list(self._pending_pushes)
        if not pending:
            return
        await asyncio.gather(*pending, return_exceptions=True)

    # ── Internals ─────────────────────────────────────────────────

    async def _flush_assistant(self) -> None:
        if not self._pending_assistant_text:
            return
        text = "".join(self._pending_assistant_text).strip()
        self._pending_assistant_text.clear()
        if not text:
            return
        # Legacy [author=...] prefix kept opt-in for body-reading
        # consumers; the typed `name` field below is the preferred
        # carrier and is always set when `author` is provided
        # (ADR 0022).
        if self._include_author_prefix and self._author:
            text = f"[author={self._author}]\n{text}"
        await self._record(
            ChatMessage(
                role="assistant",
                content=text,
                name=self._author,
            )
        )

    async def _record(self, turn: ChatMessage) -> None:
        if not turn.content.strip():
            return
        key = self._dedupe_key(turn)
        if key in self._seen:
            return
        self._seen.add(key)
        # Fire the push in the background so the agent loop doesn't
        # pay ingestion latency (~100–300 ms) on every turn. Failures
        # are logged inside ``_push``; callers can await
        # :meth:`flush` to observe completion.
        task = asyncio.create_task(self._push(turn))
        self._pending_pushes.add(task)
        task.add_done_callback(self._pending_pushes.discard)

    async def _push(self, turn: ChatMessage) -> None:
        try:
            await self._window.add_turn(turn)
        except Exception as err:
            logger.warning(
                "CopassTurnRecorder: add_turn failed (dropping turn)",
                extra={"error": str(err), "role": turn.role},
            )

    @staticmethod
    def _dedupe_key(turn: ChatMessage) -> str:
        body = turn.content[:500].encode("utf-8", errors="replace")
        digest = hashlib.sha256(body).hexdigest()[:16]
        return f"{turn.role}:{digest}"


__all__ = ["CopassTurnRecorder"]
