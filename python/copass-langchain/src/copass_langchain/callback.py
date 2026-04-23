"""LangChain callback that mirrors chat-model messages into a Copass
Context Window.

Python mirror of
``typescript/packages/langchain/src/callback.ts``. Hooks
``on_chat_model_start`` (fired by every chat-model invocation with
the full message history) and walks messages, calling ``add_turn`` on
the window for any message we haven't seen before. Retrieval tools
invoked inside the same agent step then see a window that reflects
the actual conversation, not an empty buffer.

Works against any object satisfying :class:`ContextWindowLike` — the
v0.2 ``copass-core.ContextWindow`` will slot in without changes.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Set
from uuid import UUID

from copass_core import ChatMessage, ChatRole
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from copass_langchain.types import ContextWindowLike


class CopassWindowCallback(BaseCallbackHandler):
    """Auto-mirror a chat model's conversation into a Copass
    :class:`ContextWindowLike`.

    Usage::

        from copass_langchain import CopassWindowCallback
        agent = create_react_agent(llm=..., tools=...)
        await agent.ainvoke(
            {"messages": [...]},
            config={"callbacks": [CopassWindowCallback(window=window)]},
        )

    ``include_tool_messages`` defaults to ``False``. Tool results tend
    to be noisy; enable only if your agent's tool outputs carry
    conceptual content you want retrieval to dedupe against.
    """

    name = "copass-window"

    def __init__(
        self,
        *,
        window: ContextWindowLike,
        include_tool_messages: bool = False,
    ) -> None:
        super().__init__()
        self._window = window
        self._include_tool_messages = include_tool_messages
        self._seen: Set[str] = {
            _hash_turn(turn) for turn in window.get_turns()
        }

    async def on_chat_model_start(
        self,
        serialized: Dict[str, Any],
        messages: List[List[BaseMessage]],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Fires before every chat model call. ``messages`` is
        ``List[List[BaseMessage]]`` for batched-call support; in
        single-agent loops it's always one conversation."""
        flat: List[BaseMessage] = []
        for conversation in messages:
            flat.extend(conversation)

        for msg in flat:
            turn = _to_turn(msg, self._include_tool_messages)
            if turn is None:
                continue

            key = _hash_turn(turn)
            if key in self._seen:
                continue
            self._seen.add(key)

            # Fire-and-forget. We don't block the model call on
            # ingestion latency; missing a turn is recoverable
            # (retrieval still sees already-added turns).
            asyncio.create_task(_safe_add_turn(self._window, turn))


async def _safe_add_turn(window: ContextWindowLike, turn: ChatMessage) -> None:
    try:
        await window.add_turn(turn)
    except Exception:  # noqa: BLE001 — swallowed intentionally.
        # Ingestion is best-effort. Future releases may surface via
        # an optional ``on_error`` callback.
        pass


def _to_turn(msg: BaseMessage, include_tool_messages: bool) -> Optional[ChatMessage]:
    role = _role_from_message(msg, include_tool_messages)
    if role is None:
        return None
    content = _content_to_string(msg.content)
    if not content.strip():
        return None
    return ChatMessage(role=role, content=content)


def _role_from_message(msg: BaseMessage, include_tool_messages: bool) -> Optional[ChatRole]:
    if isinstance(msg, HumanMessage):
        return "user"
    if isinstance(msg, AIMessage):
        return "assistant"
    if isinstance(msg, SystemMessage):
        return "system"
    if isinstance(msg, ToolMessage):
        return "system" if include_tool_messages else None
    return None


def _content_to_string(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                text = part.get("text")
                if text:
                    parts.append(str(text))
        return "\n".join(p for p in parts if p)
    if content is None:
        return ""
    return str(content)


def _hash_turn(turn: ChatMessage) -> str:
    # Stable-ish hash: role + first 500 chars of content. Same policy
    # as the TS sibling — collisions across different long messages
    # starting identically are accepted as benign.
    return f"{turn.role}:{turn.content[:500]}"


__all__ = ["CopassWindowCallback"]
