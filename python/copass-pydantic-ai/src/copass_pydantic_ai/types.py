"""Shared types for the Copass Pydantic AI adapter."""

from __future__ import annotations

from typing import Literal, Protocol, runtime_checkable

SearchPreset = Literal[
    "copass/1.0",
    "copass/2.0",
    "copass/1.0:thinking",
    "copass/2.0:thinking",
]


@runtime_checkable
class WindowLike(Protocol):
    """Structural contract for a conversation window.

    Matches the TypeScript ``WindowLike`` shape from ``@copass/core`` —
    any object with a ``get_turns()`` method returning an iterable of
    ``{"role": str, "content": str}`` dicts.
    """

    def get_turns(self) -> list[dict[str, str]]:  # noqa: D401 - protocol method
        ...
