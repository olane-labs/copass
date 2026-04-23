"""GoogleAgentBackend — Vertex AI Agent Engine backend for ``BaseAgent``.

Implements :class:`AgentBackend` on top of Google Vertex AI Agent
Engine (see https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/overview).
The ADK agent runs in Google-managed cloud infrastructure; this module
is the seam that translates between the provider-neutral agent surface
(``AgentToolRegistry``, ``AgentEvent``) and the Agent Engine event
stream produced by ``async_stream_query``.

Key architectural difference from Anthropic Managed Agents:

    ADK Agent Engine **bakes tools into the deployed reasoning-engine
    resource at deploy time**. They cannot be injected per-run the way
    Claude Managed Agents accepts tools in each session. To preserve
    the runtime ``AgentToolResolver`` plug model, deployed agents
    carry a single ``copass_dispatch(tool_name, arguments)`` function
    tool which proxies back into our service; the service hosts the
    real ``AgentToolResolver`` and invokes the right tool per-user.
    See :mod:`copass_google_agents.deploy` for the deploy-time helper.

Turn lifecycle:

1. Lazy-resolve the ADK app handle once per backend instance:
   ``vertexai.Client(project, location).agent_engines.get(name=...)``.
2. Map :class:`AgentScope` to an Agent Engine ``user_id`` via the
   ``p_``/``s_``/``u_`` prefix scheme (most-specific wins).
3. Resolve (or create) a session tied to ``user_id``, unless the
   caller supplies an existing session id via
   ``context.handles[SESSION_ID_HANDLE]``.
4. Stream events with ``adk_app.async_stream_query(user_id, session_id, message)``
   and map each ADK event into :class:`AgentEvent` via
   :func:`copass_google_agents.events.adk_event_to_agent_events`.
5. Yield :class:`AgentFinish` on stream exhaustion; optionally delete
   the session if ``delete_session_on_finish`` and we created it.

Tool calls issued by the agent are resolved server-side (by the
deployed ``copass_dispatch`` proxy calling back into our API); this
backend does not dispatch tools locally. :class:`AgentToolCall` /
:class:`AgentToolResult` events are surfaced for observability.

Only this file imports the Google Cloud SDK. Base classes remain
vendor-neutral.
"""

from __future__ import annotations

import logging
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
from copass_core_agents.scope import AgentScope
from copass_google_agents.events import (
    adk_event_to_agent_events,
    extract_usage_metadata,
)

if TYPE_CHECKING:
    from google.auth.credentials import Credentials

    from copass_core_agents.base_agent import BaseAgent


logger = logging.getLogger(__name__)


DEFAULT_LOCATION = "us-central1"
"""Default Vertex AI region for Agent Engine. Override via
``GoogleAgentBackend(location=...)`` when the deployed reasoning
engine lives in another region."""


DISPATCH_TOOL_NAME = "copass_dispatch"
"""Name of the single function tool that deployed ADK agents carry.
The tool proxies tool invocations back into our service so the
runtime ``AgentToolResolver`` model keeps working on top of ADK's
deploy-time tool binding. See :mod:`copass_google_agents.deploy`."""


SESSION_ID_HANDLE = "agent_engine_session_id"
"""Key under which callers may stash an Agent Engine session id in
``AgentInvocationContext.handles``. When present, ``run``/``stream``
reuse that session instead of creating a new one — this is how
multi-turn conversations continue, because the session already holds
the prior turns on the Google side."""


def scope_to_user_id(scope: AgentScope) -> str:
    """Map an :class:`AgentScope` to the Agent Engine ``user_id``
    string using a prefix scheme that preserves tenancy boundaries.

    Most-specific scope wins:

    - ``project_id`` set → ``"p_<project_id>"``
    - ``sandbox_id`` set (no project) → ``"s_<sandbox_id>"``
    - only ``user_id`` → ``"u_<user_id>"``

    This mirrors the scheme used by the Pipedream tool resolver in
    the server-side repo (see
    ``frame_graph/agents/tools/resolvers/pipedream_tool_resolver.py``
    around lines 69-161). Kept local to this package for now; may
    be promoted to :mod:`copass_core_agents` once a second provider
    also needs it.
    """
    if scope.project_id:
        return f"p_{scope.project_id}"
    if scope.sandbox_id:
        return f"s_{scope.sandbox_id}"
    return f"u_{scope.user_id}"


