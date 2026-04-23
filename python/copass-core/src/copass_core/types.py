"""Shared value types for the Copass Python client.

Hand-ported from ``typescript/packages/core/src/types/common.ts`` and
the retrieval/context subsets actually needed by v0.1.0 consumers.
Richer resource-specific types land incrementally as more resources
are ported.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Literal, Optional, Protocol


BackoffStrategy = Literal["exponential", "linear", "fixed"]


@dataclass(frozen=True)
class RetryConfig:
    """Retry configuration for transient HTTP failures.

    Attributes:
        max_attempts: Max total attempts (including the first). Default 3.
        backoff_base_ms: Base delay in milliseconds.
        backoff_strategy: ``"exponential"`` (2^attempt * base),
            ``"linear"`` ((attempt + 1) * base), or ``"fixed"`` (base).
    """

    max_attempts: int = 3
    backoff_base_ms: int = 1000
    backoff_strategy: BackoffStrategy = "exponential"


ChatRole = Literal["user", "assistant", "system"]


@dataclass(frozen=True)
class ChatMessage:
    """One chat turn. Mirrors the TS ``ChatMessage``."""

    role: ChatRole
    content: str


class WindowLike(Protocol):
    """Structural contract the retrieval resource accepts in place of a
    raw ``history`` list. Any object with a ``get_turns()`` method
    returning a list of :class:`ChatMessage` satisfies this.

    Mirrors the TS ``WindowLike`` interface — the Python
    ``ContextWindow`` class (v0.2) will satisfy this protocol.
    """

    def get_turns(self) -> List[ChatMessage]: ...


SearchPreset = Literal[
    "fast",
    "auto",
    "discover",
    "sql",
    "max",
    "fast-decompose",
    "auto-decompose",
    "discover-decompose",
    "sql-decompose",
]


__all__ = [
    "BackoffStrategy",
    "RetryConfig",
    "ChatRole",
    "ChatMessage",
    "WindowLike",
    "SearchPreset",
]
