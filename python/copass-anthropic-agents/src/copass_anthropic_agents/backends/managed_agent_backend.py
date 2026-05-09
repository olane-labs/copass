"""ManagedAgentBackend — Claude Managed Agents backend for ``BaseAgent``.

Implements :class:`AgentBackend` on top of the Anthropic managed-agents
API (see https://platform.claude.com/docs/en/managed-agents/overview).
The agent runs in Anthropic-managed cloud infrastructure; this module
is the seam that translates between the provider-neutral agent surface
(``AgentToolRegistry``, ``AgentEvent``) and the managed-agents event
stream.

Turn lifecycle:

1. Resolve (or create) a managed *agent* describing model, system prompt,
   and our custom tools. Managed agents are immutable after creation, so
   we cache by a fingerprint of their config; cache misses create a new
   managed agent.
2. Resolve (or create) a managed *environment* — the container template
   the session runs in.
3. Create a new *session* tied to the agent + environment, unless the
   caller supplies an existing session id via
   ``context.handles["managed_agent_session_id"]`` (session reuse is how
   multi-turn conversations continue without re-sending history).
4. Open the session event stream, send the user message(s) as
   ``user.message`` events, and drain events — mapping each into an
   :class:`AgentEvent`.
5. When the session pauses with ``stop_reason.type == "requires_action"``
   (Claude asked to run one of our custom tools), look the tool up on
   ``agent.tools``, invoke it with ``context``, JSON-serialize the dict
   result, and send it back as a ``user.custom_tool_result`` event. The
   session resumes automatically.
6. When the session pauses with ``stop_reason.type == "end_turn"``, emit
   :class:`AgentFinish` and stop.

Only this file imports the Anthropic SDK. Base classes remain
vendor-neutral.
"""

from __future__ import annotations

import json
import logging
from hashlib import sha256
from typing import TYPE_CHECKING, Any, AsyncIterator, List, Optional, Union

from copass_core_agents.backends.base_backend import (
    AgentBackend,
    AgentRunResult,
)
from copass_core_agents.events import (
    AgentEvent,
    AgentFinish,
    AgentTextDelta,
    AgentToolCall,
    AgentToolResult,
)
from copass_core_agents.invocation_context import AgentInvocationContext
from copass_core_agents.tool_registry import AgentToolRegistry

from copass_anthropic_agents.backends._input_schema import (
    sanitize_anthropic_input_schema as _sanitize_anthropic_input_schema,
)

if TYPE_CHECKING:
    from anthropic import AsyncAnthropic

    from copass_core_agents.base_agent import BaseAgent


logger = logging.getLogger(__name__)


DEFAULT_ENVIRONMENT_CONFIG: dict = {
    "type": "cloud",
    "networking": {"type": "unrestricted"},
}


SESSION_ID_HANDLE = "managed_agent_session_id"
"""Key under which callers may stash a managed-agents session id in
``AgentInvocationContext.handles``. When present, ``run``/``stream``
reuse that session instead of creating a new one — this is how
multi-turn conversations continue, because the session already holds
the prior turns on the Anthropic side."""


