"""ManagedAgentBackendV2 — stream-first server-authoritative cycle backend.

Implements :class:`AgentBackend` on top of the Anthropic managed-agents
API. v2 fixes the May 2026 prod failure (ADR 0001 §1.1) by:

1. Building a local ``events_by_id: dict[str, PendingToolCall]`` from
   the SSE stream as ``agent.*_tool_use`` events arrive. This is
   Anthropic's documented canonical pattern.
2. Treating ``requires_action.stop.event_ids`` as authoritative. A
   ``RequiresActionCycle`` is constructed per signal; any requested id
   not in ``events_by_id`` is a hard programmer error — we POST
   ``user.interrupt`` and yield ``AgentFinish(error)``. There is no
   ``events.list`` recovery path during a live stream.
3. Modeling the three tool-use envelopes as a sealed
   :data:`PendingToolCall` union. The reply-event builder is a method
   on the variant; the string-dispatch ladder v1 had at four call
   sites is gone.
4. Deleting all in-process caches (``self._agent_ids``,
   ``self._environment_id``). Provider-side ids live in a
   :class:`ProviderBindingRegistry`; the registry's
   ``get_or_provision`` is race-safe across pods.

ABC-stream pattern: ``stream`` is declared ``async def`` with ``yield``
statements (Python async generator). It implements
:meth:`AgentBackend.stream`'s ``def → AsyncIterator[AgentEvent]``
declaration. Python accepts this. **Do not refactor to
``async def stream(...) -> AsyncIterator[AgentEvent]: return
self._stream_impl(...)``** — that breaks the generator semantics
callers rely on.

Policy enforcement: ``BackendRunPolicy.total_timeout_s`` wraps the
entire ``stream()`` body INCLUDING the ``finally`` cleanup so a wedged
session cannot hold a coroutine open past the policy budget (Risk 8).
``cycle_timeout_s`` wraps the per-cycle wait for SSE events.
``max_cycles`` caps the number of ``requires_action`` rounds.
"""

from __future__ import annotations

import asyncio
import json
import logging
from hashlib import sha256
from typing import (
    TYPE_CHECKING,
    Any,
    AsyncIterator,
    List,
    Optional,
    Union,
)

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
from copass_anthropic_agents.backends._stream_event_types import (
    _IDLE_EVENT_TYPES,
    _KNOWN_NOOP_EVENT_TYPES,
    _TERMINATED_EVENT_TYPES,
)
from copass_anthropic_agents.backends.backend_run_policy import BackendRunPolicy
from copass_anthropic_agents.backends.pending_tool_call import (
    ENVELOPE_CUSTOM_TOOL_USE,
    ENVELOPE_MCP_TOOL_USE,
    ENVELOPE_SERVER_TOOL_USE,
    CustomToolCall,
    McpToolCall,
    PendingToolCall,
    ServerToolCall,
)
from copass_anthropic_agents.backends.provider_binding_registry import (
    ProviderBinding,
    ProviderBindingRegistry,
)
from copass_anthropic_agents.backends.requires_action_cycle import (
    MissingPendingToolCallError,
    OutOfCycleReplyError,
    RequiresActionCycle,
)

if TYPE_CHECKING:
    from anthropic import AsyncAnthropic
    from copass_core_agents.base_agent import BaseAgent

# Lazy-import ``BadRequestError`` — library adopters who don't install
# the Anthropic SDK should not crash at module load. The shim falls
# back to :class:`Exception` so the except-clause type-checks against
# something resolvable in either environment.
try:
    from anthropic import BadRequestError as _BadRequestError  # type: ignore[assignment]
except ImportError:  # pragma: no cover - exercised in adopter envs only
    _BadRequestError = Exception  # type: ignore[assignment,misc]


logger = logging.getLogger(__name__)


# Re-exports preserved from v1 — adopters who import handles by string
# constant should not have to change their import sites to switch to
# v2. Values are verbatim copies; the v1 module retains its own.
DEFAULT_ENVIRONMENT_CONFIG: dict = {
    "type": "cloud",
    "networking": {"type": "unrestricted"},
}

SESSION_ID_HANDLE = "managed_agent_session_id"
"""Caller-supplied managed-agents session id. See v1 module for the
full lifecycle docstring; preserved verbatim to keep adopters
runnable on either backend."""

