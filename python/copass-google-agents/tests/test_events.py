"""Unit tests for ``adk_event_to_agent_events`` — the pure ADK → neutral
event translator.

Covers both the dict-shape (serialized/pickled paths) and the
object-attr shape (live SDK path) since ADK surfaces events both
ways depending on the codepath.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Optional

from copass_core_agents import (
    AgentTextDelta,
    AgentToolCall,
    AgentToolResult,
)
from copass_google_agents.events import adk_event_to_agent_events


# ──────────────────────────────────────────────────────────────────────
# Object-attribute doubles mirroring the live SDK's Pydantic shapes.
# ──────────────────────────────────────────────────────────────────────


@dataclass
class _FnCall:
    name: str
    args: dict
    id: Optional[str] = None


@dataclass
class _FnResp:
    name: str
    response: dict
    id: Optional[str] = None


@dataclass
class _Part:
    text: Optional[str] = None
    function_call: Optional[_FnCall] = None
    function_response: Optional[_FnResp] = None


@dataclass
class _Content:
    parts: List[_Part]
    role: str = "model"


@dataclass
class _Event:
    content: _Content
    id: str = "evt-1"
    author: str = "copass_agent"


# ──────────────────────────────────────────────────────────────────────
# Tests — dict shape
# ──────────────────────────────────────────────────────────────────────


def test_empty_event_returns_empty_list() -> None:
    assert adk_event_to_agent_events({}) == []
    assert adk_event_to_agent_events(None) == []


def test_text_part_dict_to_text_delta() -> None:
    event = {
        "id": "e1",
        "content": {"parts": [{"text": "hello"}], "role": "model"},
    }
    result = adk_event_to_agent_events(event)
    assert result == [AgentTextDelta(text="hello")]


def test_function_call_part_dict_to_tool_call() -> None:
    event = {
        "id": "e2",
        "content": {
            "parts": [
                {
                    "function_call": {
                        "id": "call-abc",
                        "name": "lookup_user",
                        "args": {"user_id": "u-1"},
                    }
                }
            ],
            "role": "model",
        },
    }
    result = adk_event_to_agent_events(event)
    assert result == [
        AgentToolCall(call_id="call-abc", name="lookup_user", arguments={"user_id": "u-1"})
    ]


def test_function_response_part_dict_to_tool_result() -> None:
    event = {
        "id": "e3",
        "content": {
            "parts": [
                {
                    "function_response": {
                        "id": "call-abc",
                        "name": "lookup_user",
                        "response": {"name": "Alice"},
                    }
                }
            ],
            "role": "user",
        },
    }
    result = adk_event_to_agent_events(event)
    assert result == [
        AgentToolResult(
            call_id="call-abc",
            name="lookup_user",
            result={"name": "Alice"},
            error=None,
        )
    ]


def test_function_response_surfaces_error_field() -> None:
    event = {
        "id": "e4",
        "content": {
            "parts": [
                {
                    "function_response": {
                        "id": "call-err",
                        "name": "lookup_user",
                        "response": {"error": "not found"},
                    }
                }
            ]
        },
    }
    [result] = adk_event_to_agent_events(event)
    assert isinstance(result, AgentToolResult)
    assert result.error == "not found"


def test_mixed_parts_yield_multiple_events_in_order() -> None:
    event = {
        "id": "e5",
        "content": {
            "parts": [
                {"text": "Let me look that up. "},
                {
                    "function_call": {
                        "id": "call-1",
                        "name": "lookup",
                        "args": {"q": "x"},
                    }
                },
                {"text": "Here's what I found:"},
            ]
        },
    }
    result = adk_event_to_agent_events(event)
    assert len(result) == 3
    assert isinstance(result[0], AgentTextDelta)
    assert isinstance(result[1], AgentToolCall)
    assert isinstance(result[2], AgentTextDelta)


def test_missing_fn_call_id_falls_back_to_event_id() -> None:
    event = {
        "id": "evt-outer",
        "content": {
            "parts": [
                {"function_call": {"name": "tool", "args": {}}},
            ]
        },
    }
    [result] = adk_event_to_agent_events(event)
    assert isinstance(result, AgentToolCall)
    assert result.call_id == "evt-outer"


def test_missing_fn_call_and_event_id_synthesizes_call_id() -> None:
    event = {
        "content": {
            "parts": [{"function_call": {"name": "tool", "args": {}}}]
        }
    }
    [result] = adk_event_to_agent_events(event)
    assert result.call_id.startswith("call-")


# ──────────────────────────────────────────────────────────────────────
# Tests — object-attribute shape (live SDK path)
# ──────────────────────────────────────────────────────────────────────


def test_object_shape_text_part() -> None:
    event = _Event(content=_Content(parts=[_Part(text="hi")]))
    assert adk_event_to_agent_events(event) == [AgentTextDelta(text="hi")]


def test_object_shape_function_call() -> None:
    event = _Event(
        content=_Content(
            parts=[
                _Part(
                    function_call=_FnCall(
                        id="c1", name="search", args={"q": "auth"}
                    )
                )
            ]
        )
    )
    [result] = adk_event_to_agent_events(event)
    assert result == AgentToolCall(
        call_id="c1", name="search", arguments={"q": "auth"}
    )


def test_object_shape_function_response() -> None:
    event = _Event(
        content=_Content(
            parts=[
                _Part(
                    function_response=_FnResp(
                        id="c1", name="search", response={"hits": 3}
                    )
                )
            ]
        )
    )
    [result] = adk_event_to_agent_events(event)
    assert result == AgentToolResult(
        call_id="c1", name="search", result={"hits": 3}, error=None
    )


def test_pydantic_like_args_are_coerced_via_model_dump() -> None:
    class _Model:
        def model_dump(self) -> dict:
            return {"k": "v"}

    event = {
        "id": "e",
        "content": {
            "parts": [
                {"function_call": {"name": "t", "args": _Model()}}
            ]
        },
    }
    [result] = adk_event_to_agent_events(event)
    assert isinstance(result, AgentToolCall)
    assert result.arguments == {"k": "v"}


# ─── error envelope detection ─────────────────────────────────────────────


def test_top_level_error_envelope_raises_adk_upstream_error() -> None:
    """ADK occasionally yields ``{code, message}`` instead of a normal
    content event (invalid model id, quota, publisher-not-found). The
    translator must raise rather than produce zero events — silent
    successes on upstream errors are the wrong default."""
    import pytest

    from copass_google_agents.events import (
        AdkUpstreamError,
        adk_event_to_agent_events,
    )

    error_event = {
        "code": 404,
        "message": (
            "404 NOT_FOUND. Publisher Model `.../models/gemini-3.1-pro-preview` "
            "was not found or your project does not have access to it."
        ),
    }
    with pytest.raises(AdkUpstreamError) as excinfo:
        adk_event_to_agent_events(error_event)
    assert excinfo.value.code == 404
    assert "NOT_FOUND" in excinfo.value.message


def test_normal_content_event_with_code_field_does_not_raise() -> None:
    """A normal content event that happens to carry a ``code`` field
    should still walk parts — only the bare ``{code, message}`` shape
    (no ``content``) is the error sentinel."""
    from copass_google_agents.events import adk_event_to_agent_events
    from copass_core_agents.events import AgentTextDelta

    event = {
        "code": "irrelevant",
        "message": "irrelevant",
        "content": {"parts": [{"text": "hello"}]},
    }
    [result] = adk_event_to_agent_events(event)
    assert isinstance(result, AgentTextDelta)
    assert result.text == "hello"
