"""Minimal SSE parser for Copass's agent-run endpoint.

Translates raw SSE frames into neutral :class:`AgentEvent` values from
``copass-core-agents``. Handles CRLF/LF line endings, multi-line
``data:`` fields, and comment/id/retry skipping.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import AsyncIterator, Optional

import httpx

from copass_core_agents.events import (
    AgentEvent,
    AgentFinish,
    AgentTextDelta,
    AgentToolCall,
    AgentToolResult,
)


@dataclass(frozen=True)
class RawSseFrame:
    event: str
    data: str


def _parse_block(block: str) -> Optional[RawSseFrame]:
    event = "message"
    data_lines: list[str] = []
    for raw in block.split("\n"):
        line = raw.rstrip("\r")
        if not line or line.startswith(":"):
            continue
        colon = line.find(":")
        if colon < 0:
            continue
        field = line[:colon]
        value = line[colon + 1 :]
        if value.startswith(" "):
            value = value[1:]
        if field == "event":
            event = value
        elif field == "data":
            data_lines.append(value)
    if not data_lines:
        return None
    return RawSseFrame(event=event, data="\n".join(data_lines))


async def iterate_sse_frames(response: httpx.Response) -> AsyncIterator[RawSseFrame]:
    """Async-iterate SSE frames off an ``httpx`` streaming Response.

    Caller is expected to have opened the response with ``stream=True``
    (i.e. via ``client.stream(...)``). We don't read the full body in
    one shot — each frame is yielded as it arrives.
    """
    buffer = ""
    async for chunk in response.aiter_text():
        buffer += chunk
        buffer = buffer.replace("\r\n", "\n")
        while True:
            sep = buffer.find("\n\n")
            if sep < 0:
                break
            block = buffer[:sep]
            buffer = buffer[sep + 2 :]
            frame = _parse_block(block)
            if frame is not None:
                yield frame
    tail = buffer.strip()
    if tail:
        frame = _parse_block(tail)
        if frame is not None:
            yield frame


def frame_to_agent_event(frame: RawSseFrame) -> Optional[AgentEvent]:
    """Translate a Copass SSE frame into a neutral :class:`AgentEvent`.

    Returns ``None`` for unrecognized event names or malformed JSON.
    """
    try:
        payload = json.loads(frame.data)
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None
    if frame.event == "agent_text_delta":
        return AgentTextDelta(text=str(payload.get("text", "")))
    if frame.event == "agent_tool_call":
        return AgentToolCall(
            call_id=str(payload.get("call_id", "")),
            name=str(payload.get("name", "")),
            arguments=dict(payload.get("arguments") or {}),
        )
    if frame.event == "agent_tool_result":
        return AgentToolResult(
            call_id=str(payload.get("call_id", "")),
            name=str(payload.get("name", "")),
            result=dict(payload.get("result") or {}),
            error=(str(payload["error"]) if payload.get("error") else None),
        )
    if frame.event == "agent_finish":
        return AgentFinish(
            stop_reason=str(payload.get("stop_reason", "unknown")),
            session_id=(payload.get("session_id") or None),
            usage=dict(payload.get("usage") or {}),
        )
    return None


__all__ = ["RawSseFrame", "iterate_sse_frames", "frame_to_agent_event"]
