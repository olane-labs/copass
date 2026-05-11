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
path simply does not work end-to-end)."""

from __future__ import annotations

from copass_anthropic_agents.backends.managed_agent_backend import (
    _TOOL_USE_EVENT_TYPES,
    _build_user_event_for_tool_use,
)


def test_mcp_tool_use_returns_user_tool_confirmation_allow() -> None:
    evt = _build_user_event_for_tool_use(
        source_type="agent.mcp_tool_use",
        event_id="sevt_mcp_handler_1",
        # mcp_tool_use is server-executed: result/error are irrelevant
        # to the confirmation reply but must not corrupt the envelope.
        result={"ignored": True},
        error=None,
    )
    assert evt["type"] == "user.tool_confirmation"
    assert evt["tool_use_id"] == "sevt_mcp_handler_1"
    assert evt["result"] == "allow"
    # No ``custom_tool_use_id`` / ``content`` — those keys belong on
    # ``user.custom_tool_result`` only. Cross-contamination would
    # trigger Anthropic's 400 envelope-mismatch validator.
    assert "custom_tool_use_id" not in evt
    assert "content" not in evt


def test_mcp_tool_use_remains_in_recognized_tool_use_envelopes() -> None:
    """If ``agent.mcp_tool_use`` ever leaves the recognized set, the
    streaming loop falls through to the unknown-event-type branch and
    the ``requires_action`` signal arrives with un-buffered ids — the
    exact stranded-session failure ADR 0029's regression guard
    targets."""
    assert "agent.mcp_tool_use" in _TOOL_USE_EVENT_TYPES
