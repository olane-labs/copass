"""ADK event → neutral ``AgentEvent`` translation.

ADK Agent Engine's ``async_stream_query`` yields events shaped like::

    {
        "author": "agent_name",
        "content": {
            "parts": [
                {"text": "..."},                    # model text
                {"function_call": {...}},           # model wants to call a tool
                {"function_response": {...}},       # tool result injected back
            ],
            "role": "model" | "user",
        },
        "id": "event_id",
    }

This module owns the pure, SDK-free translation from that shape into
the provider-neutral :class:`AgentEvent` hierarchy from
:mod:`copass_core_agents.events`. Factored out because the
part-union schema (three distinct block types inside a single event)
benefits from a dedicated, unit-testable adapter rather than living
inline in ``GoogleAgentBackend.stream``.

The translator tolerates both dict and object-attribute shapes — the
Google SDK yields Pydantic model instances at runtime but dicts in
some serialized paths (pickled checkpoints, Agent Engine replays).
"""

from __future__ import annotations

from typing import Any, List

from copass_core_agents.events import (
    AgentEvent,
    AgentTextDelta,
    AgentToolCall,
    AgentToolResult,
)


def _get(obj: Any, key: str, default: Any = None) -> Any:
    """Attribute or dict-item access, whichever works. Returns
    ``default`` when neither is present or value is falsy-empty."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _as_dict(obj: Any) -> dict:
    """Coerce an ADK arg/result payload into a plain dict.

    ADK surfaces these as either ``dict`` (already done), Pydantic
    models (need ``.model_dump()`` or ``dict()``), or ``None``.
    """
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return dict(obj)
    dump = getattr(obj, "model_dump", None)
    if callable(dump):
        try:
            return dict(dump())
        except Exception:
            pass
    try:
        return dict(obj)
    except Exception:
        return {"value": obj}


def adk_event_to_agent_events(adk_event: Any) -> List[AgentEvent]:
    """Translate a single ADK event into zero or more :class:`AgentEvent`.

    An ADK event may produce multiple neutral events when its
    ``content.parts`` contains a mix of text, function_call, and
    function_response blocks. Returns a list (possibly empty) so
    callers can iterate without special-casing.

    Args:
        adk_event: A single event yielded by
            ``adk_app.async_stream_query(...)``. May be a dict or an
            SDK object with attribute access.

    Returns:
        Ordered list of :class:`AgentEvent` corresponding to the
        parts inside the ADK event. Text parts → :class:`AgentTextDelta`,
        function_call parts → :class:`AgentToolCall`, function_response
        parts → :class:`AgentToolResult`. Terminal events
        (:class:`AgentFinish`) are emitted by the backend based on
        stream exhaustion, not by this adapter.
    """
    out: List[AgentEvent] = []
    event_id = _get(adk_event, "id") or ""
    content = _get(adk_event, "content")
    parts = _get(content, "parts") or []

    for idx, part in enumerate(parts):
        text = _get(part, "text")
        if text:
            out.append(AgentTextDelta(text=str(text)))
            continue

        fc = _get(part, "function_call")
        if fc is not None:
            call_id = str(_get(fc, "id") or event_id or f"call-{idx}")
            name = str(_get(fc, "name") or "")
            arguments = _as_dict(_get(fc, "args"))
            out.append(
                AgentToolCall(
                    call_id=call_id,
                    name=name,
                    arguments=arguments,
                )
            )
            continue

        fr = _get(part, "function_response")
        if fr is not None:
            call_id = str(_get(fr, "id") or event_id or f"call-{idx}")
            name = str(_get(fr, "name") or "")
            response = _as_dict(_get(fr, "response"))
            # ADK's function_response doesn't have a first-class error
            # field — errors are surfaced inside response payload by
            # convention. Surface response["error"] if present for
            # neutral-event parity; otherwise leave error=None.
            error = response.get("error") if isinstance(response, dict) else None
            out.append(
                AgentToolResult(
                    call_id=call_id,
                    name=name,
                    result=response,
                    error=str(error) if error else None,
                )
            )
            continue

    return out


def extract_usage_metadata(adk_event: Any) -> dict:
    """Extract token usage from an ADK event's ``usage_metadata``.

    ADK emits ``usage_metadata`` on events that involved a model call.
    Its native keys (``prompt_token_count``, ``candidates_token_count``,
    ``thoughts_token_count``) are remapped to the provider-neutral keys
    the Anthropic backend already uses (``input_tokens``,
    ``output_tokens``, ``thinking_tokens``) so consumers can read one
    shape regardless of provider.

    Returns an empty dict when the event has no usage_metadata (non-model
    events, tool-only events).
    """
    meta = _get(adk_event, "usage_metadata")
    if meta is None:
        return {}
    out: dict = {}
    prompt = _get(meta, "prompt_token_count")
    if isinstance(prompt, int):
        out["input_tokens"] = prompt
    candidates = _get(meta, "candidates_token_count")
    if isinstance(candidates, int):
        out["output_tokens"] = candidates
    thoughts = _get(meta, "thoughts_token_count")
    if isinstance(thoughts, int):
        out["thinking_tokens"] = thoughts
    total = _get(meta, "total_token_count")
    if isinstance(total, int):
        out["total_tokens"] = total
    return out


__all__ = ["adk_event_to_agent_events", "extract_usage_metadata"]