class ManagedAgentBackend(AgentBackend):
    """:class:`AgentBackend` implementation backed by Claude Managed Agents.

    Managed-agent and environment resources are cached in-process by a
    fingerprint of their configuration — repeat calls from the same
    ``BaseAgent`` do not re-create them. Sessions are created per
    invocation by default; pass an existing session id via
    ``context.handles[SESSION_ID_HANDLE]`` to continue a prior
    conversation.

    Args:
        client: Pre-built ``AsyncAnthropic`` client. If omitted, one is
            constructed from ``api_key`` (falling back to the
            ``ANTHROPIC_API_KEY`` env var).
        api_key: Convenience for constructing the client when ``client``
            is not supplied.
        environment_config: Managed-agents environment config dict. See
            https://platform.claude.com/docs/en/managed-agents/environments
            for the full schema. Defaults to
            :data:`DEFAULT_ENVIRONMENT_CONFIG` (cloud, unrestricted).
        environment_name: Console-visible name for the managed
            environment. Only used when creating a new one.
        include_builtin_toolset: When True, enable Anthropic's built-in
            agent toolset (bash, file ops, web search, ...) alongside
            the agent's custom tools. Default False — agents should
            declare the capabilities they need rather than inheriting
            a large implicit surface.
        delete_session_on_finish: When True, delete the managed session
            after the turn completes. Default False: sessions persist
            (container checkpointed for up to 30 days from last
            activity) so callers can inspect state or resume. Only
            applies to sessions this backend created; supplied session
            ids are never deleted automatically.
        config: Backend-level knobs (inherited from
            :class:`AgentBackend`).

    Example:
        >>> from copass_anthropic_agents import (
        ...     AgentInvocationContext, AgentScope, ManagedAgentBackend,
        ... )
        >>> backend = ManagedAgentBackend(api_key=os.environ["ANTHROPIC_API_KEY"])
        >>> agent = MyAgent(tools=registry, backend=backend)
        >>> result = await agent.run(
        ...     messages=[{"role": "user", "content": "Summarize my inbox"}],
        ...     context=AgentInvocationContext(
        ...         scope=AgentScope(user_id="u-1", sandbox_id="sb-1"),
        ...         trace_id="r-1",
        ...     ),
        ... )
        >>> print(result.final_text)
    """

    def __init__(
        self,
        *,
        client: Optional["AsyncAnthropic"] = None,
        api_key: Optional[str] = None,
        environment_config: Optional[dict] = None,
        environment_name: str = "copass-agents-env",
        include_builtin_toolset: bool = False,
        delete_session_on_finish: bool = False,
        config: Optional[dict] = None,
    ) -> None:
        super().__init__(config=config)
        if client is None:
            from anthropic import AsyncAnthropic as _AsyncAnthropic

            client = _AsyncAnthropic(api_key=api_key)
        self._client = client
        self._environment_config = dict(environment_config or DEFAULT_ENVIRONMENT_CONFIG)
        self._environment_name = environment_name
        self._include_builtin_toolset = include_builtin_toolset
        self._delete_session_on_finish = delete_session_on_finish
        self._agent_ids: dict[str, str] = {}
        self._environment_id: Optional[str] = None

    async def run(
        self,
        agent: "BaseAgent",
        messages: Union[str, List[dict]],
        context: AgentInvocationContext,
    ) -> AgentRunResult:
        final_text_parts: list[str] = []
        tool_calls_log: list[dict] = []
        stop_reason = "end_turn"
        usage: dict = {}
        session_id: Optional[str] = None

        async for evt in self.stream(agent, messages, context):
            if isinstance(evt, AgentTextDelta):
                final_text_parts.append(evt.text)
            elif isinstance(evt, AgentToolCall):
                tool_calls_log.append(
                    {
                        "call_id": evt.call_id,
                        "name": evt.name,
                        "arguments": evt.arguments,
                    }
                )
            elif isinstance(evt, AgentToolResult):
                for entry in tool_calls_log:
                    if entry["call_id"] == evt.call_id and "result" not in entry:
                        entry["result"] = evt.result
                        if evt.error:
                            entry["error"] = evt.error
                        break
            elif isinstance(evt, AgentFinish):
                stop_reason = evt.stop_reason
                usage = dict(evt.usage)
                session_id = evt.session_id

        return AgentRunResult(
            final_text="".join(final_text_parts),
            tool_calls=tool_calls_log,
            stop_reason=stop_reason,
            usage=usage,
            session_id=session_id,
        )

    async def stream(
        self,
        agent: "BaseAgent",
        messages: Union[str, List[dict]],
        context: AgentInvocationContext,
    ) -> AsyncIterator[AgentEvent]:
        user_events = self._normalize_messages(messages)
        if not user_events:
            raise ValueError(
                "ManagedAgentBackend: messages must contain at least one "
                "user-role message"
            )

        effective_tools = await agent.build_tools(context)
        agent_id = await self._ensure_agent_id(agent, effective_tools)
        environment_id = await self._ensure_environment_id()

        supplied_session_id = (
            context.handles.get(SESSION_ID_HANDLE) if context and context.handles else None
        )
        created_session_id: Optional[str] = None
        if supplied_session_id:
            session_id = supplied_session_id
        else:
            session_id = await self._create_session(
                agent_id=agent_id,
                environment_id=environment_id,
                title=_session_title(agent, context),
            )
            created_session_id = session_id

        pending_tool_events: dict[str, Any] = {}
        usage_accumulator: dict = {}
        seen_unknown_event_types: set[str] = set()

        stream = await self._client.beta.sessions.events.stream(session_id)
        try:
            await self._client.beta.sessions.events.send(
                session_id,
                events=user_events,
            )

            async for sdk_event in stream:
                evt_type = getattr(sdk_event, "type", None)
                evt_id = getattr(sdk_event, "id", None)

                if evt_type == "agent.message":
                    for block in getattr(sdk_event, "content", None) or []:
                        if getattr(block, "type", None) == "text":
                            text = getattr(block, "text", "") or ""
                            if text:
                                yield AgentTextDelta(text=text)

                elif evt_type == "agent.custom_tool_use":
                    # Per Anthropic's SDK contract, `event.id` here is the
                    # same id that surfaces later in
                    # `requires_action.event_ids` and that we send back as
                    # `custom_tool_use_id` on `user.custom_tool_result`.
                    # Without it we cannot route a result back, so abort
                    # loudly rather than silently bucket every id-less
                    # event under "" (the prior behaviour produced
                    # "tool event not found" placeholders that the API
                    # then rejected with "waiting on responses to
                    # events [...]" when the placeholder used the wrong
                    # event protocol).
                    name = getattr(sdk_event, "name", "") or ""
                    if not evt_id:
                        logger.error(
                            "ManagedAgentBackend: agent.custom_tool_use missing id — aborting run",
                            extra={
                                "session_id": session_id,
                                "name": name,
                                "event_repr": repr(sdk_event)[:500],
                            },
                        )
                        raise RuntimeError(
                            "ManagedAgentBackend: agent.custom_tool_use event "
                            f"arrived without an id (name={name!r}); cannot "
                            "respond — aborting run"
                        )
                    if evt_id in pending_tool_events:
                        # Real id collision — distinct from the empty-key
                        # case above. Anthropic should never re-emit the
                        # same event id, so this points to either an SDK
                        # bug or a session being driven by two clients.
                        logger.error(
                            "ManagedAgentBackend: duplicate event id in buffer",
                            extra={
                                "session_id": session_id,
                                "event_id": evt_id,
                                "incoming_name": name,
                                "buffered_name": getattr(
                                    pending_tool_events[evt_id], "name", None
                                ),
                            },
                        )
                    raw_input = getattr(sdk_event, "input", None) or {}
                    arguments = dict(raw_input) if isinstance(raw_input, dict) else {}
                    pending_tool_events[evt_id] = sdk_event
                    yield AgentToolCall(
                        call_id=evt_id,
                        name=name,
                        arguments=arguments,
                    )

                elif evt_type == "session.status_idle":
                    stop = getattr(sdk_event, "stop_reason", None)
                    stop_type = getattr(stop, "type", None) if stop is not None else None

                    if stop_type == "requires_action":
                        event_ids = list(getattr(stop, "event_ids", None) or [])
                        # If `event_ids` references an event the harness
                        # never buffered, the agent is blocked on
                        # something we don't know how to answer (e.g. an
                        # ``agent.tool_use`` / ``agent.mcp_tool_use``
                        # event whose response is ``user.tool_confirmation``,
                        # not ``user.custom_tool_result``). Sending the
                        # wrong response shape leaves the session
                        # deadlocked — the API rejects subsequent batches
                        # with "waiting on responses to events [...]".
                        # Send ``user.interrupt`` to terminate cleanly
                        # and surface the failure to the caller.
                        missing = [eid for eid in event_ids if eid not in pending_tool_events]
                        if missing:
                            logger.error(
                                "ManagedAgentBackend: requires_action ids not buffered — attempting recovery",
                                extra={
                                    "session_id": session_id,
                                    "requested_ids": event_ids,
                                    "buffered_ids": list(pending_tool_events.keys()),
                                    "missing_ids": missing,
                                    "buffered_names": {
                                        k: getattr(v, "name", None)
                                        for k, v in pending_tool_events.items()
                                    },
                                },
                            )
                            # Recovery: the SSE stream may not have surfaced
                            # these tool-use events under
                            # ``agent.custom_tool_use`` — either an
                            # ordering race vs ``requires_action`` or the
                            # API surfaced them under a different envelope
                            # (``agent.tool_use`` / ``agent.mcp_tool_use``,
                            # which expect ``user.tool_confirmation`` and
                            # cannot be answered with
                            # ``user.custom_tool_result``). Fetch the
                            # session log and re-bucket only events that
                            # are safe to execute as custom tools; anything
                            # else falls through to the interrupt path.
                            await self._rehydrate_pending_tool_events(
                                session_id=session_id,
                                pending=pending_tool_events,
                                missing_ids=missing,
                            )
                            still_missing = [
                                eid for eid in event_ids
                                if eid not in pending_tool_events
                            ]
                            if still_missing:
                                logger.error(
                                    "ManagedAgentBackend: requires_action ids still missing after rehydrate — interrupting session",
                                    extra={
                                        "session_id": session_id,
                                        "still_missing_ids": still_missing,
                                        "buffered_ids": list(pending_tool_events.keys()),
                                    },
                                )
                                try:
                                    await self._client.beta.sessions.events.send(
                                        session_id,
                                        events=[{"type": "user.interrupt"}],
                                    )
                                except Exception:
                                    logger.exception(
                                        "ManagedAgentBackend: user.interrupt send failed",
                                        extra={"session_id": session_id},
                                    )
                                yield AgentFinish(
                                    stop_reason="error",
                                    usage=dict(usage_accumulator),
                                    session_id=session_id,
                                )
                                break
                        results = await self._execute_pending_tools(
                            effective_tools=effective_tools,
                            context=context,
                            event_ids=event_ids,
                            pending=pending_tool_events,
                        )
                        for call_id, name, result, error in results:
                            yield AgentToolResult(
                                call_id=call_id,
                                name=name,
                                result=result,
                                error=error,
                            )
                        if results:
                            await self._client.beta.sessions.events.send(
                                session_id,
                                events=[
                                    {
                                        "type": "user.custom_tool_result",
                                        "custom_tool_use_id": call_id,
                                        "content": [
                                            {
                                                "type": "text",
                                                "text": _serialize_tool_result(result, error),
                                            }
                                        ],
                                    }
                                    for (call_id, _name, result, error) in results
                                ],
                            )
                        for call_id, *_ in results:
                            pending_tool_events.pop(call_id, None)
                    elif stop_type == "end_turn":
                        yield AgentFinish(
                            stop_reason="end_turn",
                            usage=dict(usage_accumulator),
                            session_id=session_id,
                        )
                        break
                    else:
                        yield AgentFinish(
                            stop_reason=str(stop_type or "unknown"),
                            usage=dict(usage_accumulator),
                            session_id=session_id,
                        )
                        break

                elif evt_type == "session.status_terminated":
                    yield AgentFinish(
                        stop_reason="terminated",
                        usage=dict(usage_accumulator),
                        session_id=session_id,
                    )
                    break

                elif evt_type == "session.error":
                    err = getattr(sdk_event, "error", None)
                    err_msg = getattr(err, "message", None) if err is not None else None
                    logger.warning(
                        "ManagedAgentBackend: session.error received",
                        extra={"session_id": session_id, "error": err_msg},
                    )
                    yield AgentFinish(
                        stop_reason="error",
                        usage=dict(usage_accumulator),
                        session_id=session_id,
                    )
                    break

                elif evt_type == "span.model_request_end":
                    model_usage = getattr(sdk_event, "model_usage", None)
                    if model_usage is not None:
                        for key in (
                            "input_tokens",
                            "output_tokens",
                            "cache_creation_input_tokens",
                            "cache_read_input_tokens",
                        ):
                            v = getattr(model_usage, key, None)
                            if isinstance(v, int):
                                usage_accumulator[key] = usage_accumulator.get(key, 0) + v

                else:
                    # Unknown event type — log once per type per session so
                    # we catch beta-API event-type drift (e.g. a renamed
                    # ``agent.custom_tool_use`` envelope, or a
                    # newly-introduced server-tool event class) before it
                    # silently breaks the requires_action path.
                    if evt_type and evt_type not in seen_unknown_event_types:
                        seen_unknown_event_types.add(evt_type)
                        logger.warning(
                            "ManagedAgentBackend: unknown event type",
                            extra={
                                "session_id": session_id,
                                "event_type": evt_type,
                                "event_id": evt_id,
                                "event_repr": repr(sdk_event)[:500],
                            },
                        )
        finally:
            try:
                await stream.close()
            except Exception:
                pass
            if created_session_id and self._delete_session_on_finish:
                try:
                    await self._client.beta.sessions.delete(created_session_id)
                except Exception as cleanup_err:
                    logger.warning(
                        "ManagedAgentBackend: session cleanup failed",
                        extra={
                            "session_id": created_session_id,
                            "error": str(cleanup_err),
                        },
                    )

    async def _rehydrate_pending_tool_events(
        self,
        *,
        session_id: str,
        pending: dict[str, Any],
        missing_ids: list[str],
    ) -> None:
        """Fetch the session's event log and re-bucket any custom-tool-use
        events the streaming reader missed.

        Called when ``requires_action`` lists ids that never arrived as
        ``agent.custom_tool_use`` on the SSE stream — either an ordering
        race vs the ``requires_action`` signal, or the API surfaced the
        tool-use under a different envelope. Best-effort: only events we
        can answer with ``user.custom_tool_result`` (i.e.
        ``agent.custom_tool_use``, identified by carrying both ``name``
        and ``input``) are added to ``pending``. Anything else is left
        alone so the caller's ``still_missing`` check can fall back to
        the existing ``user.interrupt`` path. Failures are swallowed —
        recovery never makes things worse than the prior behavior.
        """
        needed = set(missing_ids)
        if not needed:
            return
        try:
            paginator = self._client.beta.sessions.events.list(
                session_id, order="desc", limit=200
            )
            async for sdk_event in paginator:
                if not needed:
                    break
                evt_id = getattr(sdk_event, "id", None)
                if not evt_id or evt_id not in needed:
                    continue
                evt_type = getattr(sdk_event, "type", None)
                name = getattr(sdk_event, "name", None)
                raw_input = getattr(sdk_event, "input", None)
                # Only bucket events that look like custom-tool calls.
                # ``agent.tool_use`` / ``agent.mcp_tool_use`` carry the
                # same shape but expect ``user.tool_confirmation`` as a
                # response — answering them with
                # ``user.custom_tool_result`` deadlocks the session, so
                # leave them out and let the interrupt path fire.
                if evt_type != "agent.custom_tool_use":
                    logger.warning(
                        "ManagedAgentBackend: rehydrate skipped non-custom-tool event",
                        extra={
                            "session_id": session_id,
                            "event_id": evt_id,
                            "event_type": evt_type,
                        },
                    )
                    continue
                if not name or raw_input is None:
                    logger.warning(
                        "ManagedAgentBackend: rehydrate skipped malformed event",
                        extra={
                            "session_id": session_id,
                            "event_id": evt_id,
                            "event_type": evt_type,
                        },
                    )
                    continue
                pending[evt_id] = sdk_event
                needed.discard(evt_id)
                logger.info(
                    "ManagedAgentBackend: rehydrated tool event from session log",
                    extra={
                        "session_id": session_id,
                        "event_id": evt_id,
                        "name": name,
                    },
                )
        except Exception as exc:
            logger.exception(
                "ManagedAgentBackend: rehydrate failed",
                extra={
                    "session_id": session_id,
                    "missing_ids": missing_ids,
                    "error": str(exc),
                },
            )

    async def _execute_pending_tools(
        self,
        *,
        effective_tools: AgentToolRegistry,
        context: AgentInvocationContext,
        event_ids: list[str],
        pending: dict[str, Any],
    ) -> list[tuple[str, str, dict, Optional[str]]]:
        results: list[tuple[str, str, dict, Optional[str]]] = []
        for eid in event_ids:
            tool_event = pending.get(eid)
            if tool_event is None:
                # The upstream `requires_action` log already captured the
                # full buffer state; here we just record the per-id miss
                # plus the empty-string-collision case explicitly because
                # it's the most likely root cause when this fires.
                logger.error(
                    "ManagedAgentBackend: required tool event not buffered",
                    extra={
                        "event_id": eid,
                        "buffered_keys": list(pending.keys()),
                        "empty_key_collision": "" in pending,
                    },
                )
                results.append((eid, "<unknown>", {}, "tool event not found"))
                continue
            name = getattr(tool_event, "name", "") or ""
            raw_input = getattr(tool_event, "input", None) or {}
            arguments = dict(raw_input) if isinstance(raw_input, dict) else {}
            tool = effective_tools.try_get(name)
            if tool is None:
                logger.error(
                    "ManagedAgentBackend: tool not registered on agent",
                    extra={"tool_name": name, "event_id": eid},
                )
                results.append((eid, name, {}, f"tool {name!r} not registered"))
                continue
            try:
                result = await tool.invoke(arguments, context=context)
            except Exception as tool_err:
                logger.exception(
                    "ManagedAgentBackend: tool invocation raised",
                    extra={"tool_name": name, "event_id": eid},
                )
                results.append((eid, name, {}, f"tool raised: {tool_err}"))
                continue
            if not isinstance(result, dict):
                logger.warning(
                    "ManagedAgentBackend: tool returned non-dict; coercing",
                    extra={"tool_name": name, "event_id": eid},
                )
                result = {"value": result}
            results.append((eid, name, result, None))
        return results

    async def _ensure_agent_id(
        self, agent: "BaseAgent", effective_tools: AgentToolRegistry
    ) -> str:
        key = self._fingerprint_agent(agent, effective_tools)
        cached = self._agent_ids.get(key)
        if cached is not None:
            return cached

        tools_payload = self._specs_to_tools(effective_tools.list_specs())
        managed = await self._client.beta.agents.create(
            name=f"agent-{agent.identity}",
            model=agent.model,
            system=agent.system_prompt,
            tools=tools_payload,
        )
        self._agent_ids[key] = managed.id
        logger.info(
            "ManagedAgentBackend: created managed agent",
            extra={
                "agent_id": managed.id,
                "identity": agent.identity,
                "model": agent.model,
                "tool_count": len(tools_payload),
            },
        )
        return managed.id

    async def _ensure_environment_id(self) -> str:
        if self._environment_id is not None:
            return self._environment_id
        env = await self._client.beta.environments.create(
            name=self._environment_name,
            config=self._environment_config,
        )
        self._environment_id = env.id
        logger.info(
            "ManagedAgentBackend: created managed environment",
            extra={
                "environment_id": env.id,
                "environment_name": self._environment_name,
            },
        )
        return env.id

    async def _create_session(
        self,
        *,
        agent_id: str,
        environment_id: str,
        title: str,
    ) -> str:
        session = await self._client.beta.sessions.create(
            agent=agent_id,
            environment_id=environment_id,
            title=title or "copass agent session",
        )
        logger.info(
            "ManagedAgentBackend: created session",
            extra={"session_id": session.id, "agent_id": agent_id},
        )
        return session.id

    def _fingerprint_agent(
        self, agent: "BaseAgent", effective_tools: AgentToolRegistry
    ) -> str:
        parts: list[str] = [
            agent.model,
            agent.system_prompt,
            f"builtin={self._include_builtin_toolset}",
        ]
        for spec in effective_tools.list_specs():
            parts.append(spec.name)
            parts.append(spec.description)
            parts.append(json.dumps(spec.input_schema, sort_keys=True, default=str))
        return sha256("\x00".join(parts).encode("utf-8")).hexdigest()

    def _specs_to_tools(self, specs) -> list[dict]:
        tools: list[dict] = []
        if self._include_builtin_toolset:
            tools.append({"type": "agent_toolset_20260401"})
        for spec in specs:
            tools.append(
                {
                    "type": "custom",
                    "name": spec.name,
                    "description": spec.description,
                    "input_schema": _sanitize_anthropic_input_schema(
                        spec.input_schema,
                    ),
                }
            )
        return tools

    def _normalize_messages(self, messages: Union[str, List[dict]]) -> list[dict]:
        if isinstance(messages, str):
            return [
                {
                    "type": "user.message",
                    "content": [{"type": "text", "text": messages}],
                }
            ]
        out: list[dict] = []
        for msg in messages or []:
            role = msg.get("role", "user") if isinstance(msg, dict) else "user"
            if role != "user":
                logger.warning(
                    "ManagedAgentBackend: skipping non-user message",
                    extra={"role": role},
                )
                continue
            content = msg.get("content", "") if isinstance(msg, dict) else ""
            if isinstance(content, str):
                blocks = [{"type": "text", "text": content}]
            elif isinstance(content, list):
                blocks = [
                    b if isinstance(b, dict) else {"type": "text", "text": str(b)}
                    for b in content
                ]
            else:
                blocks = [{"type": "text", "text": str(content)}]
            out.append({"type": "user.message", "content": blocks})
        return out


def _session_title(agent: "BaseAgent", context: AgentInvocationContext) -> str:
    pieces = [agent.identity]
    if context is not None and context.trace_id:
        pieces.append(context.trace_id)
    return ":".join(pieces)


def _serialize_tool_result(result: dict, error: Optional[str]) -> str:
    payload: dict = {"result": result}
    if error:
        payload["error"] = error
    try:
        return json.dumps(payload, default=str)
    except Exception:
        return json.dumps({"error": "unserializable tool result"})


__all__ = [
    "ManagedAgentBackend",
    "DEFAULT_ENVIRONMENT_CONFIG",
    "SESSION_ID_HANDLE",
]
