"""PendingToolCall — sealed union for the three Anthropic tool-use envelopes.

The Anthropic managed-agents API emits three distinct tool-use
envelopes that each demand a different reply shape:

- ``agent.custom_tool_use`` → :class:`CustomToolCall` → reply
  ``user.custom_tool_result``. The tool runs locally; we send back
  the serialized result.
- ``agent.tool_use`` → :class:`ServerToolCall` → reply
  ``user.tool_confirmation(result="allow")``. Anthropic's built-in
  toolset runs the tool server-side; we just authorize.
- ``agent.mcp_tool_use`` → :class:`McpToolCall` → reply
  ``user.tool_confirmation(result="allow")``. The Anthropic-managed
  MCP server runs the tool; we just authorize.

v1 flattened these into a single ``frozenset`` and dispatched by
string comparison at four call sites that could drift independently.
v2 encodes them as a sealed union: the reply-builder is a method on
the variant, the parser switches on the SDK envelope name exactly
once, and any unknown envelope is a type error rather than a
silently-mis-routed reply.

The :data:`PendingToolCall` type alias is what
:class:`RequiresActionCycle` accepts in its ``events_by_id`` map.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional, Union

if TYPE_CHECKING:
    from copass_core_agents.invocation_context import AgentInvocationContext
    from copass_core_agents.tool_registry import AgentToolRegistry

logger = logging.getLogger(__name__)


# Envelope-string class-level constants. Single source of truth for the
# parser when it maps an SDK SSE event onto a variant. Keep the names
# verbatim from the Anthropic API contract — these strings are how
# Anthropic identifies the tool-use envelope on the wire.
ENVELOPE_CUSTOM_TOOL_USE = "agent.custom_tool_use"
ENVELOPE_SERVER_TOOL_USE = "agent.tool_use"
ENVELOPE_MCP_TOOL_USE = "agent.mcp_tool_use"


def _serialize_tool_result(result: dict, error: Optional[str]) -> str:
    """Serialize a tool result dict (+ optional error) for a
    ``user.custom_tool_result`` reply.

    Moved from v1's ``managed_agent_backend._serialize_tool_result``;
    semantics preserved verbatim. Falls back to a minimal
    ``{"error": ...}`` envelope when the result isn't JSON-serializable
    so the reply still parses on Anthropic's side.
    """
    payload: dict = {"result": result}
    if error:
        payload["error"] = error
    try:
        return json.dumps(payload, default=str)
    except Exception:
        return json.dumps({"error": "unserializable tool result"})


@dataclass(frozen=True)
class CustomToolCall:
    """``agent.custom_tool_use`` — local execution.

    The tool lives in the agent's :class:`AgentToolRegistry` and runs
    in-process. The reply envelope is ``user.custom_tool_result``
    carrying the JSON-serialized result.
    """

    event_id: str
    name: str
    arguments: dict

    # Envelope tag — used by the parser to identify which variant to
    # construct from an SDK event.
    ENVELOPE: str = ENVELOPE_CUSTOM_TOOL_USE

    def build_reply_from_result(
        self, result: dict, error: Optional[str] = None
    ) -> dict:
        """Build the ``user.custom_tool_result`` envelope from an
        already-executed result.

        Pure shape helper that unit tests can call without exercising
        tool invocation. The streaming backend calls
        :meth:`execute_and_build_reply` instead, which folds invocation
        in. The split keeps the per-envelope reply shape assertable in
        isolation.
        """
        return {
            "type": "user.custom_tool_result",
            "custom_tool_use_id": self.event_id,
            "content": [
                {
                    "type": "text",
                    "text": _serialize_tool_result(result, error),
                }
            ],
        }

    async def execute_and_build_reply(
        self,
        tools: "AgentToolRegistry",
        context: "AgentInvocationContext",
    ) -> dict:
        """Resolve the tool, invoke it, and build the
        ``user.custom_tool_result`` envelope.

        Folds in v1's ``_execute_pending_tools`` local-execute branch
        (``managed_agent_backend.py:815-887``). The confirm-only
        branches live on :class:`ServerToolCall` and :class:`McpToolCall`.

        Errors are converted into ``{"error": <message>}`` payloads on
        the envelope — they are not raised — so a single tool failure
        does not abort the run. The model sees the error in its next
        turn and can retry or recover.
        """
        tool = tools.try_get(self.name)
        if tool is None:
            logger.error(
                "CustomToolCall: tool not registered on agent",
                extra={"tool_name": self.name, "event_id": self.event_id},
            )
            return self.build_reply_from_result(
                {}, f"tool {self.name!r} not registered"
            )

        try:
            result = await tool.invoke(self.arguments, context=context)
        except Exception as tool_err:
            logger.exception(
                "CustomToolCall: tool invocation raised",
                extra={"tool_name": self.name, "event_id": self.event_id},
            )
            return self.build_reply_from_result({}, f"tool raised: {tool_err}")

        if not isinstance(result, dict):
            logger.warning(
                "CustomToolCall: tool returned non-dict; coercing",
                extra={"tool_name": self.name, "event_id": self.event_id},
            )
            result = {"value": result}

        return self.build_reply_from_result(result, None)


@dataclass(frozen=True)
class ServerToolCall:
    """``agent.tool_use`` — Anthropic's built-in toolset.

    Anthropic runs the tool server-side inside the managed environment;
    we only authorize via ``user.tool_confirmation``.
    """

    event_id: str
    name: str

    ENVELOPE: str = ENVELOPE_SERVER_TOOL_USE

    def build_reply(self) -> dict:
        """Build the ``user.tool_confirmation(result="allow")`` envelope.

        Pure shape — no invocation, no I/O. Always allow: v1 never
        denied server-tool calls and v2 keeps that posture (a stricter
        policy layer belongs above the backend, not inside it).
        """
        return {
            "type": "user.tool_confirmation",
            "tool_use_id": self.event_id,
            "result": "allow",
        }


@dataclass(frozen=True)
class McpToolCall:
    """``agent.mcp_tool_use`` — Anthropic-managed MCP server.

    Anthropic resolves the tool through the registered MCP server (the
    gateway, in our deployment per ADR 0029). The reply envelope is
    identical to :class:`ServerToolCall`'s but the routing inside
    Anthropic is different — keep the variants distinct so the parser
    cannot collapse them by accident.
    """

    event_id: str
    name: str

    ENVELOPE: str = ENVELOPE_MCP_TOOL_USE

    def build_reply(self) -> dict:
        """Build the ``user.tool_confirmation(result="allow")`` envelope."""
        return {
            "type": "user.tool_confirmation",
            "tool_use_id": self.event_id,
            "result": "allow",
        }


PendingToolCall = Union[CustomToolCall, ServerToolCall, McpToolCall]
"""Sealed union of the three Anthropic tool-use envelopes.

