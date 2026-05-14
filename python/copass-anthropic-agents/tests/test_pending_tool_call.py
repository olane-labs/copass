"""PendingToolCall variant unit tests.

Covers the sealed-union contract and per-variant reply shapes. Maps
to ADR 0001 §7 net-new tests around envelope routing — the
type-level guard the May 2026 prod failure exposed as missing.

The union refuses to construct from an unknown envelope (via
:func:`from_sdk_event`); :data:`PendingToolCall`'s
:func:`typing.get_args` returns the three variants and only the
three variants.
"""

from __future__ import annotations

import json
from typing import get_args

import pytest

from copass_anthropic_agents.backends.pending_tool_call import (
    CustomToolCall,
    McpToolCall,
    PendingToolCall,
    ServerToolCall,
    from_sdk_event,
)
from copass_core_agents.base_tool import AgentTool, ToolSpec
from copass_core_agents.invocation_context import AgentInvocationContext
from copass_core_agents.scope import AgentScope
from copass_core_agents.tool_registry import AgentToolRegistry


class _EchoTool(AgentTool):
    """Echo whatever was passed in as ``result``, or raise on demand."""

    def __init__(self, name: str, *, result=None, raises: Exception = None) -> None:
        self._name = name
        self._result = result
        self._raises = raises

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name=self._name,
            description=self._name,
            input_schema={"type": "object", "properties": {}},
        )

    async def invoke(self, arguments, *, context=None):
        if self._raises is not None:
            raise self._raises
        return self._result


def _ctx() -> AgentInvocationContext:
    return AgentInvocationContext(scope=AgentScope(user_id="u-1"))


def _make_registry(tool: AgentTool) -> AgentToolRegistry:
    reg = AgentToolRegistry()
    reg.add(tool)
    return reg


def test_pending_tool_call_union_has_exactly_three_variants() -> None:
    """The sealed union covers exactly the three Anthropic tool-use
    envelopes. If this shrinks, an envelope has gone unmodeled and the
    parser will mis-route replies — the failure mode ADR 0001
    Decision 2 targets."""
    variants = set(get_args(PendingToolCall))
    assert variants == {CustomToolCall, ServerToolCall, McpToolCall}


@pytest.mark.asyncio
async def test_custom_tool_call_executes_and_builds_custom_result() -> None:
    """``CustomToolCall.execute_and_build_reply`` runs the tool and
    wraps the result in a ``user.custom_tool_result`` envelope."""
    call = CustomToolCall(event_id="sevt_a", name="echo", arguments={})
    tools = _make_registry(_EchoTool("echo", result={"k": "v"}))

    reply = await call.execute_and_build_reply(tools, _ctx())

    assert reply["type"] == "user.custom_tool_result"
    assert reply["custom_tool_use_id"] == "sevt_a"
    assert reply["content"][0]["type"] == "text"
    payload = json.loads(reply["content"][0]["text"])
    assert payload == {"result": {"k": "v"}}


@pytest.mark.asyncio
async def test_custom_tool_call_records_tool_invocation_error() -> None:
    """A raising tool surfaces as an ``error`` field on the envelope
    rather than propagating the exception — the streaming generator
    cannot afford to crash mid-yield."""
    call = CustomToolCall(event_id="sevt_a", name="boom", arguments={})
    tools = _make_registry(_EchoTool("boom", raises=RuntimeError("nope")))

    reply = await call.execute_and_build_reply(tools, _ctx())

    assert reply["type"] == "user.custom_tool_result"
    payload = json.loads(reply["content"][0]["text"])
    assert "error" in payload
    assert "nope" in payload["error"]


@pytest.mark.asyncio
async def test_custom_tool_call_records_unknown_tool_error() -> None:
    """An unregistered tool name produces an envelope with an error
    rather than KeyError — same generator-safety reason."""
    call = CustomToolCall(event_id="sevt_a", name="ghost", arguments={})
    tools = _make_registry(_EchoTool("other", result={}))

    reply = await call.execute_and_build_reply(tools, _ctx())

    payload = json.loads(reply["content"][0]["text"])
    assert "error" in payload
    assert "not registered" in payload["error"]


