"""Structural types local to ``copass-langchain``.

Kept here (rather than in ``copass-core``) because they shim a
behavior ``copass-core`` v0.1.0 hasn't shipped yet —
``ContextWindow.add_turn(...)``. Once ``copass-core`` v0.2 ports the
``ContextWindow`` primitive from TS, the real class will satisfy this
protocol and this shim disappears.
"""

from __future__ import annotations

from typing import Awaitable, List, Protocol, runtime_checkable

from copass_core import ChatMessage


@runtime_checkable
class ContextWindowLike(Protocol):
    """Minimum surface ``CopassWindowCallback`` + ``copass_tools``
    need from a "window" object.

    A future ``copass-core.ContextWindow`` will satisfy this directly.
    Callers holding any other turn-log structure can supply an adapter
    that exposes these two methods.
    """

    def get_turns(self) -> List[ChatMessage]: ...

    def add_turn(self, turn: ChatMessage) -> Awaitable[None]: ...


__all__ = ["ContextWindowLike"]
