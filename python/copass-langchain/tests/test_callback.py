"""CopassWindowCallback — message → turn translation + dedup."""

from __future__ import annotations

import asyncio
from typing import List

import pytest
from copass_core import ChatMessage
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from uuid import uuid4

from copass_langchain import CopassWindowCallback


class _Window:
    """Minimal ContextWindowLike stub — captures add_turn calls."""

    def __init__(self, initial: List[ChatMessage] = None) -> None:
        self._turns = list(initial or [])
        self.added: List[ChatMessage] = []

    def get_turns(self) -> List[ChatMessage]:
        return list(self._turns)

    async def add_turn(self, turn: ChatMessage) -> None:
        self.added.append(turn)
        self._turns.append(turn)


async def _trigger(cb: CopassWindowCallback, messages: List[List]) -> None:
    await cb.on_chat_model_start(
        serialized={},
        messages=messages,
        run_id=uuid4(),
    )
    # Callback schedules fire-and-forget tasks; yield so they run.
    await asyncio.sleep(0)
    await asyncio.sleep(0)


async def test_mirrors_human_and_ai_messages() -> None:
    w = _Window()
    cb = CopassWindowCallback(window=w)
    await _trigger(
        cb,
        [
            [
                HumanMessage(content="hello"),
                AIMessage(content="hi there"),
            ]
        ],
    )
    roles = [t.role for t in w.added]
    contents = [t.content for t in w.added]
    assert roles == ["user", "assistant"]
    assert contents == ["hello", "hi there"]


async def test_deduplicates_previously_seen_turns() -> None:
    existing = [ChatMessage(role="user", content="hello")]
    w = _Window(initial=existing)
    cb = CopassWindowCallback(window=w)
    await _trigger(
        cb,
        [
            [
                HumanMessage(content="hello"),  # already in window → skip
                AIMessage(content="hi there"),  # new
            ]
        ],
    )
    assert [t.role for t in w.added] == ["assistant"]


async def test_skips_tool_messages_by_default() -> None:
    w = _Window()
    cb = CopassWindowCallback(window=w)
    await _trigger(
        cb,
        [
            [
                HumanMessage(content="query"),
                ToolMessage(content="tool output", tool_call_id="t1"),
            ]
        ],
    )
    assert [t.role for t in w.added] == ["user"]


async def test_includes_tool_messages_when_opted_in() -> None:
    w = _Window()
    cb = CopassWindowCallback(window=w, include_tool_messages=True)
    await _trigger(
        cb,
        [
            [
                HumanMessage(content="query"),
                ToolMessage(content="tool output", tool_call_id="t1"),
            ]
        ],
    )
    assert [t.role for t in w.added] == ["user", "system"]


async def test_skips_empty_content() -> None:
    w = _Window()
    cb = CopassWindowCallback(window=w)
    await _trigger(
        cb,
        [
            [
                HumanMessage(content=""),
                HumanMessage(content="   "),
                SystemMessage(content="you are helpful"),
            ]
        ],
    )
    assert [t.role for t in w.added] == ["system"]


async def test_content_parts_list_concatenated() -> None:
    w = _Window()
    cb = CopassWindowCallback(window=w)
    multi = HumanMessage(
        content=[
            {"type": "text", "text": "first line"},
            {"type": "text", "text": "second line"},
        ]
    )
    await _trigger(cb, [[multi]])
    assert len(w.added) == 1
    assert "first line" in w.added[0].content
    assert "second line" in w.added[0].content


async def test_swallows_add_turn_errors() -> None:
    class _FailingWindow:
        def get_turns(self) -> List[ChatMessage]:
            return []

        async def add_turn(self, turn: ChatMessage) -> None:
            raise RuntimeError("graph write failed")

    cb = CopassWindowCallback(window=_FailingWindow())
    # Should NOT raise even though add_turn raises internally.
    await _trigger(
        cb,
        [[HumanMessage(content="hello")]],
    )