@pytest.mark.asyncio
async def test_custom_tool_call_coerces_non_dict_result() -> None:
    """Tools returning non-dicts get coerced to ``{"value": <thing>}``
    so the envelope shape stays parseable on Anthropic's side. Matches
    v1's ``_execute_pending_tools:880-885``."""
    call = CustomToolCall(event_id="sevt_a", name="echo", arguments={})
    tools = _make_registry(_EchoTool("echo", result="oops"))

    reply = await call.execute_and_build_reply(tools, _ctx())

    payload = json.loads(reply["content"][0]["text"])
    assert payload == {"result": {"value": "oops"}}


def test_custom_tool_call_build_reply_from_result_pure_shape() -> None:
    """The pure-shape helper used by unit tests builds the envelope
    without invoking the tool."""
    call = CustomToolCall(event_id="sevt_c", name="t", arguments={})

    reply = call.build_reply_from_result({"x": 1}, None)

    assert reply == {
        "type": "user.custom_tool_result",
        "custom_tool_use_id": "sevt_c",
        "content": [
            {
                "type": "text",
                "text": json.dumps({"result": {"x": 1}}),
            }
        ],
    }


def test_server_tool_call_build_reply_returns_confirmation_allow() -> None:
    """``ServerToolCall.build_reply`` returns the ``user.tool_confirmation(allow)``
    envelope — no ``custom_tool_use_id``, no ``content``. Anthropic's
    400 envelope-mismatch validator rejects cross-contamination."""
    reply = ServerToolCall(event_id="sevt_srv", name="bash").build_reply()

    assert reply == {
        "type": "user.tool_confirmation",
        "tool_use_id": "sevt_srv",
        "result": "allow",
    }


def test_mcp_tool_call_build_reply_returns_confirmation_allow() -> None:
    """``McpToolCall.build_reply`` shape matches :class:`ServerToolCall`'s
    — same confirmation envelope, different envelope tag at parse
    time so the routing inside Anthropic doesn't collapse them."""
    reply = McpToolCall(event_id="sevt_mcp", name="x").build_reply()

    assert reply == {
        "type": "user.tool_confirmation",
        "tool_use_id": "sevt_mcp",
        "result": "allow",
    }


def test_from_sdk_event_constructs_custom_tool_call() -> None:
    class _E:
        type = "agent.custom_tool_use"
        id = "sevt_1"
        name = "do"
        input = {"x": 1}

    call = from_sdk_event(_E())

    assert isinstance(call, CustomToolCall)
    assert call.event_id == "sevt_1"
    assert call.name == "do"
    assert call.arguments == {"x": 1}


def test_from_sdk_event_constructs_server_tool_call() -> None:
    class _E:
        type = "agent.tool_use"
        id = "sevt_2"
        name = "bash"

    call = from_sdk_event(_E())

    assert isinstance(call, ServerToolCall)
    assert call.event_id == "sevt_2"


def test_from_sdk_event_constructs_mcp_tool_call() -> None:
    class _E:
        type = "agent.mcp_tool_use"
        id = "sevt_3"
        name = "list_files"

    call = from_sdk_event(_E())

    assert isinstance(call, McpToolCall)
    assert call.event_id == "sevt_3"


def test_from_sdk_event_unknown_envelope_raises_type_error() -> None:
    """v1 fell back to ``user.custom_tool_result`` on an unknown
    envelope; v2 makes it a programmer error so the gap surfaces in
    a failing test rather than on prod traffic. ADR 0001 §7's
    ``test_build_user_event_for_unknown_source_does_not_raise`` is
    flipped to assert raises."""
    class _E:
        type = "agent.future_tool_use"
        id = "sevt_x"
        name = "?"

    with pytest.raises(TypeError):
        from_sdk_event(_E())
