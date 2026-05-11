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


VAULT_IDS_HANDLE = "managed_agent_vault_ids"
"""Key under which callers may stash a list of Anthropic vault ids in
``AgentInvocationContext.handles``. When the backend is constructed
with ``use_gateway_mcp=True``, the caller is expected to have already
minted a per-session bearer, mirrored it via
``client.beta.vaults.credentials.create(...)`` with
:class:`BetaManagedAgentsStaticBearerCreateParams`, and stashed the
resulting vault id(s) here. The backend passes them through to
``sessions.create(vault_ids=...)`` so the managed session can resolve
the gateway MCP server's bearer at tool-call time.

Caller owns the lifecycle of the vault credentials (cleanup happens
when the operator deletes them on the Anthropic side, not by this
backend). The minted ``olk_`` bearer is ephemeral: it has no row in
the API-keys table and outlives the Anthropic session by construction
(per ADR 0029 §Implementation Plan §2 — the session is the lifecycle
anchor; the vault credential cannot be rotated mid-session)."""


USE_GATEWAY_MCP_HANDLE = "managed_agent_use_gateway_mcp"
"""Per-invocation override (``bool``) for the gateway-MCP path.

When present, takes precedence over the backend-level
``use_gateway_mcp`` constructor flag for THIS invocation only. Lets
the runtime experiment per-run (e.g. flag-on for one user while
flag-off for everyone else) without re-instantiating the backend
singleton. Default behavior (handle absent) is to use the
constructor-level flag, which is the typical deployment posture."""


DEFAULT_GATEWAY_MCP_URL = "https://mcp.copass.com/mcp"
"""ADR 0029: single, hard-coded gateway URL for the Anthropic surface.

The ADR explicitly calls out 'one gateway URL' as a stage-1
invariant (``docs/adr/0029-unified-mcp-integration.md:50-56``).
A future ADR can promote this to a config — for now keeping it as a
module-level constant prevents accidental per-deployment drift in
the cutover window."""


DEFAULT_GATEWAY_MCP_NAME = "copass"
"""Server name for the gateway MCP. Used in both the
``mcp_servers`` entry on ``agents.create`` AND the
``mcp_server_name`` field on the ``mcp_toolset`` tool entry —
the names MUST match for Anthropic to wire the toolset to the
server."""


_TOOL_USE_EVENT_TYPES = frozenset({
    # Locally-executed: we run the tool and reply with user.custom_tool_result
    # referencing ``custom_tool_use_id``.
    "agent.custom_tool_use",
    # Server-executed (Anthropic built-in toolset): we reply with
    # user.tool_confirmation(result="allow") referencing ``tool_use_id`` and
    # Anthropic runs the tool inside the managed environment.
    "agent.tool_use",
    # Server-executed (Anthropic-managed MCP server): same reply shape as
    # ``agent.tool_use``. Routing a managed-MCP event to user.custom_tool_result
    # is the exact failure that produces a 400 "waiting on responses to events
    # [...]" on the next send, because the ids never get satisfied.
    "agent.mcp_tool_use",
})

# Anthropic has been migrating session lifecycle from session-scoped to
# thread-scoped envelopes (``session.thread_status_idle`` etc.) ahead of the
# Python SDK's release cadence. Treat the new names as aliases of the SDK
# constants so we don't silently miss the requires_action signal — that's
# what stranded sessions in May 2026 incidents (sevt_ ids pending forever).
_IDLE_EVENT_TYPES = frozenset({
    "session.status_idle",
    "session.thread_status_idle",
})

_TERMINATED_EVENT_TYPES = frozenset({
    "session.status_terminated",
    "session.thread_status_terminated",
})

