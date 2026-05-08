"""Context Window — agent conversation as an ephemeral data source.

Port of ``typescript/packages/core/src/context-window/`` — combines
``context-window.ts``, ``resource.ts``, and ``types.ts`` into a single
module (Python doesn't need the TS split).

Each :meth:`ContextWindow.add_turn` call appends to a local buffer
AND pushes through the underlying ``DataSource`` so the thread itself
becomes retrievable. Pass the window to any ``client.retrieval.*``
call to get window-aware retrieval without hand-managing ``history``.

Construct via :meth:`ContextWindowResource.create` for a fresh
thread or :meth:`ContextWindowResource.attach` to resume an existing
one.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from copass_core.data_sources import BaseDataSource
from copass_core.types import ChatMessage

if TYPE_CHECKING:
    from copass_core.client import CopassClient


def _capitalize_role(role: str) -> str:
    if not role:
        return role
    return role[0].upper() + role[1:]


class ContextWindow(BaseDataSource):
    """An agent's conversation wrapped as an ephemeral data source.

    Satisfies ``WindowLike`` (``get_turns()``) so the
    ``RetrievalResource`` accepts it directly as a ``window=`` arg.
    """

    def __init__(
        self,
        *,
        client: "CopassClient",
        sandbox_id: str,
        data_source_id: str,
        project_id: Optional[str] = None,
        initial_turns: Optional[List[ChatMessage]] = None,
    ) -> None:
        super().__init__(
            client=client,
            sandbox_id=sandbox_id,
            data_source_id=data_source_id,
            project_id=project_id,
        )
        self._turns: List[ChatMessage] = list(initial_turns or [])

    async def add_turn(self, turn: ChatMessage) -> None:
        """Append a turn and push it through the underlying data
        source.

        Awaits the push so ingestion failures surface at the call
        site. Callers wanting fire-and-forget can wrap in
        ``asyncio.create_task``.

        The turn's ``name`` (if set) is forwarded as the envelope's
        ``speaker`` field; absent ``name`` falls back to the
        capitalized ``role`` (``"user"`` → ``"User"``,
        ``"assistant"`` → ``"Assistant"``). The
        ``f"{turn.role}: {turn.content}"`` content-prefix munging the
        prior version used has been retired — the wire body is now
        the message ``content`` verbatim, with ``speaker`` riding on
        the envelope.
        """
        self._turns.append(turn)
        speaker = turn.name if turn.name else _capitalize_role(turn.role)
        await self.push(
            turn.content,
            source_type="conversation",
            speaker=speaker,
        )

    def get_turns(self) -> List[ChatMessage]:
        """Defensive copy of the turn log — callers can't mutate
        internal state."""
        return list(self._turns)

    async def close(self) -> None:
        """Mark the underlying source as disconnected. Idempotent on
        the server."""
        await self.disconnect()


class ContextWindowResource:
    """Factory for :class:`ContextWindow` instances.

    Accessed via ``client.context_window``. :meth:`create` registers
    a new ephemeral data source and returns a window bound to it;
    :meth:`attach` rehydrates a window against an existing
    ``data_source_id``.
    """

    def __init__(self, client: "CopassClient") -> None:
        self._client = client

    async def create(
        self,
        *,
        sandbox_id: str,
        project_id: Optional[str] = None,
        name: Optional[str] = None,
    ) -> ContextWindow:
        """Register a fresh ephemeral data source and return a window
        bound to it."""
        source_name = name if name is not None else f"window-{int(time.time() * 1000)}"
        source = await self._client.sources.register(
            sandbox_id,
            provider="custom",
            name=source_name,
            ingestion_mode="manual",
            kind="ephemeral",
        )
        return ContextWindow(
            client=self._client,
            sandbox_id=sandbox_id,
            data_source_id=source["data_source_id"],
            project_id=project_id,
        )

    async def attach(
        self,
        *,
        sandbox_id: str,
        data_source_id: str,
        project_id: Optional[str] = None,
        initial_turns: Optional[List[ChatMessage]] = None,
    ) -> ContextWindow:
        """Reattach to an existing source — typically one the caller
        persisted after an earlier :meth:`create`.
        """
        source = await self._client.sources.retrieve(sandbox_id, data_source_id)
        return ContextWindow(
            client=self._client,
            sandbox_id=sandbox_id,
            data_source_id=source["data_source_id"],
            project_id=project_id,
            initial_turns=initial_turns,
        )


__all__ = ["ContextWindow", "ContextWindowResource"]
