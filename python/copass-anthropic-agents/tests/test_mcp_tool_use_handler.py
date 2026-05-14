"""ADR 0029 — ``agent.mcp_tool_use`` MUST resolve as ``user.tool_confirmation(allow)``.

Anthropic emits ``agent.mcp_tool_use`` for tools executed against a
managed MCP server (the gateway, in ADR 0029's posture). The reply
envelope is ``user.tool_confirmation`` with ``result: "allow"`` — not
``user.custom_tool_result``. Routing the wrong envelope leaves the
session deadlocked with pending sevt_ ids (the May 2026 incident).

This test is intentionally narrow — the broader cohort of envelope-
mapping cases lives in ``test_managed_agent_backend.py`` — but it is
the regression guard most directly tied to ADR 0029 (without
``always_allow`` semantics flowing through this handler, the gateway
path simply does not work end-to-end).

Per ADR 0001 §7 the assertions repoint at the v2 :class:`McpToolCall`
variant's :meth:`build_reply` — the v1 ``_build_user_event_for_tool_use``
string-dispatch helper is replaced by per-variant reply builders.
"""

from __future__ import annotations

from typing import get_args

from copass_anthropic_agents.backends.pending_tool_call import (
    CustomToolCall,
    McpToolCall,
    PendingToolCall,
    ServerToolCall,
)


def test_mcp_tool_use_returns_user_tool_confirmation_allow() -> None:
    evt = McpToolCall(
        event_id="sevt_mcp_handler_1", name="x",
    ).build_reply()
    assert evt["type"] == "user.tool_confirmation"
    assert evt["tool_use_id"] == "sevt_mcp_handler_1"
    assert evt["result"] == "allow"
    # No ``custom_tool_use_id`` / ``content`` — those keys belong on
    # ``user.custom_tool_result`` only. Cross-contamination would
    # trigger Anthropic's 400 envelope-mismatch validator.
    assert "custom_tool_use_id" not in evt
    assert "content" not in evt


def test_mcp_tool_use_remains_in_recognized_tool_use_envelopes() -> None:
    """If ``McpToolCall`` ever leaves the :data:`PendingToolCall`
    sealed union, the streaming loop will reject mcp tool-use events
    at parse time and the ``requires_action`` signal will arrive with
    un-buffered ids — the exact stranded-session failure ADR 0029's
    regression guard targets."""
    variants = set(get_args(PendingToolCall))
    assert McpToolCall in variants
    # And the two siblings, for completeness.
    assert CustomToolCall in variants
    assert ServerToolCall in variants