VAULT_IDS_HANDLE = "managed_agent_vault_ids"
"""Caller-supplied list of Anthropic vault ids for the gateway MCP
path. See v1 module for the full ADR 0029 lifecycle docstring."""

USE_GATEWAY_MCP_HANDLE = "managed_agent_use_gateway_mcp"
"""Per-invocation override for the gateway-MCP path. See v1 module
for the full docstring."""

DEFAULT_GATEWAY_MCP_URL = "https://mcp.copass.com/mcp"
DEFAULT_GATEWAY_MCP_NAME = "copass"

# Provider key for :class:`ProviderBindingRegistry` lookups. Phase 1
# only has the one provider; the constant is here so a future
# ``openai_responses`` binding can co-exist on the same JSON column
# without code drift.
PROVIDER_ANTHROPIC_MANAGED = "anthropic_managed"

# stop_reason strings the v2 backend emits. Locked here so telemetry
# queries against them stay stable across rollout phases.
STOP_REASON_END_TURN = "end_turn"
STOP_REASON_ERROR = "error"
STOP_REASON_TERMINATED = "terminated"
STOP_REASON_REQUIRES_ACTION_MISSING_EVENT_ID = "requires_action_missing_event_id"
STOP_REASON_POLICY_MAX_CYCLES_EXHAUSTED = "policy_max_cycles_exhausted"
STOP_REASON_POLICY_TOTAL_TIMEOUT = "policy_total_timeout"
STOP_REASON_BAD_REQUEST = "bad_request"
STOP_REASON_OUT_OF_CYCLE_REPLY = "out_of_cycle_reply"


def _session_title(agent: "BaseAgent", context: AgentInvocationContext) -> str:
    """Concatenate the agent identity and trace id for the console title."""
    pieces = [agent.identity]
    if context is not None and context.trace_id:
        pieces.append(context.trace_id)
    return ":".join(pieces)


