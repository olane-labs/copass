"""Retrieval resource — ``discover`` / ``interpret`` / ``search``.

Hand-ported from ``typescript/packages/core/src/resources/retrieval.ts``.

All three accept either a ``window`` (a :class:`WindowLike` — typically
a ``ContextWindow``) or a raw ``history`` list. When ``window`` is set
it wins and ``history`` is ignored. Server caps at 20 turns.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Dict, List, Optional

from copass_core.resources.base import BaseResource
from copass_core.types import ChatMessage, SearchPreset, WindowLike


def _turns_from(window: Optional[WindowLike]) -> List[Dict[str, str]]:
    if window is None:
        return []
    turns = window.get_turns()
    if not turns:
        return []
    return [_turn_to_dict(t) for t in turns]


def _turn_to_dict(turn: Any) -> Dict[str, str]:
    """Accept either a :class:`ChatMessage` dataclass or a plain dict
    (``{"role": ..., "content": ...}``) so callers can mix and match."""
    if isinstance(turn, ChatMessage):
        return {"role": turn.role, "content": turn.content}
    if isinstance(turn, dict) and "role" in turn and "content" in turn:
        return {"role": str(turn["role"]), "content": str(turn["content"])}
    raise ValueError(
        f"Unexpected turn type {type(turn).__name__}; expected ChatMessage or dict."
    )


def _history(
    window: Optional[WindowLike],
    history: Optional[List[Any]],
) -> List[Dict[str, str]]:
    """``window`` wins; fall back to ``history``; empty list if both None."""
    if window is not None:
        return _turns_from(window)
    if history:
        return [_turn_to_dict(t) for t in history]
    return []


class RetrievalResource(BaseResource):
    """``/api/v1/query/sandboxes/{sandbox_id}/{discover,interpret,search}``."""

    async def discover(
        self,
        sandbox_id: str,
        *,
        query: str,
        window: Optional[WindowLike] = None,
        history: Optional[List[Any]] = None,
        project_id: Optional[str] = None,
        reference_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Ranked menu of context items relevant to ``query``.

        Window-aware: repeated calls skip items already surfaced
        earlier in the conversation.
        """
        body: Dict[str, Any] = {
            "query": query,
            "history": _history(window, history),
        }
        if project_id is not None:
            body["project_id"] = project_id
        if reference_date is not None:
            body["reference_date"] = reference_date
        return await self._post(
            f"/api/v1/query/sandboxes/{sandbox_id}/discover",
            body,
        )

    async def interpret(
        self,
        sandbox_id: str,
        *,
        query: str,
        items: List[List[str]],
        window: Optional[WindowLike] = None,
        history: Optional[List[Any]] = None,
        project_id: Optional[str] = None,
        reference_date: Optional[str] = None,
        preset: Optional[SearchPreset] = None,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Synthesized 1–2 paragraph brief pinned to specific
        ``items`` picked from a prior ``discover`` call."""
        body: Dict[str, Any] = {
            "query": query,
            "items": items,
            "history": _history(window, history),
        }
        if project_id is not None:
            body["project_id"] = project_id
        if reference_date is not None:
            body["reference_date"] = reference_date
        if preset is not None:
            body["preset"] = preset
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        return await self._post(
            f"/api/v1/query/sandboxes/{sandbox_id}/interpret",
            body,
        )

    async def search(
        self,
        sandbox_id: str,
        *,
        query: str,
        window: Optional[WindowLike] = None,
        history: Optional[List[Any]] = None,
        project_id: Optional[str] = None,
        reference_date: Optional[str] = None,
        preset: Optional[SearchPreset] = None,
        detail_level: Optional[str] = None,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """One-shot synthesized natural-language answer."""
        body: Dict[str, Any] = {
            "query": query,
            "history": _history(window, history),
        }
        if project_id is not None:
            body["project_id"] = project_id
        if reference_date is not None:
            body["reference_date"] = reference_date
        if preset is not None:
            body["preset"] = preset
        if detail_level is not None:
            body["detail_level"] = detail_level
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        return await self._post(
            f"/api/v1/query/sandboxes/{sandbox_id}/search",
            body,
        )


__all__ = ["RetrievalResource"]