``typing.get_args(PendingToolCall)`` returns the three variants in
declaration order: ``(CustomToolCall, ServerToolCall, McpToolCall)``.
The v2 parser uses this membership check; tests assert against it to
guard against an envelope going missing.
"""


def from_sdk_event(sdk_event) -> PendingToolCall:
    """Construct the right :data:`PendingToolCall` variant from an SDK
    event.

    Raises :class:`TypeError` on an unknown envelope — v2 does not
    fall back the way v1 did. An unrecognized envelope is a
    programmer error: the SDK has shipped a new tool-use shape and
    the parser needs updating. Surfacing it as a type error means a
    failing test rather than silently mis-routed replies on prod.
    """
    evt_type = getattr(sdk_event, "type", None)
    evt_id = getattr(sdk_event, "id", None)
    name = getattr(sdk_event, "name", "") or ""

    if evt_type == ENVELOPE_CUSTOM_TOOL_USE:
        raw_input = getattr(sdk_event, "input", None) or {}
        arguments = dict(raw_input) if isinstance(raw_input, dict) else {}
        return CustomToolCall(event_id=evt_id, name=name, arguments=arguments)
    if evt_type == ENVELOPE_SERVER_TOOL_USE:
        return ServerToolCall(event_id=evt_id, name=name)
    if evt_type == ENVELOPE_MCP_TOOL_USE:
        return McpToolCall(event_id=evt_id, name=name)
    raise TypeError(
        f"PendingToolCall: unknown tool-use envelope {evt_type!r} "
        f"(event_id={evt_id!r}, name={name!r}). The Anthropic SDK has "
        "shipped a new tool-use shape; update PendingToolCall to model it."
    )


__all__ = [
    "CustomToolCall",
    "ServerToolCall",
    "McpToolCall",
    "PendingToolCall",
    "ENVELOPE_CUSTOM_TOOL_USE",
    "ENVELOPE_SERVER_TOOL_USE",
    "ENVELOPE_MCP_TOOL_USE",
    "from_sdk_event",
]
