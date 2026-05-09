"""Tests for the ADR 0022 audit-fix changes to ``CopassTurnRecorder``:

- Default ``participants`` roster derived from ``author``.
- Explicit empty list opts out of participants.
- Recorded user turns carry ``ChatMessage.name`` so the envelope's
  ``speaker`` field is populated symmetrically with assistant turns.
"""

from __future__ import annotations

from typing import List, Optional

import pytest
from copass_core.types import ChatMessage

from copass_context_agents.turn_recorder import CopassTurnRecorder


class _FakeWindow:
    """Stand-in for ``ContextWindow`` capturing add_turn calls."""

    def __init__(self) -> None:
        self.calls: List[tuple[ChatMessage, Optional[List[str]]]] = []

    def get_turns(self) -> list[ChatMessage]:
        return []

    async def add_turn(
        self,
        turn: ChatMessage,
        *,
        participants: Optional[List[str]] = None,
    ) -> None:
        self.calls.append((turn, participants))


@pytest.mark.asyncio
async def test_default_participants_when_author_set() -> None:
    win = _FakeWindow()
    recorder = CopassTurnRecorder(window=win, author="support-bot")
    assert recorder._participants == ["User", "support-bot"]


@pytest.mark.asyncio
async def test_default_participants_when_author_absent() -> None:
    win = _FakeWindow()
    recorder = CopassTurnRecorder(window=win)
    assert recorder._participants == ["User", "Assistant"]


@pytest.mark.asyncio
async def test_explicit_empty_participants_opts_out() -> None:
    """Caller passes ``participants=[]`` to opt out — no roster set."""
    win = _FakeWindow()
    recorder = CopassTurnRecorder(window=win, author="bot", participants=[])
    assert recorder._participants is None


@pytest.mark.asyncio
async def test_explicit_participants_override_default() -> None:
    win = _FakeWindow()
    recorder = CopassTurnRecorder(
        window=win, author="bot", participants=["Alice", "bot", "system"],
    )
    assert recorder._participants == ["Alice", "bot", "system"]


@pytest.mark.asyncio
async def test_record_user_carries_name_as_speaker() -> None:
    """User turns get ``ChatMessage.name = user_speaker`` so the
    envelope's speaker field is populated (no role-derived fallback
    quirks). Default user_speaker = "User".
    """
    win = _FakeWindow()
    recorder = CopassTurnRecorder(window=win, author="bot")
    await recorder.record_user("hello")
    # Wait for the background task to land.
    await recorder.flush()

    assert len(win.calls) == 1
    turn, participants = win.calls[0]
    assert turn.role == "user"
    assert turn.content == "hello"
    assert turn.name == "User"
    assert participants == ["User", "bot"]


@pytest.mark.asyncio
async def test_custom_user_speaker() -> None:
    win = _FakeWindow()
    recorder = CopassTurnRecorder(
        window=win, author="bot", user_speaker="Alice",
    )
    await recorder.record_user("hi")
    await recorder.flush()

    turn, participants = win.calls[0]
    assert turn.name == "Alice"
    assert participants == ["Alice", "bot"]


@pytest.mark.asyncio
async def test_legacy_author_prefix_off_by_default() -> None:
    """Audit fix: agents should NOT set include_author_prefix=True
    automatically. Verifies the recorder default keeps the body
    clean — the `[author=...]\\n` prefix is opt-in, not default-on.
    """
    win = _FakeWindow()
    recorder = CopassTurnRecorder(window=win, author="bot")
    # Simulate an assistant flush via the public buffer + flush.
    await recorder.record_assistant_delta("an assistant reply")
    await recorder.flush_assistant()
    await recorder.flush()

    assert len(win.calls) == 1
    turn, _ = win.calls[0]
    assert "[author=" not in turn.content
    # But the typed envelope path is populated.
    assert turn.name == "bot"