class GoogleAgentBackend(AgentBackend):
    """:class:`AgentBackend` implementation backed by Vertex AI Agent Engine.

    Agent Engine agents are **pre-deployed resources**; this backend
    references one by ``reasoning_engine_id`` and drives sessions
    against it. Deploying the ADK agent itself is a one-time ops step
    (see :func:`copass_google_agents.deploy.deploy_adk_agent`).

    Sessions are created per invocation by default; pass an existing
    session id via ``context.handles[SESSION_ID_HANDLE]`` to continue
    a prior conversation.

    Args:
        project: GCP project id that owns the reasoning engine.
        location: GCP region (e.g. ``us-central1``). Defaults to
            :data:`DEFAULT_LOCATION`.
        reasoning_engine_id: The short id of the deployed ADK agent
            resource. The full resource name is assembled as
            ``projects/{project}/locations/{location}/reasoningEngines/{reasoning_engine_id}``.
        credentials: Optional pre-resolved ``google.auth.credentials.Credentials``.
            When omitted, Application Default Credentials (ADC) are
            used — i.e. ``GOOGLE_APPLICATION_CREDENTIALS`` / metadata
            server / ``gcloud auth application-default login``.
        delete_session_on_finish: When True, delete the Agent Engine
            session after the turn completes. Default False: sessions
            persist so callers can inspect state or resume. Only
            applies to sessions this backend created; supplied session
            ids are never deleted automatically.
        vertex_client: Pre-built ``vertexai.Client`` (injectable for
            tests). If omitted, one is constructed lazily on first use
            from the other arguments.
        adk_app: Pre-resolved ``agent_engines.AgentEngine`` handle
            (injectable for tests). If supplied, takes precedence over
            ``vertex_client``. If omitted, resolved lazily on first
            use by calling ``client.agent_engines.get(name=resource_name)``.
        config: Backend-level knobs (inherited from
            :class:`AgentBackend`).

    Example:
        >>> from copass_google_agents import (
        ...     AgentInvocationContext, AgentScope, GoogleAgentBackend,
        ... )
        >>> backend = GoogleAgentBackend(
        ...     project="my-gcp-project",
        ...     location="us-central1",
        ...     reasoning_engine_id="1234567890",
        ... )
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
        project: str,
        reasoning_engine_id: str,
        location: str = DEFAULT_LOCATION,
        credentials: "Optional[Credentials]" = None,
        delete_session_on_finish: bool = False,
        vertex_client: Any = None,
        adk_app: Any = None,
        config: Optional[dict] = None,
    ) -> None:
        super().__init__(config=config)
        if not project:
            raise ValueError("GoogleAgentBackend: `project` is required")
        if not reasoning_engine_id:
            raise ValueError(
                "GoogleAgentBackend: `reasoning_engine_id` is required — "
                "Agent Engine agents are pre-deployed resources"
            )
        if not location:
            raise ValueError("GoogleAgentBackend: `location` is required")
        self._project = project
        self._location = location
        self._reasoning_engine_id = reasoning_engine_id
        self._credentials = credentials
        self._delete_session_on_finish = delete_session_on_finish
        self._vertex_client: Any = vertex_client
        self._adk_app: Any = adk_app

    @property
    def resource_name(self) -> str:
        """Full reasoning-engine resource name."""
        return (
            f"projects/{self._project}"
            f"/locations/{self._location}"
            f"/reasoningEngines/{self._reasoning_engine_id}"
        )

    def _ensure_vertex_client(self) -> Any:
        if self._vertex_client is not None:
            return self._vertex_client
        import vertexai

        kwargs: dict = {
            "project": self._project,
            "location": self._location,
        }
        if self._credentials is not None:
            kwargs["credentials"] = self._credentials
        self._vertex_client = vertexai.Client(**kwargs)
        return self._vertex_client

    def _ensure_adk_app(self) -> Any:
        if self._adk_app is not None:
            return self._adk_app
        client = self._ensure_vertex_client()
        self._adk_app = client.agent_engines.get(name=self.resource_name)
        return self._adk_app

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
        message = self._normalize_messages(messages)
        if not message:
            raise ValueError(
                "GoogleAgentBackend: messages must contain at least one "
                "user-role message with non-empty content"
            )

        adk_app = self._ensure_adk_app()
        user_id = scope_to_user_id(context.scope)

        supplied_session_id = (
            context.handles.get(SESSION_ID_HANDLE) if context and context.handles else None
        )
        created_session_id: Optional[str] = None
        if supplied_session_id:
            session_id = str(supplied_session_id)
        else:
            session_payload = await adk_app.async_create_session(user_id=user_id)
            session_id = _extract_session_id(session_payload)
            created_session_id = session_id
            logger.info(
                "GoogleAgentBackend: created session",
                extra={
                    "session_id": session_id,
                    "user_id": user_id,
                    "agent_identity": agent.identity,
                },
            )

        usage_accumulator: dict = {}
        try:
            async for adk_event in adk_app.async_stream_query(
                user_id=user_id,
                session_id=session_id,
                message=message,
            ):
                event_usage = extract_usage_metadata(adk_event)
                for key, value in event_usage.items():
                    if isinstance(value, int):
                        usage_accumulator[key] = usage_accumulator.get(key, 0) + value
                for neutral in adk_event_to_agent_events(adk_event):
                    yield neutral
            yield AgentFinish(
                stop_reason="end_turn",
                usage=dict(usage_accumulator),
                session_id=session_id,
            )
        finally:
            # Cleanup runs on success, caller break, or exception.
            # Do NOT yield here — async-generator finally is fragile
            # under GeneratorExit. If the stream raised, callers see
            # the exception; they can wrap with try/except themselves
            # if they want a synthetic AgentFinish.
            if created_session_id and self._delete_session_on_finish:
                try:
                    await adk_app.async_delete_session(
                        user_id=user_id,
                        session_id=created_session_id,
                    )
                except Exception as cleanup_err:
                    logger.warning(
                        "GoogleAgentBackend: session cleanup failed",
                        extra={
                            "session_id": created_session_id,
                            "error": str(cleanup_err),
                        },
                    )

    def _normalize_messages(self, messages: Union[str, List[dict]]) -> str:
        """Collapse the neutral messages input into the single
        ``message`` string Agent Engine's ``async_stream_query``
        accepts.

        Agent Engine doesn't take a list of messages per turn — prior
        turns already live in the session. Non-user roles are dropped
        with a warning; multiple user messages are joined with a
        blank line.
        """
        if isinstance(messages, str):
            return messages.strip()
        parts: list[str] = []
        for msg in messages or []:
            role = msg.get("role", "user") if isinstance(msg, dict) else "user"
            if role != "user":
                logger.warning(
                    "GoogleAgentBackend: skipping non-user message",
                    extra={"role": role},
                )
                continue
            content = msg.get("content", "") if isinstance(msg, dict) else ""
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        parts.append(str(block.get("text", "")))
                    else:
                        parts.append(str(block))
            else:
                parts.append(str(content))
        return "\n\n".join(p for p in parts if p)


def _extract_session_id(payload: Any) -> str:
    """Pull the session id out of whatever ``async_create_session``
    returned. The SDK surfaces it as ``.id`` on a Pydantic model or
    ``["id"]`` on a dict (response shape has varied across
    google-cloud-aiplatform minor versions)."""
    if payload is None:
        raise RuntimeError(
            "GoogleAgentBackend: async_create_session returned None"
        )
    for attr in ("id", "name", "session_id"):
        if isinstance(payload, dict):
            if payload.get(attr):
                return str(payload[attr])
        else:
            val = getattr(payload, attr, None)
            if val:
                return str(val)
    raise RuntimeError(
        f"GoogleAgentBackend: could not extract session id from "
        f"{type(payload).__name__}"
    )


__all__ = [
    "GoogleAgentBackend",
    "DEFAULT_LOCATION",
    "DISPATCH_TOOL_NAME",
    "SESSION_ID_HANDLE",
    "scope_to_user_id",
]
