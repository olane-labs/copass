"""CopassGoogleAgent — Copass-aware Vertex AI Agent Engine subclass.

Bundles a :class:`GoogleAgentBackend` with two Copass-specific
behaviors toggled on when you pass a :class:`CopassClient` + sandbox
(+ optional window):

1. **Discover-as-step-1.** On the first turn of a new session, the
   agent calls ``client.retrieval.discover`` with the incoming user
   message as the query and prepends a structured context block to
   the user's first turn. Gemini sees relevant sandbox signal without
   having to decide to call ``discover`` itself through the
   server-side ``copass_dispatch`` proxy. Continuation sessions
   (where ``context.handles[SESSION_ID_HANDLE]`` is populated) skip
   injection — the ADK session already holds the prior turns.

2. **Automatic turn capture.** When ``window`` is passed, a
   :class:`CopassTurnRecorder` mirrors user + assistant turns into
   the Context Window so retrieval across future calls is
   window-aware.

Google-specific shape note:

    ADK's ``async_stream_query`` takes a single string message, not
    a list. So the prepended synthetic user message gets concatenated
    into the real user message by
    :meth:`GoogleAgentBackend._normalize_messages` (join with
    ``"\\n\\n"``). Gemini sees a single user turn that begins with
    the ``<copass_context>`` block and ends with the user's real
    question. This is the structural equivalent of the separate
    ``user.message`` events Anthropic Managed Agents receives.

    Tools are still dispatched server-side via the
    ``copass_dispatch`` proxy baked into the deployed reasoning
    engine — :class:`CopassGoogleAgent` does NOT send tool specs
    per-turn. The discover / interpret / search / ingest tools from
    :mod:`copass_google_agents.retrieval_tools` and
    :mod:`copass_google_agents.ingest_tool` are reachable through
    that proxy when the server-side :class:`AgentToolResolver`
    registers them.

Disable either feature with ``prefetch_discover=False`` /
``auto_record=False``. When neither :attr:`copass_client` nor
:attr:`window` is set, this class behaves identically to a plain
``BaseAgent`` over :class:`GoogleAgentBackend`.

Example::

    copass = CopassClient(auth=ApiKeyAuth(key=os.environ["COPASS_API_KEY"]))
    window = await copass.context_window.create(sandbox_id=sandbox_id)

    agent = CopassGoogleAgent(
        identity="support",
        system_prompt="You are a support agent.",
        project="my-gcp-project",
        reasoning_engine_id="1234567890",
        copass_client=copass,
        sandbox_id=sandbox_id,
        window=window,
    )
    result = await agent.run(
        messages=[{"role": "user", "content": "why is checkout flaky?"}],
        context=AgentInvocationContext(scope=AgentScope(user_id="u-1")),
    )
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, AsyncIterator, List, Optional, Union

from copass_core_agents.backends.base_backend import AgentRunResult
from copass_core_agents.base_agent import BaseAgent
from copass_core_agents.events import (
    AgentEvent,
    AgentFinish,
    AgentTextDelta,
    AgentToolCall,
    AgentToolResult,
)
from copass_core_agents.invocation_context import AgentInvocationContext
from copass_core_agents.tool_registry import AgentToolRegistry
from copass_core_agents.tool_resolver import ToolConflictPolicy
from copass_context_agents import CopassTurnRecorder
from copass_google_agents.backends.google_agent_backend import (
    DEFAULT_LOCATION,
    SESSION_ID_HANDLE,
    GoogleAgentBackend,
)

if TYPE_CHECKING:
    from google.auth.credentials import Credentials

    from copass_core import CopassClient
    from copass_core.context_window import ContextWindow
    from copass_core_agents.tool_resolver import AgentToolResolver


logger = logging.getLogger(__name__)


DEFAULT_MODEL = "gemini-3.1-pro-preview"
"""Default model name — currently the latest Gemini 3.1 Pro preview.

**Preview contract caveat:** Google's preview model IDs can be
deprecated with limited notice (e.g. ``gemini-3-pro-preview`` was
shut down 2026-03-09 in favor of this one). Bump the default when
3.x graduates to GA and the ``-preview`` suffix is dropped.