# Lifecycle / observability events that don't drive control flow. Listed so
# the catch-all "unknown event type" warning doesn't fire on every session
# — that warning is reserved for genuine schema drift we should investigate.
# Includes server echoes of events we sent (``user.*``), since the SDK
# replays them on the same stream.
_KNOWN_NOOP_EVENT_TYPES = frozenset({
    "session.status_running",
    "session.status_rescheduled",
    "session.deleted",
    "session.thread_status_running",
    "user.message",
    "user.custom_tool_result",
    "user.tool_confirmation",
    "user.tool_result",
    "user.interrupt",
    "agent.thinking",
    "agent.thread_context_compacted",
    "agent.tool_result",
    "agent.mcp_tool_result",
    "span.model_request_start",
})


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
        use_gateway_mcp: bool = False,
        gateway_mcp_url: str = DEFAULT_GATEWAY_MCP_URL,
        gateway_mcp_name: str = DEFAULT_GATEWAY_MCP_NAME,
        config: Optional[dict] = None,
    ) -> None:
        """Construct a ``ManagedAgentBackend``.

        Args:
            client: Pre-built ``AsyncAnthropic`` client. If omitted, one
                is constructed from ``api_key`` (falling back to the
                ``ANTHROPIC_API_KEY`` env var).
            api_key: Convenience for constructing the client when
                ``client`` is not supplied.
            environment_config: Managed-agents environment config dict.
            environment_name: Console-visible name for the managed
                environment.
            include_builtin_toolset: When True, enable Anthropic's
                built-in agent toolset alongside the agent's custom
                tools.
            delete_session_on_finish: When True, delete the managed
                session after the turn completes.
            use_gateway_mcp: ADR 0029 feature flag. When True, every
                ``agents.create`` call advertises the unified MCP
                gateway server (``gateway_mcp_url``) AND prepends an
                ``mcp_toolset`` tool entry, and every
                ``sessions.create`` call expects the caller to thread
                vault ids via ``context.handles[VAULT_IDS_HANDLE]`` —
                Anthropic resolves the gateway's per-user bearer from
                that vault credential at tool-call time. When False
                (default), the legacy custom-tool path is unchanged:
                the agent's registry tools are executed in-process and
                Anthropic only ever sees ``custom`` tool entries. A
                per-invocation override is available via
                ``context.handles[USE_GATEWAY_MCP_HANDLE]`` (bool) for
                experiments without re-instantiating the singleton.
            gateway_mcp_url: URL the ``mcp_servers`` entry points at.
                Defaults to :data:`DEFAULT_GATEWAY_MCP_URL`.
            gateway_mcp_name: Server name shared by the
                ``mcp_servers`` entry and the ``mcp_toolset`` tool
                entry. The two names MUST match for Anthropic to
                resolve the toolset to the server.
            config: Backend-level knobs (inherited from
                :class:`AgentBackend`).
        """
        super().__init__(config=config)
        if client is None:
            from anthropic import AsyncAnthropic as _AsyncAnthropic

            client = _AsyncAnthropic(api_key=api_key)
        self._client = client
        self._environment_config = dict(environment_config or DEFAULT_ENVIRONMENT_CONFIG)
        self._environment_name = environment_name
        self._include_builtin_toolset = include_builtin_toolset
        self._delete_session_on_finish = delete_session_on_finish
        self._use_gateway_mcp = bool(use_gateway_mcp)
        self._gateway_mcp_url = gateway_mcp_url
        self._gateway_mcp_name = gateway_mcp_name
        # Agent id cache fingerprints include ``use_gateway_mcp`` /
        # gateway URL / gateway server name so flipping the flag for
        # an in-process backend doesn't return a cached agent whose
        # ``mcp_servers`` shape is stale. The fingerprint helper
        # already keys on the full config dict — see
        # :meth:`_fingerprint_agent`.
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

        # ADR 0029: per-invocation override on top of the constructor
        # flag — lets the runtime switch the path without re-creating
        # the backend singleton. Absent handle = use constructor flag.
        use_gateway_mcp = self._use_gateway_mcp
        if context and context.handles:
            override = context.handles.get(USE_GATEWAY_MCP_HANDLE)
            if isinstance(override, bool):
                use_gateway_mcp = override

        agent_id = await self._ensure_agent_id(
            agent, effective_tools, use_gateway_mcp=use_gateway_mcp,
        )
        environment_id = await self._ensure_environment_id()

        supplied_session_id = (
            context.handles.get(SESSION_ID_HANDLE) if context and context.handles else None
        )
        # Per ADR 0029 §Implementation Plan §2 the runtime mints a
        # per-session ``olk_`` bearer, mirrors it via
        # ``client.beta.vaults.credentials.create(...)``, and stashes
        # the resulting vault id(s) under :data:`VAULT_IDS_HANDLE`.
        # When ``use_gateway_mcp`` is on but the handle is empty,
        # the session is created without ``vault_ids`` and the
        # gateway-side tool calls will 401 — log a warning so the
        # cutover gap is visible; do NOT raise (a stricter check
        # belongs in the runtime, where the mint failure can be
        # caught and the call refused before reaching the backend).
        vault_ids: Optional[list[str]] = None
        if context and context.handles:
            raw_vault_ids = context.handles.get(VAULT_IDS_HANDLE)
            if isinstance(raw_vault_ids, (list, tuple)):
                vault_ids = [str(v) for v in raw_vault_ids if v]
        if use_gateway_mcp and not vault_ids:
            logger.warning(
                "ManagedAgentBackend: use_gateway_mcp=True but no "
                "vault_ids supplied via context.handles[%r]; "
                "gateway MCP calls will lack a per-user bearer and "
                "the gateway will reject them at the auth boundary",
                VAULT_IDS_HANDLE,
            )

        created_session_id: Optional[str] = None
        if supplied_session_id:
            session_id = supplied_session_id
        else:
            session_id = await self._create_session(
                agent_id=agent_id,
                environment_id=environment_id,
                title=_session_title(agent, context),
                vault_ids=vault_ids,
            )
            created_session_id = session_id

        pending_tool_events: dict[str, Any] = {}
        # Per-event envelope tag (``agent.custom_tool_use`` |
        # ``agent.tool_use`` | ``agent.mcp_tool_use``). Drives which reply
        # event we POST back when ``requires_action`` cites the id — a
        # mismatch between use-event and reply-event types causes the
        # server to leave the event unresolved, which surfaces later as
        # a 400 ``waiting on responses to events [...]``.
        pending_tool_envelope: dict[str, str] = {}
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

                elif evt_type in _TOOL_USE_EVENT_TYPES:
                    # ``event.id`` is the same id that surfaces later in
                    # ``requires_action.event_ids`` and that we send back
                    # on the reply event. Without it we cannot route a
                    # result back, so abort loudly rather than silently
                    # bucket every id-less event under "" (the prior
                    # behaviour produced "tool event not found"
                    # placeholders that the API then rejected with
                    # "waiting on responses to events [...]" when the
                    # placeholder used the wrong event protocol).
                    #
                    # The reply event shape depends on ``evt_type``:
                    # ``agent.custom_tool_use`` → ``user.custom_tool_result``,
                    # ``agent.tool_use`` / ``agent.mcp_tool_use`` →
                    # ``user.tool_confirmation``. We remember the source
                    # type in ``pending_tool_envelope`` so the reply
                    # builder can pick the right one.
                    name = getattr(sdk_event, "name", "") or ""
                    if not evt_id:
                        logger.error(
                            "ManagedAgentBackend: tool-use event missing id — aborting run",
                            extra={
                                "session_id": session_id,
                                "event_type": evt_type,
                                # ``name`` collides with ``LogRecord.name`` —
                                # passing it via ``extra`` raises
                                # ``KeyError: "Attempt to overwrite 'name'"``
                                # at log time. Use ``tool_name`` instead.
                                "tool_name": name,
                                "event_repr": repr(sdk_event)[:500],
                            },
                        )
                        raise RuntimeError(
                            "ManagedAgentBackend: tool-use event "
                            f"({evt_type}) arrived without an id "
                            f"(name={name!r}); cannot respond — aborting run"
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
                                "incoming_type": evt_type,
                                "buffered_name": getattr(
                                    pending_tool_events[evt_id], "name", None
                                ),
                                "buffered_type": pending_tool_envelope.get(evt_id),
                            },
                        )
                    raw_input = getattr(sdk_event, "input", None) or {}
                    arguments = dict(raw_input) if isinstance(raw_input, dict) else {}
                    pending_tool_events[evt_id] = sdk_event
                    pending_tool_envelope[evt_id] = evt_type
                    yield AgentToolCall(
                        call_id=evt_id,
                        name=name,
                        arguments=arguments,
                    )

                elif evt_type in _IDLE_EVENT_TYPES:
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
                                envelope=pending_tool_envelope,
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
                            envelope=pending_tool_envelope,
                        )
                        for call_id, name, result, error, _src_type in results:
                            yield AgentToolResult(
                                call_id=call_id,
                                name=name,
                                result=result,
                                error=error,
                            )
                        if results:
                            reply_events = [
                                _build_user_event_for_tool_use(
                                    source_type=src_type,
                                    event_id=call_id,
                                    result=result,
                                    error=error,
                                )
                                for (call_id, _name, result, error, src_type) in results
                            ]
                            send_failure = await self._send_events_soft(
                                session_id=session_id,
                                events=reply_events,
                            )
                            if send_failure is not None:
                                # The reply was rejected by Anthropic (e.g.
                                # the session is wedged with sevt_ ids the
                                # server still considers pending). Abandon
                                # the run cleanly instead of letting the
                                # exception bubble out of the streaming
                                # generator — callers see a soft
                                # AgentFinish(error) and the credit-gate
                                # release path runs normally.
                                yield AgentFinish(
                                    stop_reason="error",
                                    usage=dict(usage_accumulator),
                                    session_id=session_id,
                                )
                                break
                        for call_id, *_ in results:
                            pending_tool_events.pop(call_id, None)
                            pending_tool_envelope.pop(call_id, None)
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

                elif evt_type in _TERMINATED_EVENT_TYPES:
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

                elif evt_type in _KNOWN_NOOP_EVENT_TYPES:
                    # Lifecycle / observability events we explicitly don't
                    # act on. Listed here (rather than left to the
                    # catch-all warning) so prod logs aren't drowned in
                    # "unknown event type" noise on every session — that
                    # warning is reserved for genuine schema drift.
                    pass

                else:
                    # Unknown event type — log once per type per session so
                    # we catch beta-API event-type drift (e.g. a renamed
                    # ``agent.custom_tool_use`` envelope, or a
                    # newly-introduced server-tool event class) before it
                    # silently breaks the requires_action path.
                    if evt_type and evt_type not in seen_unknown_event_types:
                        seen_unknown_event_types.add(evt_type)
                        # Embed ``evt_type`` in the message text so it
                        # surfaces even in formatters that drop the
                        # structured ``extra`` payload.
                        logger.warning(
                            "ManagedAgentBackend: unknown event type %r",
                            evt_type,
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
        envelope: dict[str, str],
        missing_ids: list[str],
    ) -> None:
        """Fetch the session's event log and re-bucket any tool-use
        events the streaming reader missed.

        Called when ``requires_action`` lists ids that never arrived on
        the SSE stream — either an ordering race vs the
        ``requires_action`` signal, or the SDK we're built against does
        not yet model the envelope the server actually emitted (the
        beta API ships event-type changes faster than the Python SDK).
        Accepts all three tool-use envelopes
        (:data:`_TOOL_USE_EVENT_TYPES`) and records the source type in
        ``envelope`` so the reply builder picks the right response
        shape. Failures are swallowed — recovery never makes things
        worse than the prior behavior.
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
                if evt_type not in _TOOL_USE_EVENT_TYPES:
                    logger.warning(
                        "ManagedAgentBackend: rehydrate skipped non-tool-use event",
                        extra={
                            "session_id": session_id,
                            "event_id": evt_id,
                            "event_type": evt_type,
                        },
                    )
                    continue
                # ``agent.tool_use`` / ``agent.mcp_tool_use`` are
                # confirmation-only — they don't carry ``input`` on the
                # use event because Anthropic executes them server-side.
                # Only ``agent.custom_tool_use`` is required to carry
                # ``input``, so don't reject the others for missing it.
                pending[evt_id] = sdk_event
                envelope[evt_id] = evt_type
                needed.discard(evt_id)
                logger.info(
                    "ManagedAgentBackend: rehydrated tool event from session log",
                    extra={
                        "session_id": session_id,
                        "event_id": evt_id,
                        "event_type": evt_type,
                        # ``name`` collides with ``LogRecord.name`` — see
                        # the matching note in the missing-id error above.
                        "tool_name": name,
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
        envelope: dict[str, str],
    ) -> list[tuple[str, str, dict, Optional[str], str]]:
        """Resolve each ``event_id`` to a (call_id, name, result, error,
        source_type) tuple.

        Only ``agent.custom_tool_use`` events are executed locally; the
        result is what we'll embed in the reply ``user.custom_tool_result``.
        ``agent.tool_use`` / ``agent.mcp_tool_use`` events are server-side
        — we return an empty result and the caller emits a
        ``user.tool_confirmation`` (allow) which lets Anthropic run the
        tool inside the managed environment.
        """
        results: list[tuple[str, str, dict, Optional[str], str]] = []
        for eid in event_ids:
            tool_event = pending.get(eid)
            src_type = envelope.get(eid, "agent.custom_tool_use")
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
                results.append((eid, "<unknown>", {}, "tool event not found", src_type))
                continue
            name = getattr(tool_event, "name", "") or ""
            if src_type != "agent.custom_tool_use":
                # Server-side execution path — we just confirm. ``result``
                # and ``error`` are unused by the ``user.tool_confirmation``
                # reply but we still surface a synthetic ``AgentToolResult``
                # upstream so the caller's tool-call log isn't blank.
                results.append((eid, name, {"confirmed": True}, None, src_type))
                continue
            raw_input = getattr(tool_event, "input", None) or {}
            arguments = dict(raw_input) if isinstance(raw_input, dict) else {}
            tool = effective_tools.try_get(name)
            if tool is None:
                logger.error(
                    "ManagedAgentBackend: tool not registered on agent",
                    extra={"tool_name": name, "event_id": eid},
                )
                results.append((eid, name, {}, f"tool {name!r} not registered", src_type))
                continue
            try:
                result = await tool.invoke(arguments, context=context)
            except Exception as tool_err:
                logger.exception(
                    "ManagedAgentBackend: tool invocation raised",
                    extra={"tool_name": name, "event_id": eid},
                )
                results.append((eid, name, {}, f"tool raised: {tool_err}", src_type))
                continue
            if not isinstance(result, dict):
                logger.warning(
                    "ManagedAgentBackend: tool returned non-dict; coercing",
                    extra={"tool_name": name, "event_id": eid},
                )
                result = {"value": result}
            results.append((eid, name, result, None, src_type))
        return results

    async def _send_events_soft(
        self,
        *,
        session_id: str,
        events: list[dict],
    ) -> Optional[Exception]:
        """POST reply events to the session. Returns ``None`` on success
        or the exception on a non-fatal failure.

        Anthropic returns 400 when a previously-sent reply used the
        wrong envelope (e.g. ``user.custom_tool_result`` referencing an
        ``agent.mcp_tool_use`` id) — the next send sees the still-pending
        sevt_ ids in the error. Letting that propagate as an uncaught
        ``BadRequestError`` corrupts the streaming generator and skips
        the credit-gate release. Catch it here and let the caller emit
        a soft AgentFinish(error) instead.
        """
        try:
            await self._client.beta.sessions.events.send(session_id, events=events)
            return None
        except Exception as exc:
            logger.error(
                "ManagedAgentBackend: events.send rejected — terminating run",
                extra={
                    "session_id": session_id,
                    "event_types": [e.get("type") for e in events],
                    "error": str(exc),
                },
            )
            # Best-effort interrupt so the server-side session isn't left
            # spinning. Failures here are swallowed — we've already
            # decided to abandon the run.
            try:
                await self._client.beta.sessions.events.send(
                    session_id,
                    events=[{"type": "user.interrupt"}],
                )
            except Exception:
                logger.exception(
                    "ManagedAgentBackend: user.interrupt after send failure also failed",
                    extra={"session_id": session_id},
                )
            return exc

    async def _ensure_agent_id(
        self,
        agent: "BaseAgent",
        effective_tools: AgentToolRegistry,
        *,
        use_gateway_mcp: Optional[bool] = None,
    ) -> str:
        """Resolve (or create) the Anthropic managed-agent id for this
        ``BaseAgent`` config.

        When ``use_gateway_mcp`` is True (per-invocation override; falls
        back to the constructor flag) the ``agents.create`` call also
        registers the gateway MCP server in ``mcp_servers`` and prepends
        an ``mcp_toolset`` tool entry so Anthropic surfaces every
        gateway-side tool to the model natively (single one-tool shim
        on the gateway → `invoke_integration_tool`, but the toolset
        envelope is required for Anthropic to wire the server). The
        fingerprint includes the gateway settings so flipping the flag
        does not return a stale cached agent.
        """
        gateway_on = (
            self._use_gateway_mcp if use_gateway_mcp is None else bool(use_gateway_mcp)
        )
        key = self._fingerprint_agent(
            agent, effective_tools, use_gateway_mcp=gateway_on,
        )
        cached = self._agent_ids.get(key)
        if cached is not None:
            return cached

        tools_payload = self._specs_to_tools(
            effective_tools.list_specs(),
            use_gateway_mcp=gateway_on,
        )

        create_kwargs: dict[str, Any] = dict(
            name=f"agent-{agent.identity}",
            model=agent.model,
            system=agent.system_prompt,
            tools=tools_payload,
        )
        if gateway_on:
            # ADR 0029: one MCP server, one tool shim. The server name
            # MUST match the ``mcp_server_name`` on the corresponding
            # ``mcp_toolset`` tool entry (set in ``_specs_to_tools``).
            create_kwargs["mcp_servers"] = [
                {
                    "name": self._gateway_mcp_name,
                    "type": "url",
                    "url": self._gateway_mcp_url,
                },
            ]

        managed = await self._client.beta.agents.create(**create_kwargs)
        self._agent_ids[key] = managed.id
        logger.info(
            "ManagedAgentBackend: created managed agent",
            extra={
                "agent_id": managed.id,
                "identity": agent.identity,
                "model": agent.model,
                "tool_count": len(tools_payload),
                "use_gateway_mcp": gateway_on,
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
        vault_ids: Optional[list[str]] = None,
    ) -> str:
        """Create a fresh managed-agents session.

        ``vault_ids`` is the optional list of Anthropic vault ids the
        caller has minted credentials in. When provided, Anthropic
        resolves the static-bearer credential against the gateway MCP
        server's URL at tool-call time so per-user scope flows on the
        bearer alone (ADR 0029 §Implementation Plan §2). When omitted,
        the session has no per-user bearer and gateway-side calls will
        401 — the caller (typically :class:`PassthroughRuntime`) owns
        the bearer-mint lifecycle.
        """
        create_kwargs: dict[str, Any] = dict(
            agent=agent_id,
            environment_id=environment_id,
            title=title or "copass agent session",
        )
        if vault_ids:
            create_kwargs["vault_ids"] = list(vault_ids)
        session = await self._client.beta.sessions.create(**create_kwargs)
        logger.info(
            "ManagedAgentBackend: created session",
            extra={
                "session_id": session.id,
                "agent_id": agent_id,
                "vault_id_count": len(vault_ids) if vault_ids else 0,
            },
        )
        return session.id

    def _fingerprint_agent(
        self,
        agent: "BaseAgent",
        effective_tools: AgentToolRegistry,
        *,
        use_gateway_mcp: Optional[bool] = None,
    ) -> str:
        gateway_on = (
            self._use_gateway_mcp if use_gateway_mcp is None else bool(use_gateway_mcp)
        )
        parts: list[str] = [
            agent.model,
            agent.system_prompt,
            f"builtin={self._include_builtin_toolset}",
            f"gateway_mcp={gateway_on}",
            f"gateway_url={self._gateway_mcp_url}",
            f"gateway_name={self._gateway_mcp_name}",
        ]
        for spec in effective_tools.list_specs():
            parts.append(spec.name)
            parts.append(spec.description)
            parts.append(json.dumps(spec.input_schema, sort_keys=True, default=str))
        return sha256("\x00".join(parts).encode("utf-8")).hexdigest()

    def _specs_to_tools(
        self,
        specs,
        *,
        use_gateway_mcp: Optional[bool] = None,
    ) -> list[dict]:
        gateway_on = (
            self._use_gateway_mcp if use_gateway_mcp is None else bool(use_gateway_mcp)
        )
        tools: list[dict] = []
        if self._include_builtin_toolset:
            tools.append({"type": "agent_toolset_20260401"})
        if gateway_on:
            # ADR 0029: ``mcp_toolset`` references the server by name
            # — the name MUST match the corresponding ``mcp_servers``
            # entry on ``agents.create``. ``permission_policy`` lives
            # under ``default_config`` per
            # ``BetaManagedAgentsMCPToolsetParams`` and is itself a
            # typed dict ``{"type": "always_allow"}`` per
            # ``BetaManagedAgentsAlwaysAllowPolicyParam`` — a flat
            # ``"permission_policy": "always_allow"`` is rejected by
            # the API as ``tools.N.permission_policy: Extra inputs are
            # not permitted``. ``always_allow`` is the accepted
            # trade-off (gateway is the real enforcement point); see
            # ADR 0029 §Accepted Trade-Offs §3.
            tools.append(
                {
                    "type": "mcp_toolset",
                    "mcp_server_name": self._gateway_mcp_name,
                    "default_config": {
                        "permission_policy": {"type": "always_allow"},
                    },
                }
            )
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


def _build_user_event_for_tool_use(
    *,
    source_type: str,
    event_id: str,
    result: dict,
    error: Optional[str],
) -> dict:
    """Map a buffered ``agent.*_tool_use`` event to the correct reply envelope.

    The Anthropic Managed Agents API rejects an entire ``events.send``
    batch with HTTP 400 if any item's envelope doesn't match the source
    event's envelope. The mapping is:

    * ``agent.custom_tool_use`` → ``user.custom_tool_result`` (we run the
      tool; ``content`` carries the serialized result).
    * ``agent.tool_use`` / ``agent.mcp_tool_use`` →
      ``user.tool_confirmation`` (Anthropic runs the tool server-side; we
      just allow/deny). We always allow here — denying would require a
      separate policy layer that the backend doesn't own.

    Unknown source types fall back to ``user.custom_tool_result`` shape;
    if Anthropic later rejects the batch, ``_send_events_soft`` will
    catch the 400 and the run terminates gracefully.
    """
    if source_type == "agent.custom_tool_use":
        return {
            "type": "user.custom_tool_result",
            "custom_tool_use_id": event_id,
            "content": [
                {
                    "type": "text",
                    "text": _serialize_tool_result(result, error),
                }
            ],
        }
    if source_type in ("agent.tool_use", "agent.mcp_tool_use"):
        return {
            "type": "user.tool_confirmation",
            "tool_use_id": event_id,
            "result": "allow",
        }
    return {
        "type": "user.custom_tool_result",
        "custom_tool_use_id": event_id,
        "content": [
            {"type": "text", "text": _serialize_tool_result(result, error)}
        ],
    }


__all__ = [
    "ManagedAgentBackend",
    "DEFAULT_ENVIRONMENT_CONFIG",
    "DEFAULT_GATEWAY_MCP_NAME",
    "DEFAULT_GATEWAY_MCP_URL",
    "SESSION_ID_HANDLE",
    "USE_GATEWAY_MCP_HANDLE",
    "VAULT_IDS_HANDLE",
]
