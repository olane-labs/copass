"""CopassHermesAgent — Copass-aware Hermes-via-OpenRouter subclass.

Mirrors :class:`copass_anthropic_agents.CopassManagedAgent` shape:

  1. **Discover-as-step-1.** On the first turn, calls
     ``client.retrieval.discover`` and prepends a structured context
     block to the user's first message.
  2. **Auto-record.** When ``window`` is passed, mirrors user +
     assistant turns into the Context Window via
     :class:`CopassTurnRecorder` so future retrieval is window-aware.

Hermes' ``/v1/chat/completions`` is stateless (spike Finding #3) — full
history is sent on every turn — so there's no "reuse session" branch
like the Anthropic Managed Agents flow has.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, AsyncIterator, List, Optional, Union

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

from copass_hermes_agents.backends.hermes_agent_backend import (
    HermesAgentBackend,
)


if TYPE_CHECKING:
    from copass_core import CopassClient
    from copass_core.context_window import ContextWindow
    from copass_core_agents.tool_resolver import AgentToolResolver


logger = logging.getLogger(__name__)


DEFAULT_MODEL = "hermes/anthropic/claude-3.5-sonnet"

_PREFETCH_TOP_K = 5


class CopassHermesAgent(BaseAgent):
    """Hermes/OpenRouter subclass of :class:`BaseAgent` with Copass
    context-engineering baked in.

    Args:
        identity: Stable identifier (logs). Required.
        system_prompt: System prompt — stable across turns. Required.
        model: ``hermes/<openrouter-model-id>`` string. Defaults to
            ``hermes/anthropic/claude-3.5-sonnet``.
        backend: Pre-built :class:`HermesAgentBackend` bound to a
            sandbox endpoint URL + per-sandbox bearer. Required —
            unlike the Anthropic flow, the Hermes backend is per-
            (user, sandbox) so the agent can't construct one
            opportunistically.
        tools: Static :class:`AgentToolRegistry`.
        tool_resolver: Dynamic resolver for per-invocation tools.
        on_conflict: Conflict policy for static + dynamic tool
            collisions. See :class:`BaseAgent`.
        copass_client: An authenticated :class:`CopassClient`.
            Required to enable ``prefetch_discover``.
        sandbox_id: Sandbox id for retrieval / recording.
        window: Optional :class:`ContextWindow`. Required to enable
            ``auto_record``.
        prefetch_discover: Inject discover context block on the first
            turn. Default True; silently no-ops when deps are missing.
        auto_record: Mirror user + assistant turns into ``window``.
            Default True; silently no-ops when ``window`` is missing.
        author: Optional provenance string for ingested content.
        project_id: Optional project scoping.
    """

    def __init__(
        self,
        *,
        identity: str,
        system_prompt: str,
        backend: HermesAgentBackend,
        model: str = DEFAULT_MODEL,
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

        # Project scoping unification — same rules as CopassManagedAgent.
        if (
            window is not None
            and window.project_id
            and project_id
            and window.project_id != project_id
        ):
            raise ValueError(
                "CopassHermesAgent: project_id="
                f"{project_id!r} conflicts with window.project_id="
                f"{window.project_id!r}. Pass matching values, or drop one."
            )
        if window is not None and window.project_id and not project_id:
            resolved_project_id: Optional[str] = window.project_id
        elif window is not None and project_id and not window.project_id:
            window.project_id = project_id
            resolved_project_id = project_id
        else:
            resolved_project_id = project_id
        self._project_id = resolved_project_id

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
                "CopassHermesAgent: prefetch_discover enabled but %s "
                "missing — first-turn discover will NOT happen.",
                " and ".join(missing),
                extra={"identity": identity},
            )

        self._auto_record = bool(auto_record and window is not None)
        if auto_record and not self._auto_record and has_copass_intent:
            logger.warning(
                "CopassHermesAgent: auto_record enabled but window is "
                "missing — turns will NOT be mirrored into a Context Window.",
                extra={"identity": identity},
            )
        self._turn_recorder: Optional[CopassTurnRecorder] = None
        if self._auto_record and window is not None:
            self._turn_recorder = CopassTurnRecorder(
                window=window,
                author=author,
                include_author_prefix=author is not None,
            )

    # ── Public entry points ──────────────────────────────────────

    async def run(
        self,
        messages: Union[str, List[dict]],
        *,
        context: AgentInvocationContext,
    ) -> AgentRunResult:
        final_text_parts: list[str] = []
        tool_calls_log: list[dict] = []
        stop_reason = "end_turn"
        usage: dict = {}
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
        return AgentRunResult(
            final_text="".join(final_text_parts),
            tool_calls=tool_calls_log,
            stop_reason=stop_reason,
            usage=usage,
            session_id=None,
        )

    async def stream(
        self,
        messages: Union[str, List[dict]],
        *,
        context: AgentInvocationContext,
    ) -> AsyncIterator[AgentEvent]:
        prepared_messages, user_contents = await self._prepare_messages(
            messages, context
        )
        if self._turn_recorder is not None:
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
        normalized = self._normalize_messages(messages)
        user_contents = self._user_contents(normalized)
        last_user_content = user_contents[-1] if user_contents else None

        if not self._should_prefetch(last_user_content):
            return normalized, user_contents

        context_block = await self._fetch_context_block(last_user_content or "")
        if context_block is None:
            return normalized, user_contents
        synthetic = {"role": "user", "content": context_block}
        return [synthetic, *normalized], user_contents

    def _should_prefetch(self, last_user_content: Optional[str]) -> bool:
        if not self._prefetch_discover:
            return False
        if not last_user_content:
            return False
        return True

    async def _fetch_context_block(self, query: str) -> Optional[str]:
        assert self._copass_client is not None
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
                "CopassHermesAgent: discover prefetch failed (continuing): %s",
                err,
                extra={"identity": self.identity, "sandbox_id": self._sandbox_id},
            )
            return None

        item_count = len(response.get("items") or [])
        logger.info(
            "CopassHermesAgent: discover prefetch injected %d item(s)",
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
        if isinstance(messages, str):
            return [{"role": "user", "content": messages}]
        return [dict(msg) for msg in (messages or [])]

    @staticmethod
    def _user_contents(messages: list[dict]) -> list[str]:
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
                parts: list[str] = []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        parts.append(str(block.get("text", "")))
                    elif isinstance(block, str):
                        parts.append(block)
                text = "\n".join(parts).strip()
            else:
                text = str(content)
            if text.strip():
                out.append(text)
        return out


__all__ = ["CopassHermesAgent", "DEFAULT_MODEL"]