**Decorative at the runtime layer** — Agent Engine agents are
pre-deployed and the real model is baked into the deployed
``reasoningEngine`` resource. ``DEFAULT_MODEL`` is only consumed by
:func:`copass_google_agents.deploy.deploy_adk_agent` at deploy time.
Override via ``CopassGoogleAgent(model=...)`` when you deploy a
non-default model; the string is passed through to
:class:`BaseAgent.model` for parity with other provider SDKs."""


# Top-K discover items to inject on first turn. Higher values burn
# input tokens without materially increasing signal after the top
# few; users who want to tune this should subclass and override
# ``_format_context_block`` rather than expose another knob.
_PREFETCH_TOP_K = 5


class CopassGoogleAgent(BaseAgent):
    """Vertex AI Agent Engine subclass of :class:`BaseAgent` with
    Copass context-engineering baked in.

    Args:
        identity: Stable identifier (logs, session titles). Required.
        system_prompt: System prompt. Required. Used at deploy time
            when the ADK agent is first created; not re-applied
            per-turn. Stable — no interpolation happens against it.
            Leave placeholders like ``{{copass_context}}`` OUT; the
            Copass layer injects context via a message-level prefix,
            not by mutating the system prompt.
        project: GCP project id of the deployed reasoning engine.
            Required.
        reasoning_engine_id: Short id of the deployed ADK agent
            resource. Required.
        location: GCP region. Defaults to ``us-central1``.
        model: Gemini model id. See :data:`DEFAULT_MODEL` —
            decorative at runtime; the deployed agent's baked-in
            model wins.
        credentials: Optional pre-resolved
            ``google.auth.credentials.Credentials``. When omitted,
            Application Default Credentials (ADC) are used.
        tools: Static :class:`AgentToolRegistry` for client-side
            tools. Defaults to an empty registry since Google agents
            run tools server-side via the ``copass_dispatch`` proxy.
        tool_resolver: Dynamic resolver for per-invocation
            scope-bound tools. Rarely needed for Google agents.
        on_conflict: Conflict policy for static + dynamic tool
            collisions. See :class:`BaseAgent`.
        copass_client: An authenticated :class:`CopassClient`.
            Required to enable ``prefetch_discover``.
        sandbox_id: Sandbox to retrieve / record against. Required
            to enable ``prefetch_discover`` or ``auto_record``.
        window: Optional :class:`ContextWindow`. Required to enable
            ``auto_record``; passed through to ``prefetch_discover``
            so the injected context respects conversation history
            when ``window`` has seeded turns.
        prefetch_discover: Inject a discover context block on the
            first user turn of each new session. Default True;
            silently no-ops when ``copass_client`` or ``sandbox_id``
            is missing.
        auto_record: Mirror user + assistant turns into ``window``.
            Default True; silently no-ops when ``window`` is missing.
        author: Optional provenance identifier (e.g.
            ``"agent:support-bot"``) attached to assistant turns and
            ingested content. Enables
            :class:`CopassTurnRecorder.include_author_prefix` under
            the hood.
        project_id: Optional project scoping passed to
            ``client.retrieval.discover`` during prefetch. Unified
            with ``window.project_id`` at construction — the two must
            agree (or one must be unset) so discover scoping and
            window ingest scoping target the same project.
    """

    def __init__(
        self,
        *,
        identity: str,
        system_prompt: str,
        project: str,
        reasoning_engine_id: str,
        location: str = DEFAULT_LOCATION,
        model: str = DEFAULT_MODEL,
        credentials: "Optional[Credentials]" = None,
        tools: Optional[AgentToolRegistry] = None,
        tool_resolver: "Optional[AgentToolResolver]" = None,
        on_conflict: ToolConflictPolicy = "dynamic_wins",
        copass_client: "Optional[CopassClient]" = None,
        sandbox_id: Optional[str] = None,
        window: "Optional[ContextWindow]" = None,
        prefetch_discover: bool = True,
        auto_record: bool = True,
        author: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> None:
        backend = GoogleAgentBackend(
            project=project,
            location=location,
            reasoning_engine_id=reasoning_engine_id,
            credentials=credentials,
        )
        # Default to an empty registry so BaseAgent's "must have tools
        # or tool_resolver" guard is satisfied. Tools are dispatched
        # server-side via copass_dispatch; client-side registries on
        # Google agents are decorative.
        if tools is None and tool_resolver is None:
            tools = AgentToolRegistry()
        super().__init__(
            identity=identity,
            model=model,
            system_prompt=system_prompt,
            backend=backend,
            tools=tools,
            tool_resolver=tool_resolver,
            on_conflict=on_conflict,
        )
        self._copass_client = copass_client
        self._sandbox_id = sandbox_id
        self._window = window
        self._author = author
        # Unify project scoping between discover (agent-level) and
        # ingest (window-level). They MUST agree — otherwise a user
        # who thinks "I passed project_id" gets reads scoped to P and
        # writes scoped elsewhere, with no warning. Rules:
        #   - both None                         → None
        #   - only window set                   → adopt window's
        #   - only agent set + window exists    → backfill window.project_id
        #   - both set and equal                → fine
        #   - both set and different            → raise
        if (
            window is not None
            and window.project_id
            and project_id
            and window.project_id != project_id
        ):
            raise ValueError(
                "CopassGoogleAgent: project_id="
                f"{project_id!r} conflicts with window.project_id="
                f"{window.project_id!r}. The agent's discover scope and "
                "the window's ingest scope must target the same project. "
                "Pass matching values, or drop one and let the other "
                "drive."
            )
        if window is not None and window.project_id and not project_id:
            resolved_project_id: Optional[str] = window.project_id
        elif window is not None and project_id and not window.project_id:
            # project_id is a public BaseDataSource attribute — safe
            # to backfill so subsequent ``window.push()`` calls
            # attribute ingestion to the same project discover reads
            # from.
            window.project_id = project_id
            resolved_project_id = project_id
        else:
            resolved_project_id = project_id
        self._project_id = resolved_project_id

        # Gate each feature on having the inputs it needs. The flag
        # defaults are True so a fully-wired construction "just
        # works" — but they silently no-op when the deps aren't
        # passed so a plain agent (no Copass wiring) is a valid
        # construction too.
        #
        # Warnings fire only for PARTIAL wiring — some Copass args
        # present, others missing. That's the "user meant to turn
        # this on but forgot something" case, which deserves a
        # heads-up. Zero-intent constructions stay silent.
        has_copass_intent = (
            copass_client is not None or bool(sandbox_id) or window is not None
        )

        self._prefetch_discover = bool(
            prefetch_discover and copass_client is not None and sandbox_id
        )
        if (
            prefetch_discover
            and not self._prefetch_discover
            and has_copass_intent
        ):
            missing: list[str] = []
            if copass_client is None:
                missing.append("copass_client")
            if not sandbox_id:
                missing.append("sandbox_id")
            logger.warning(
                "CopassGoogleAgent: prefetch_discover is enabled but "
                "%s missing — the first-turn discover injection will NOT "
                "happen. Pass them to turn it on, or set "
                "prefetch_discover=False to silence this warning.",
                " and ".join(missing),
                extra={"identity": identity},
            )

        self._auto_record = bool(auto_record and window is not None)
        if auto_record and not self._auto_record and has_copass_intent:
            logger.warning(
                "CopassGoogleAgent: auto_record is enabled but window is "
                "missing — turns will NOT be mirrored into a Context "
                "Window. Pass window= to turn it on, or set "
                "auto_record=False to silence this warning.",
                extra={"identity": identity},
            )

        self._turn_recorder: Optional[CopassTurnRecorder] = None
        if self._auto_record and window is not None:
            # ADR 0022 — author flows as the envelope's `speaker`
            # field via ChatMessage.name. The recorder defaults
            # `participants` to ["User", author or "Assistant"] so
            # downstream extraction can resolve second-person
            # pronouns. include_author_prefix stays False (default)
            # to avoid body-prefix double-attribution.
            self._turn_recorder = CopassTurnRecorder(
                window=window,
                author=author,
            )

    # ── Public entry points ──────────────────────────────────────

    async def run(
        self,
        messages: Union[str, List[dict]],
        *,
        context: AgentInvocationContext,
    ) -> AgentRunResult:
        """Drive the turn to completion via :meth:`stream` and
        return the reduced result. Overrides :meth:`BaseAgent.run`
        so every ``run`` call benefits from discover prefetch + turn
        recording, not just ``stream``."""
        final_text_parts: list[str] = []
        tool_calls_log: list[dict] = []
        stop_reason = "end_turn"
        usage: dict = {}
        session_id: Optional[str] = None

        async for evt in self.stream(messages, context=context):
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
        messages: Union[str, List[dict]],
        *,
        context: AgentInvocationContext,
    ) -> AsyncIterator[AgentEvent]:
        """Drive a turn and yield :class:`AgentEvent` as they occur.

        Augments the user message with a discover context block on
        the first turn of a new session (when configured), then
        wraps the backend event stream with the turn recorder (when
        configured). Both steps degrade gracefully when inputs are
        missing — the agent still runs, just without that layer."""
        prepared_messages, user_contents = await self._prepare_messages(
            messages, context
        )

        if self._turn_recorder is not None:
            # Record EVERY user message, not just the last. Callers
            # occasionally pass multiple user turns in one call (e.g.
            # pre-seeded context + the actual question) — dropping
            # the earlier ones would silently desync the window from
            # the ADK session, which DOES receive them all (collapsed
            # to one string by the backend). ``_record`` dedupes, so
            # replaying an already-seen message is a no-op.
            for user_text in user_contents:
                await self._turn_recorder.record_user(user_text)

        backend_stream = self.backend.stream(self, prepared_messages, context)

        if self._turn_recorder is not None:
            async for evt in self._turn_recorder.record_stream(backend_stream):
                yield evt
        else:
            async for evt in backend_stream:
                yield evt

    # ── Internals ────────────────────────────────────────────────

    async def _prepare_messages(
        self,
        messages: Union[str, List[dict]],
        context: AgentInvocationContext,
    ) -> tuple[list[dict], list[str]]:
        """Normalize ``messages`` to a list-of-dicts, optionally
        augment the first user message with a discover context
        block, and return ``(augmented_messages, user_contents)``.

        ``user_contents`` is every user-role message's text in order
        (pre-augmentation) — the turn recorder mirrors all of them
        into the window, not just the last. Discover prefetch still
        uses only the LAST user message as the query because that's
        where the current goal is typically framed.

        Google-specific: the backend collapses the returned list of
        dicts into a single string via ``\\n\\n``-join (see
        :meth:`GoogleAgentBackend._normalize_messages`). So a
        prepended synthetic user message becomes a prefix on the
        real user's text — Gemini sees one combined user turn
        starting with the ``<copass_context>`` block.
        """
        normalized = self._normalize_messages(messages)
        user_contents = self._user_contents(normalized)
        last_user_content = user_contents[-1] if user_contents else None

        if not self._should_prefetch(context, last_user_content):
            return normalized, user_contents

        context_block = await self._fetch_context_block(last_user_content or "")
        if context_block is None:
            return normalized, user_contents

        # Inject as a SECOND user message prepended to the list.
        # The Google backend joins user messages with "\n\n" so the
        # model sees one combined user turn: context block, blank
        # line, real question. The synthetic prefix is NOT added to
        # ``user_contents`` — the recorder ingests only real user
        # turns, not our context scaffolding.
        synthetic = {"role": "user", "content": context_block}
        return [synthetic, *normalized], user_contents

    def _should_prefetch(
        self,
        context: AgentInvocationContext,
        last_user_content: Optional[str],
    ) -> bool:
        if not self._prefetch_discover:
            return False
        if not last_user_content:
            return False
        # Continuation sessions already hold the prior-turn context
        # on the Google side — re-injecting would double-count and
        # waste tokens.
        handles = context.handles if context is not None else None
        if handles and handles.get(SESSION_ID_HANDLE):
            return False
        return True

    async def _fetch_context_block(self, query: str) -> Optional[str]:
        """Call ``client.retrieval.discover`` and format the top
        items as an LLM-facing context block. Returns ``None`` when
        discover yields nothing useful or when the call fails
        (fail-open: missing context is better than a failed turn)."""
        assert self._copass_client is not None  # gated in _should_prefetch
        assert self._sandbox_id is not None
        try:
            response = await self._copass_client.retrieval.discover(
                self._sandbox_id,
                query=query,
                project_id=self._project_id,
                window=self._window,
            )
        except Exception as err:
            logger.warning(
                "CopassGoogleAgent: discover prefetch failed "
                "(continuing without context)",
                extra={
                    "error": str(err),
                    "identity": self.identity,
                    "sandbox_id": self._sandbox_id,
                },
            )
            return None

        item_count = len(response.get("items") or [])
        logger.info(
            "CopassGoogleAgent: discover prefetch injected %d item(s) "
            "as first-turn context",
            min(item_count, _PREFETCH_TOP_K),
            extra={
                "identity": self.identity,
                "sandbox_id": self._sandbox_id,
                "project_id": self._project_id,
                "total_items_returned": item_count,
            },
        )
        return self._format_context_block(query, response)

    def _format_context_block(self, query: str, response: dict) -> Optional[str]:
        """Render a discover response into the LLM-facing prefix.

        Subclass and override to customize — this is the knob for
        callers who want more items, different formatting, or a
        different wrapper convention. Return ``None`` to suppress
        injection for a given response.
        """
        items = response.get("items") or []
        items = items[:_PREFETCH_TOP_K]
        if not items:
            return None

        lines: list[str] = [
            "<copass_context>",
            "Pre-fetched from the sandbox knowledge graph based on the user's question.",
            f"Query: {query}",
            "",
        ]
        for idx, item in enumerate(items, start=1):
            score = item.get("score")
            summary = (item.get("summary") or "").strip() or "(no summary)"
            canonical_ids = item.get("canonical_ids") or []
            score_str = (
                f"{score:.2f}"
                if isinstance(score, (int, float))
                else str(score or "-")
            )
            lines.append(f"{idx}. (score: {score_str}) {summary}")
            if canonical_ids:
                lines.append(f"   canonical_ids: {list(canonical_ids)!r}")
        lines.append("")
        next_steps = response.get("next_steps")
        if next_steps:
            lines.append(str(next_steps))
        else:
            lines.append(
                "Call `interpret` via `copass_dispatch` with any "
                "canonical_ids tuple above for a deeper brief, or "
                "`discover` again for more items."
            )
        lines.append("</copass_context>")
        return "\n".join(lines)

    @staticmethod
    def _normalize_messages(messages: Union[str, List[dict]]) -> list[dict]:
        """Coerce ``str`` / list-of-dicts into the list-of-dicts
        shape ``_prepare_messages`` works against. Does NOT touch
        the ADK ``async_stream_query`` shape — that translation
        happens inside :class:`GoogleAgentBackend` via
        ``_normalize_messages`` on the backend (which collapses
        this list to a single string)."""
        if isinstance(messages, str):
            return [{"role": "user", "content": messages}]
        return [dict(msg) for msg in (messages or [])]

    @staticmethod
    def _user_contents(messages: list[dict]) -> list[str]:
        """Return every user-role message's text, in order. Skips
        non-dict entries, non-user roles, and whitespace-only
        content. Mirrors the filtering that
        ``GoogleAgentBackend._normalize_messages`` applies before
        joining into the ADK ``message`` string, so the recorder
        sees exactly the set the backend forwards."""
        out: list[str] = []
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            if msg.get("role", "user") != "user":
                continue
            content = msg.get("content", "")
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                text = "\n".join(
                    _extract_text(part) for part in content if part is not None
                ).strip()
            else:
                text = str(content)
            if text.strip():
                out.append(text)
        return out


def _extract_text(part: Any) -> str:
    if isinstance(part, dict):
        if part.get("type") == "text":
            return str(part.get("text", ""))
        return ""
    if isinstance(part, str):
        return part
    return ""


__all__ = ["CopassGoogleAgent", "DEFAULT_MODEL"]
