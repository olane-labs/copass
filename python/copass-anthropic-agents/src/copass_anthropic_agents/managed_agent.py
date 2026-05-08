"""CopassManagedAgent — Copass-aware Anthropic Managed Agents subclass.

Bundles a :class:`ManagedAgentBackend` with two Copass-specific
behaviors toggled on when you pass a :class:`CopassClient` + sandbox
(+ optional window):

1. **Discover-as-step-1.** On the first turn of a new session, the
   agent calls ``client.retrieval.discover`` with the incoming user
   message as the query and prepends a structured context block to
   the user's first turn. Claude sees relevant sandbox signal without
   having to decide to call ``discover`` itself. Safe across
   continuation sessions: when
   ``context.handles[SESSION_ID_HANDLE]`` is populated we skip
   injection — Anthropic's session already holds the prior turns.

2. **Automatic turn capture.** When ``window`` is passed, a
   :class:`CopassTurnRecorder` mirrors user + assistant turns into
   the Context Window so retrieval across future calls is
   window-aware.

Both are cache-safe: they operate at the message layer (user events)
and the stream layer (post-response events), never touching
``system_prompt`` or the tool catalog — so
:class:`ManagedAgentBackend`'s managed-agent fingerprint cache keeps
hitting and Anthropic's 60-creates/min rate limit is never stressed.

Disable either with ``prefetch_discover=False`` / ``auto_record=False``.
When neither :attr:`copass_client` nor :attr:`window` is set, this
class behaves identically to a plain ``BaseAgent`` over
:class:`ManagedAgentBackend`.

Example::

    copass = CopassClient(auth=ApiKeyAuth(key=os.environ["COPASS_API_KEY"]))
    window = await copass.context_window.create(sandbox_id=sandbox_id)

    agent = CopassManagedAgent(
        identity="support",
        system_prompt="You are a support agent.",
        anthropic_api_key=os.environ["ANTHROPIC_API_KEY"],
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

from copass_anthropic_agents.backends.managed_agent_backend import (
    SESSION_ID_HANDLE,
    ManagedAgentBackend,
)
from copass_context_agents import CopassTurnRecorder
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

if TYPE_CHECKING:
    from anthropic import AsyncAnthropic

    from copass_core import CopassClient
    from copass_core.context_window import ContextWindow
    from copass_core_agents.tool_resolver import AgentToolResolver


logger = logging.getLogger(__name__)


DEFAULT_MODEL = "claude-sonnet-4-6"

# Top-K discover items to inject on first turn. Higher values burn
# input tokens without materially increasing signal after the top few;
# users who want to tune this should subclass and override
# ``_format_context_block`` rather than expose another knob.
_PREFETCH_TOP_K = 5


class CopassManagedAgent(BaseAgent):
    """Anthropic-Managed-Agents subclass of :class:`BaseAgent` with
    Copass context-engineering baked in.

    Args:
        identity: Stable identifier (logs, managed-agent resource
            naming). Required.
        system_prompt: System prompt. Required. Stable across turns —
            no interpolation happens against it. Leave placeholders
            like ``{{copass_context}}`` OUT; the Copass layer injects
            context via a message-level prefix, not by mutating the
            system prompt.
        model: Anthropic model id. Defaults to ``claude-sonnet-4-6``.
        anthropic_api_key: Passed through to the Anthropic SDK. If
            omitted, the SDK reads ``ANTHROPIC_API_KEY`` from env.
        anthropic_client: Pre-built ``AsyncAnthropic`` client. Takes
            precedence over ``anthropic_api_key``.
        tools: Static :class:`AgentToolRegistry`. May be omitted if
            ``tool_resolver`` is provided.
        tool_resolver: Dynamic resolver for per-invocation
            scope-bound tools.
        on_conflict: Conflict policy for static + dynamic tool
            collisions. See :class:`BaseAgent`.
        copass_client: An authenticated :class:`CopassClient`. Required
            to enable ``prefetch_discover``.
        sandbox_id: Sandbox to retrieve / record against. Required to
            enable ``prefetch_discover`` or ``auto_record``.
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
            ``client.retrieval.discover`` during prefetch.
    """

    def __init__(
        self,
        *,
        identity: str,
        system_prompt: str,
        model: str = DEFAULT_MODEL,
        anthropic_api_key: Optional[str] = None,
        anthropic_client: "Optional[AsyncAnthropic]" = None,
        backend: Optional[ManagedAgentBackend] = None,
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
        # Caller can either let us build the backend (default) or pass
        # one in — useful when they need backend-level config that
        # isn't surfaced as a constructor arg here (e.g.
        # ``include_builtin_toolset=True`` for hosted web_search). The
        # two paths are exclusive: passing both ``backend`` and an
        # api_key/client is almost always a config bug, so we reject
        # rather than silently letting one win.
        if backend is not None and (anthropic_api_key or anthropic_client):
            raise ValueError(
                "CopassManagedAgent: pass EITHER `backend` OR "
                "`anthropic_api_key` / `anthropic_client` — not both. "
                "When supplying your own backend, configure its client "
                "there."
            )
        if backend is None:
            backend = ManagedAgentBackend(
                client=anthropic_client,
                api_key=anthropic_api_key,
            )
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
        if window is not None and window.project_id and project_id and window.project_id != project_id:
            raise ValueError(
                "CopassManagedAgent: project_id="
                f"{project_id!r} conflicts with window.project_id="
                f"{window.project_id!r}. The agent's discover scope and the "
                "window's ingest scope must target the same project. Pass "
                "matching values, or drop one and let the other drive."
            )
        if window is not None and window.project_id and not project_id:
            resolved_project_id: Optional[str] = window.project_id
        elif window is not None and project_id and not window.project_id:
            # project_id is a public BaseDataSource attribute — safe to
            # backfill so subsequent ``window.push()`` calls attribute
            # ingestion to the same project discover reads from.
            window.project_id = project_id
            resolved_project_id = project_id
        else:
            resolved_project_id = project_id
        self._project_id = resolved_project_id

        # Gate each feature on having the inputs it needs. The flag
        # defaults are True so a fully-wired construction "just works"
        # — but they silently no-op when the deps aren't passed so a
        # plain managed agent (no Copass wiring at all) is a valid
        # construction too.
        #
        # Warnings fire only for PARTIAL wiring — some Copass args
        # present, others missing. That's the "user meant to turn this
        # on but forgot something" case, which deserves a heads-up.
        # Zero-intent constructions (no Copass args at all) stay
        # silent.
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
                "CopassManagedAgent: prefetch_discover is enabled but "
                "%s missing — the first-turn discover injection will NOT "
                "happen. Pass them to turn it on, or set "
                "prefetch_discover=False to silence this warning.",
                " and ".join(missing),
                extra={"identity": identity},
            )

        self._auto_record = bool(auto_record and window is not None)
        if auto_record and not self._auto_record and has_copass_intent:
            logger.warning(
                "CopassManagedAgent: auto_record is enabled but window is "
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
        """Drive the turn to completion via :meth:`stream` and return
        the reduced result. Overrides :meth:`BaseAgent.run` so every
        ``run`` call benefits from discover prefetch + turn recording,
        not just ``stream``."""
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
        the first turn of a new session (when configured), then wraps
        the backend event stream with the turn recorder (when
        configured). Both steps degrade gracefully when inputs are
        missing — the agent still runs, just without that layer."""
        prepared_messages, user_contents = await self._prepare_messages(
            messages, context
        )

        if self._turn_recorder is not None:
            # Record EVERY user message, not just the last. Callers
            # occasionally pass multiple user turns in one call (e.g.
            # pre-seeded context + the actual question) — dropping the
            # earlier ones would silently desync the window from the
            # Anthropic session, which DOES receive them all.
            # ``_record`` dedupes, so replaying an already-seen message
            # is a no-op.
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
        augment the first user message with a discover context block,
        and return ``(augmented_messages, user_contents)``.

        ``user_contents`` is every user-role message's text in order
        (pre-augmentation) — the turn recorder mirrors all of them
        into the window, not just the last. Discover prefetch still
        uses only the LAST user message as the query because that's
        where the current goal is typically framed.
        """
        normalized = self._normalize_messages(messages)
        user_contents = self._user_contents(normalized)
        last_user_content = user_contents[-1] if user_contents else None

        if not self._should_prefetch(context, last_user_content):
            return normalized, user_contents

        context_block = await self._fetch_context_block(last_user_content or "")
        if context_block is None:
            return normalized, user_contents

        # Inject as a SECOND user message prepended to the list, rather
        # than mutating the user's content. Rationale: preserves the
        # user's message verbatim for audit + turn recording, and
        # managed-agents sessions accept back-to-back user events
        # without ceremony. The synthetic prefix is NOT added to
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
        # Continuation sessions already hold the prior-turn context on
        # the Anthropic side — re-injecting would double-count and
        # waste tokens.
        handles = context.handles if context is not None else None
        if handles and handles.get(SESSION_ID_HANDLE):
            return False
        return True

    async def _fetch_context_block(self, query: str) -> Optional[str]:
        """Call ``client.retrieval.discover`` and format the top items
        as an LLM-facing context block. Returns ``None`` when discover
        yields nothing useful or when the call fails (fail-open:
        missing context is better than a failed turn)."""
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
                "CopassManagedAgent: discover prefetch failed "
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
            "CopassManagedAgent: discover prefetch injected %d item(s) "
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
                "Call `interpret` with any canonical_ids tuple above for a "
                "deeper brief, or `discover` again for more items."
            )
        lines.append("</copass_context>")
        return "\n".join(lines)

    @staticmethod
    def _normalize_messages(messages: Union[str, List[dict]]) -> list[dict]:
        """Coerce ``str`` / list-of-dicts into the list-of-dicts shape
        ``_prepare_messages`` works against. Does NOT touch the
        managed-agents ``user.message`` event shape — that translation
        happens inside :class:`ManagedAgentBackend` via
        ``_normalize_messages`` on the backend."""
        if isinstance(messages, str):
            return [{"role": "user", "content": messages}]
        return [dict(msg) for msg in (messages or [])]

    @staticmethod
    def _user_contents(messages: list[dict]) -> list[str]:
        """Return every user-role message's text, in order. Skips
        non-dict entries, non-user roles, and whitespace-only
        content. Mirrors the filtering that ``ManagedAgentBackend._
        normalize_messages`` applies before sending to Anthropic, so
        the recorder sees exactly the set the backend forwards."""
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


__all__ = ["CopassManagedAgent", "DEFAULT_MODEL"]