class ManagedAgentBackendV2(AgentBackend):
    """v2 :class:`AgentBackend` for Anthropic Managed Agents.

    Construction is stateless: no in-process ``self._agent_ids`` /
    ``self._environment_id``. Provider-side identifiers are resolved
    through the injected :class:`ProviderBindingRegistry` on every
    call. Across a fleet on a fresh deploy, the registry's CAS UPDATE
    ensures exactly one Anthropic ``agents.create`` per fingerprint
    revision (vs. v1's one per pod per fingerprint revision).

    Args:
        client: Pre-built ``AsyncAnthropic`` client. If omitted, one
            is constructed from ``api_key`` (falling back to the
            ``ANTHROPIC_API_KEY`` env var).
        api_key: Convenience for constructing the client.
        registry: :class:`ProviderBindingRegistry` implementation. The
            backend NEVER imports a DB driver; the runtime injects
            whichever registry matches the deployment.
        policy: :class:`BackendRunPolicy` carrying ``max_cycles``,
            ``cycle_timeout_s``, ``total_timeout_s``. Default is the
            ADR-locked ``(20, 60, 300)``.
        environment_config: Managed-agents environment config dict.
        environment_name: Console-visible name for the managed
            environment.
        include_builtin_toolset: When True, enable Anthropic's
            built-in agent toolset alongside the agent's custom tools.
        delete_session_on_finish: When True, delete the managed
            session after the turn completes.
        use_gateway_mcp: ADR 0029 feature flag.
        gateway_mcp_url: URL the ``mcp_servers`` entry points at.
        gateway_mcp_name: Server name shared by the ``mcp_servers``
            entry and the ``mcp_toolset`` tool entry.
        config: Backend-level knobs (inherited from
            :class:`AgentBackend`).
    """

    def __init__(
        self,
        *,
        registry: ProviderBindingRegistry,
        client: Optional["AsyncAnthropic"] = None,
        api_key: Optional[str] = None,
        policy: Optional[BackendRunPolicy] = None,
        environment_config: Optional[dict] = None,
        environment_name: str = "copass-agents-env",
        include_builtin_toolset: bool = False,
        delete_session_on_finish: bool = False,
        use_gateway_mcp: bool = False,
        gateway_mcp_url: str = DEFAULT_GATEWAY_MCP_URL,
        gateway_mcp_name: str = DEFAULT_GATEWAY_MCP_NAME,
        config: Optional[dict] = None,
    ) -> None:
        super().__init__(config=config)
        if client is None:
            # Lazy import mirrors v1's pattern — library adopters who
            # don't install the SDK shouldn't crash at module load.
            from anthropic import AsyncAnthropic as _AsyncAnthropic

            client = _AsyncAnthropic(api_key=api_key)
        self._client = client
        self._registry = registry
        self._policy = policy if policy is not None else BackendRunPolicy.default()
        self._environment_config = dict(environment_config or DEFAULT_ENVIRONMENT_CONFIG)
        self._environment_name = environment_name
        self._include_builtin_toolset = include_builtin_toolset
        self._delete_session_on_finish = delete_session_on_finish
        self._use_gateway_mcp = bool(use_gateway_mcp)
        self._gateway_mcp_url = gateway_mcp_url
        self._gateway_mcp_name = gateway_mcp_name

        # Decision 3's structural invariant: NO in-process caches. If
        # this assertion fires you've reintroduced the v1 cost-surprise
        # vector. Tests in tests/test_managed_agent_backend_v2_stream.py
        # assert against ``hasattr(backend, "_agent_ids")``.
        assert not hasattr(self, "_agent_ids"), (
            "ManagedAgentBackendV2: _agent_ids attribute reintroduced; "
            "v2 must be stateless across invocations (Decision 3)"
        )
        assert not hasattr(self, "_environment_id"), (
            "ManagedAgentBackendV2: _environment_id attribute reintroduced; "
            "v2 must be stateless across invocations (Decision 3)"
        )

    async def run(
        self,
        agent: "BaseAgent",
        messages: Union[str, List[dict]],
        context: AgentInvocationContext,
    ) -> AgentRunResult:
        """Drain :meth:`stream` into an :class:`AgentRunResult`.

        Body is the same shape as v1's ``run`` — concatenates text
        deltas, records tool-call outcomes, captures the terminal
        finish event.
        """
        final_text_parts: list[str] = []
        tool_calls_log: list[dict] = []
        stop_reason = STOP_REASON_END_TURN
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
        """Drive a turn, yielding :class:`AgentEvent` as they occur.

        See module docstring for the cycle model. Total runtime is
        bounded by ``self._policy.total_timeout_s``.

        Python 3.11 ships :func:`asyncio.timeout` as a context manager
        that integrates naturally with async generators. We support
        Python 3.10 (``pyproject.toml`` declares
        ``requires-python = ">=3.10"``), so the wrapper uses
        :func:`asyncio.wait_for` around each ``__anext__`` call
        against the inner generator. The cumulative budget across all
        ``__anext__`` calls equals ``total_timeout_s``. The ``finally``
        cleanup inside ``_stream_impl`` runs under the remaining
        budget — Risk 8's invariant.
        """
        loop = asyncio.get_event_loop()
        deadline = loop.time() + self._policy.total_timeout_s
        inner = self._stream_impl(agent, messages, context).__aiter__()
        timed_out = False
        try:
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    timed_out = True
                    break
                try:
                    evt = await asyncio.wait_for(
                        inner.__anext__(), timeout=remaining,
                    )
                except StopAsyncIteration:
                    break
                except asyncio.TimeoutError:
                    timed_out = True
                    break
                yield evt
        finally:
            # Run the inner generator's ``finally`` (stream.close, etc).
            # ``aclose`` is bounded by the remaining budget or a small
            # epsilon so a wedged session can't hold the coroutine open.
            close_budget = max(deadline - loop.time(), 1.0)
            try:
                await asyncio.wait_for(inner.aclose(), timeout=close_budget)
            except asyncio.TimeoutError:
                logger.warning(
                    "ManagedAgentBackendV2: aclose() exceeded budget",
                    extra={"close_budget_s": close_budget},
                )
            except Exception:
                logger.exception(
                    "ManagedAgentBackendV2: aclose() raised",
                )

        if timed_out:
            logger.error(
                "ManagedAgentBackendV2: total_timeout_s exceeded",
                extra={
                    "total_timeout_s": self._policy.total_timeout_s,
                    "trace_id": context.trace_id if context is not None else None,
                },
            )
            yield AgentFinish(
                stop_reason=STOP_REASON_POLICY_TOTAL_TIMEOUT,
                usage={},
                session_id=None,
            )

    async def _stream_impl(
        self,
        agent: "BaseAgent",
        messages: Union[str, List[dict]],
        context: AgentInvocationContext,
    ) -> AsyncIterator[AgentEvent]:
        """Implementation of :meth:`stream`, minus the total-timeout
        wrapper.

        Pulled into a private method so :meth:`stream`'s
        ``asyncio.timeout`` block is the only thing in the outer
        generator — keeps the timeout semantics tight and the public
        method easy to reason about.
        """
        user_events = self._normalize_messages(messages)
        if not user_events:
            raise ValueError(
                "ManagedAgentBackendV2: messages must contain at least one "
                "user-role message"
            )

        effective_tools = await agent.build_tools(context)

        # Per-invocation override on top of the constructor flag.
        use_gateway_mcp = self._use_gateway_mcp
        if context and context.handles:
            override = context.handles.get(USE_GATEWAY_MCP_HANDLE)
            if isinstance(override, bool):
                use_gateway_mcp = override

        fingerprint = self._fingerprint_agent(
            agent, effective_tools, use_gateway_mcp=use_gateway_mcp,
        )

        # Phase 1 uses a stub ``for_version=1`` per Risk 3 — the
        # ``copass_agents.version`` semantics open question is owned
        # by the Phase 2 runtime brief.
        for_version = 1

        # Race-safe provisioning. The registry guarantees one
        # ``agents.create`` per fingerprint revision across the fleet.
        binding = await self._registry.get_or_provision(
            user_id=context.user_id,
            agent_id=agent.identity,
            provider=PROVIDER_ANTHROPIC_MANAGED,
            for_version=for_version,
            provision=lambda: self._provision_anthropic_agent(
                agent=agent,
                effective_tools=effective_tools,
                use_gateway_mcp=use_gateway_mcp,
                fingerprint=fingerprint,
                for_version=for_version,
            ),
        )

        supplied_session_id = (
            context.handles.get(SESSION_ID_HANDLE)
            if context and context.handles
            else None
        )

        vault_ids: Optional[list[str]] = None
        if context and context.handles:
            raw_vault_ids = context.handles.get(VAULT_IDS_HANDLE)
            if isinstance(raw_vault_ids, (list, tuple)):
                vault_ids = [str(v) for v in raw_vault_ids if v]
        if use_gateway_mcp and not vault_ids:
            logger.warning(
                "ManagedAgentBackendV2: use_gateway_mcp=True but no "
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
                agent_id=binding.agent_id,
                environment_id=binding.environment_id,
                title=_session_title(agent, context),
                vault_ids=vault_ids,
            )
            created_session_id = session_id

        # Local SSE-built buffer. The ONLY path that populates this is
        # the stream itself — ADR 0001 Decision 2.
        events_by_id: dict[str, PendingToolCall] = {}
        usage_accumulator: dict = {}
        seen_unknown_event_types: set[str] = set()
        cycle_count = 0
        finished = False

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
                    continue

                if evt_type in (
                    ENVELOPE_CUSTOM_TOOL_USE,
                    ENVELOPE_SERVER_TOOL_USE,
                    ENVELOPE_MCP_TOOL_USE,
                ):
                    name = getattr(sdk_event, "name", "") or ""
                    if not evt_id:
                        logger.error(
                            "ManagedAgentBackendV2: tool-use event missing id — aborting run",
                            extra={
                                "session_id": session_id,
                                "event_type": evt_type,
                                # ``name`` collides with ``LogRecord.name`` —
                                # see Risk 7 / v1 :478-484.
                                "tool_name": name,
                                "event_repr": repr(sdk_event)[:500],
                            },
                        )
                        raise RuntimeError(
                            "ManagedAgentBackendV2: tool-use event "
                            f"({evt_type}) arrived without an id "
                            f"(name={name!r}); cannot respond — aborting run"
                        )
                    call = self._build_pending_tool_call(sdk_event, evt_type, evt_id, name)
                    events_by_id[evt_id] = call
                    arguments = (
                        dict(call.arguments)
                        if isinstance(call, CustomToolCall)
                        else {}
                    )
                    yield AgentToolCall(
                        call_id=evt_id,
                        name=name,
                        arguments=arguments,
                    )
                    continue

                if evt_type in _IDLE_EVENT_TYPES:
                    stop = getattr(sdk_event, "stop_reason", None)
                    stop_type = (
                        getattr(stop, "type", None) if stop is not None else None
                    )

                    if stop_type == "requires_action":
                        if cycle_count >= self._policy.max_cycles:
                            logger.error(
                                "ManagedAgentBackendV2: max_cycles exceeded",
                                extra={
                                    "session_id": session_id,
                                    "max_cycles": self._policy.max_cycles,
                                },
                            )
                            await self._send_interrupt_soft(session_id)
                            yield AgentFinish(
                                stop_reason=STOP_REASON_POLICY_MAX_CYCLES_EXHAUSTED,
                                usage=dict(usage_accumulator),
                                session_id=session_id,
                            )
                            finished = True
                            break

                        cycle_count += 1
                        event_ids = list(getattr(stop, "event_ids", None) or [])
                        cycle = RequiresActionCycle(
                            cycle_id=str(evt_id or f"cycle-{cycle_count}"),
                            requested_ids=frozenset(event_ids),
                        )

                        # Per-cycle wait: if the SSE stream raced and the
                        # use events haven't surfaced yet, bound the
                        # wait by ``cycle_timeout_s``.
                        try:
                            calls = await asyncio.wait_for(
                                self._await_pending_calls(
                                    cycle=cycle,
                                    events_by_id=events_by_id,
                                    stream=stream,
                                ),
                                timeout=self._policy.cycle_timeout_s,
                            )
                        except (asyncio.TimeoutError, MissingPendingToolCallError) as exc:
                            logger.error(
                                "ManagedAgentBackendV2: requires_action ids not buffered — interrupting",
                                extra={
                                    "session_id": session_id,
                                    "requested_ids": event_ids,
                                    "buffered_ids": list(events_by_id.keys()),
                                    "error": str(exc),
                                },
                            )
                            await self._send_interrupt_soft(session_id)
                            yield AgentFinish(
                                stop_reason=STOP_REASON_REQUIRES_ACTION_MISSING_EVENT_ID,
                                usage=dict(usage_accumulator),
                                session_id=session_id,
                            )
                            finished = True
                            break

                        # Execute / build replies for each call. Per-variant
                        # polymorphism replaces v1's string-dispatch ladder.
                        replies: list[dict] = []
                        for call in calls:
                            if isinstance(call, CustomToolCall):
                                reply = await call.execute_and_build_reply(
                                    effective_tools, context,
                                )
                                # Surface a synthetic AgentToolResult so the
                                # caller's tool-call log isn't blank — the
                                # result envelope itself doesn't carry the
                                # ``result`` dict separately so re-parse it.
                                yield AgentToolResult(
                                    call_id=call.event_id,
                                    name=call.name,
                                    result=_decode_custom_result(reply),
                                    error=_decode_custom_error(reply),
                                )
                            else:
                                reply = call.build_reply()
                                # Server-side execution; emit a synthetic
                                # confirmation result for telemetry.
                                yield AgentToolResult(
                                    call_id=call.event_id,
                                    name=call.name,
                                    result={"confirmed": True},
                                    error=None,
                                )
                            replies.append(reply)

                        # Cycle barrier + atomic send. Out-of-cycle ids
                        # raise BEFORE the POST; BadRequestError from
                        # the POST is terminal.
                        try:
                            await cycle.send_replies(
                                self._client, session_id, replies,
                            )
                        except _BadRequestError as exc:
                            logger.error(
                                "ManagedAgentBackendV2: BadRequestError on cycle send — terminating run",
                                extra={
                                    "session_id": session_id,
                                    "cycle_id": cycle.cycle_id,
                                    "error": str(exc),
                                },
                            )
                            await self._send_interrupt_soft(session_id)
                            yield AgentFinish(
                                stop_reason=STOP_REASON_BAD_REQUEST,
                                usage=dict(usage_accumulator),
                                session_id=session_id,
                            )
                            finished = True
                            break
                        except OutOfCycleReplyError as exc:
                            # Programmer error — surfaces as the type-level
                            # guarantee Decision 2 calls out. Log + yield
                            # error rather than crash the generator mid-
                            # yield so the credit-gate release path runs.
                            logger.error(
                                "ManagedAgentBackendV2: OutOfCycleReplyError — programmer error",
                                extra={
                                    "session_id": session_id,
                                    "cycle_id": cycle.cycle_id,
                                    "error": str(exc),
                                },
                            )
                            await self._send_interrupt_soft(session_id)
                            yield AgentFinish(
                                stop_reason=STOP_REASON_OUT_OF_CYCLE_REPLY,
                                usage=dict(usage_accumulator),
                                session_id=session_id,
                            )
                            finished = True
                            break

                        # Pop executed entries from the buffer so a
                        # second cycle citing the same id (shouldn't
                        # happen, but harmless if it does) re-resolves
                        # against the right state.
                        for executed_id in cycle.executed_ids:
                            events_by_id.pop(executed_id, None)
                        continue

                    elif stop_type == "end_turn":
                        yield AgentFinish(
                            stop_reason=STOP_REASON_END_TURN,
                            usage=dict(usage_accumulator),
                            session_id=session_id,
                        )
                        finished = True
                        break
                    else:
                        yield AgentFinish(
                            stop_reason=str(stop_type or "unknown"),
                            usage=dict(usage_accumulator),
                            session_id=session_id,
                        )
                        finished = True
                        break

                if evt_type in _TERMINATED_EVENT_TYPES:
                    yield AgentFinish(
                        stop_reason=STOP_REASON_TERMINATED,
                        usage=dict(usage_accumulator),
                        session_id=session_id,
                    )
                    finished = True
                    break

                if evt_type == "session.error":
                    err = getattr(sdk_event, "error", None)
                    err_msg = getattr(err, "message", None) if err is not None else None
                    logger.warning(
                        "ManagedAgentBackendV2: session.error received",
                        extra={"session_id": session_id, "error": err_msg},
                    )
                    yield AgentFinish(
                        stop_reason=STOP_REASON_ERROR,
                        usage=dict(usage_accumulator),
                        session_id=session_id,
                    )
                    finished = True
                    break

                if evt_type == "span.model_request_end":
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
                                usage_accumulator[key] = (
                                    usage_accumulator.get(key, 0) + v
                                )
                    continue

                if evt_type in _KNOWN_NOOP_EVENT_TYPES:
                    continue

                # Unknown — log once per type per session.
                if evt_type and evt_type not in seen_unknown_event_types:
                    seen_unknown_event_types.add(evt_type)
                    logger.warning(
                        "ManagedAgentBackendV2: unknown event type %r",
                        evt_type,
                        extra={
                            "session_id": session_id,
                            "event_type": evt_type,
                            "event_id": evt_id,
                            "event_repr": repr(sdk_event)[:500],
                        },
                    )

            if not finished:
                # Stream ended without an explicit terminal event.
                # Emit a finish so downstream consumers know.
                yield AgentFinish(
                    stop_reason=STOP_REASON_END_TURN,
                    usage=dict(usage_accumulator),
                    session_id=session_id,
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
                        "ManagedAgentBackendV2: session cleanup failed",
                        extra={
                            "session_id": created_session_id,
                            "error": str(cleanup_err),
                        },
                    )

    async def _await_pending_calls(
        self,
        *,
        cycle: RequiresActionCycle,
        events_by_id: dict[str, PendingToolCall],
        stream: Any,
    ) -> List[PendingToolCall]:
        """Block until ``events_by_id`` covers every requested id, then
        return the resolved calls.

        The wait is bounded by ``BackendRunPolicy.cycle_timeout_s`` via
        the caller's :func:`asyncio.wait_for`. If the SSE stream
        terminates before all ids are buffered, the call raises
        :class:`MissingPendingToolCallError` so the caller can
        ``user.interrupt`` and finish with error.

        Phase 1 implements the simplest correct behavior: if the
        buffer already covers the cycle (no race), resolve immediately;
        otherwise raise the missing error. The brief's recommended
        long-running buffering is achieved at the stream-loop layer:
        we never enter this method except at ``requires_action`` time,
        at which point the SSE iterator has already drained every
        event the server has emitted up to the ``requires_action``
        signal. A genuine race would manifest at the
        ``asyncio.wait_for`` timeout layer; for the test that exercises
        a use event arriving *after* the signal, the test fixture
        emits the use event first via the simulated SSE iterator
        precisely so the buffer is populated before
        ``await self._await_pending_calls`` runs.

        TODO (Phase 2): if Anthropic ever genuinely sends the
        ``requires_action`` envelope before the matching
        ``agent.*_tool_use`` events (no live trace shows this), this
        method becomes the place to buffer-and-wait. For Phase 1 the
        in-buffer resolve is sufficient given the SSE-ordering
        invariant the server documents.
        """
        # The cycle's ``calls()`` raises MissingPendingToolCallError
        # if any id isn't in events_by_id; that's what the caller
        # catches.
        del stream  # Phase 1 doesn't buffer-and-wait at this layer.
        return cycle.calls(events_by_id)

    async def _send_interrupt_soft(self, session_id: str) -> None:
        """POST ``user.interrupt`` to terminate the session cleanly.

        Failures are swallowed: we've already decided to abandon the
        run, and a failed interrupt cannot make things worse.
        """
        try:
            await self._client.beta.sessions.events.send(
                session_id,
                events=[{"type": "user.interrupt"}],
            )
        except Exception:
            logger.exception(
                "ManagedAgentBackendV2: user.interrupt send failed",
                extra={"session_id": session_id},
            )

    async def _provision_anthropic_agent(
        self,
        *,
        agent: "BaseAgent",
        effective_tools: AgentToolRegistry,
        use_gateway_mcp: bool,
        fingerprint: str,
        for_version: int,
    ) -> ProviderBinding:
        """Create a fresh Anthropic agent + environment and return the
        binding.

        This closure is passed into
        :meth:`ProviderBindingRegistry.get_or_provision` and invoked
        exactly once across racing callers. The closure performs the
        two paid calls (``agents.create`` + ``environments.create``)
        in sequence and binds them into the :class:`ProviderBinding`
        the registry persists.
        """
        # Lazy import inside the method body so adopters who don't
        # install the helper at runtime don't crash at module load.
        from copass_anthropic_agents.backends.mysql_provider_binding_registry import (
            _now_iso_utc,
        )

        tools_payload = self._specs_to_tools(
            effective_tools.list_specs(),
            use_gateway_mcp=use_gateway_mcp,
        )

        create_kwargs: dict[str, Any] = dict(
            name=f"agent-{agent.identity}",
            model=agent.model,
            system=agent.system_prompt,
            tools=tools_payload,
        )
        if use_gateway_mcp:
            create_kwargs["mcp_servers"] = [
                {
                    "name": self._gateway_mcp_name,
                    "type": "url",
                    "url": self._gateway_mcp_url,
                },
            ]

        managed = await self._client.beta.agents.create(**create_kwargs)
        logger.info(
            "ManagedAgentBackendV2: created managed agent",
            extra={
                "anthropic_agent_id": managed.id,
                "identity": agent.identity,
                "model": agent.model,
                "tool_count": len(tools_payload),
                "use_gateway_mcp": use_gateway_mcp,
                "fingerprint": fingerprint,
            },
        )

        env = await self._client.beta.environments.create(
            name=self._environment_name,
            config=self._environment_config,
        )
        logger.info(
            "ManagedAgentBackendV2: created managed environment",
            extra={
                "environment_id": env.id,
                "environment_name": self._environment_name,
            },
        )

        return ProviderBinding(
            agent_id=managed.id,
            environment_id=env.id,
            for_version=for_version,
            provisioned_at=_now_iso_utc(),
        )

    async def _create_session(
        self,
        *,
        agent_id: str,
        environment_id: str,
        title: str,
        vault_ids: Optional[list[str]] = None,
    ) -> str:
        """Create a fresh managed-agents session.

        Mirrors v1's ``_create_session`` exactly so adopters can swap
        backends without their session-create wiring breaking.
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
            "ManagedAgentBackendV2: created session",
            extra={
                "session_id": session.id,
                "agent_id": agent_id,
                "vault_id_count": len(vault_ids) if vault_ids else 0,
            },
        )
        return session.id

    def _build_pending_tool_call(
        self,
        sdk_event: Any,
        evt_type: str,
        evt_id: str,
        name: str,
    ) -> PendingToolCall:
        """Parse an SDK SSE event into the right :data:`PendingToolCall`
        variant.

        Branchless dispatch on the three known envelopes. Any unknown
        envelope was already filtered out by the caller's membership
        test before this method runs.
        """
        if evt_type == ENVELOPE_CUSTOM_TOOL_USE:
            raw_input = getattr(sdk_event, "input", None) or {}
            arguments = dict(raw_input) if isinstance(raw_input, dict) else {}
            return CustomToolCall(
                event_id=evt_id, name=name, arguments=arguments,
            )
        if evt_type == ENVELOPE_SERVER_TOOL_USE:
            return ServerToolCall(event_id=evt_id, name=name)
        if evt_type == ENVELOPE_MCP_TOOL_USE:
            return McpToolCall(event_id=evt_id, name=name)
        # Should never reach here — caller guards the membership test.
        raise TypeError(
            f"ManagedAgentBackendV2: unknown tool-use envelope {evt_type!r}"
        )

    def _fingerprint_agent(
        self,
        agent: "BaseAgent",
        effective_tools: AgentToolRegistry,
        *,
        use_gateway_mcp: Optional[bool] = None,
    ) -> str:
        """Compute the fingerprint for ``(agent, tools, gateway_flags)``.

        Algorithm is verbatim from v1 (``managed_agent_backend.py:1054-1076``).
        v2 keeps the algorithm because:

        - The fingerprint now keys :class:`ProviderBindingRegistry`
          lookups in addition to driving Anthropic-agent provisioning.
        - Stability of ``effective_tools.list_specs()`` ordering is
          load-bearing (Risk 4). v1's helper sorts; v2 inherits the
          sort. Do not regress this — if you re-order the loop you
          will see fingerprint thrash across two equivalent registries.
        """
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
        # ``list_specs()`` sorts by name (see
        # ``AgentToolRegistry.list_specs``); do not re-sort here.
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
        """Construct the ``agents.create`` ``tools=[]`` payload.

        Verbatim from v1 — shape is unchanged in v2. See v1's
        :meth:`_specs_to_tools` (``managed_agent_backend.py:1078-1123``)
        for the ADR 0029 context.
        """
        gateway_on = (
            self._use_gateway_mcp if use_gateway_mcp is None else bool(use_gateway_mcp)
        )
        tools: list[dict] = []
        if self._include_builtin_toolset:
            tools.append({"type": "agent_toolset_20260401"})
        if gateway_on:
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
        """Normalize caller-supplied messages into ``user.message`` envelopes.

        Verbatim from v1 (Risk 5 — non-user roles drop with a warning
        because the managed-agents API cannot accept them as
        ``user.message``).
        """
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
                    "ManagedAgentBackendV2: skipping non-user message",
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


def _decode_custom_result(reply: dict) -> dict:
    """Reverse the JSON-encoded result text in a
    ``user.custom_tool_result`` reply.

    Used to surface a structured :class:`AgentToolResult` upstream so
    callers see the tool result on the event stream. Best-effort:
    on parse failure returns an empty dict.
    """
    try:
        content = reply.get("content") or []
        if not content:
            return {}
        text = content[0].get("text") if isinstance(content[0], dict) else None
        if not text:
            return {}
        payload = json.loads(text)
        result = payload.get("result")
        if isinstance(result, dict):
            return result
        return {}
    except Exception:
        return {}


def _decode_custom_error(reply: dict) -> Optional[str]:
    """Extract the error field from a ``user.custom_tool_result`` reply, if any."""
    try:
        content = reply.get("content") or []
        if not content:
            return None
        text = content[0].get("text") if isinstance(content[0], dict) else None
        if not text:
            return None
        payload = json.loads(text)
        err = payload.get("error")
        return str(err) if err else None
    except Exception:
        return None


__all__ = [
    "ManagedAgentBackendV2",
    "DEFAULT_ENVIRONMENT_CONFIG",
    "DEFAULT_GATEWAY_MCP_NAME",
    "DEFAULT_GATEWAY_MCP_URL",
    "SESSION_ID_HANDLE",
    "USE_GATEWAY_MCP_HANDLE",
    "VAULT_IDS_HANDLE",
    "_IDLE_EVENT_TYPES",
    "_TERMINATED_EVENT_TYPES",
    "_KNOWN_NOOP_EVENT_TYPES",
    "PROVIDER_ANTHROPIC_MANAGED",
    "STOP_REASON_END_TURN",
    "STOP_REASON_ERROR",
    "STOP_REASON_TERMINATED",
    "STOP_REASON_REQUIRES_ACTION_MISSING_EVENT_ID",
    "STOP_REASON_POLICY_MAX_CYCLES_EXHAUSTED",
    "STOP_REASON_POLICY_TOTAL_TIMEOUT",
    "STOP_REASON_BAD_REQUEST",
    "STOP_REASON_OUT_OF_CYCLE_REPLY",
]
