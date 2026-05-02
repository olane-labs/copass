"""HermesAgentBackend — speaks Hermes' OpenAI-compatible API server.

ADR 0008 Phase 1b. Per the Hermes spike (`.scaffolding/hermes-spike-results.md`):

  * Stateless ``/v1/chat/completions`` only — full conversation history
    sent in ``messages[]`` on every turn (spike Finding #3).
  * ``Authorization: Bearer <API_SERVER_KEY>`` on every call. Bearer is
    the per-sandbox caller-side key (NOT an LLM key) minted at sandbox
    provision time and dies with the sandbox (spike Finding #2).
  * Hermes' downstream LLM key (OpenRouter) is bound by Hermes at agent
    construction time inside the sandbox; this backend never sends it
    over the wire.
  * Hermes' fallback-provider chain MUST be disabled inside the sandbox
    (spike Finding #4) — this backend trusts that posture.

Model-id translation: callers pass ``"hermes/<openrouter-model-id>"``
on the agent settings; the backend strips ``"hermes/"`` before
forwarding to Hermes' ``model`` field. OpenRouter then routes the rest.

Streaming: Hermes returns OpenAI-compatible Server-Sent Events on
``stream=True``; we translate ``content`` deltas into ``AgentTextDelta``
and finish/usage into ``AgentFinish``. Tool calls are not wired in
Phase 1b — Hermes acts as a native MCP client against ``mcp.copass.com``;
the backend doesn't proxy tool call/result events for 1b. Phase 1c will
add tool-result streaming once the MCP→Hermes round-trip is exercised.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from typing import Any, AsyncIterator, List, Optional, Union

import httpx
from copass_core_agents.backends.base_backend import (
    AgentBackend,
    AgentRunResult,
)
from copass_core_agents.events import (
    AgentEvent,
    AgentFinish,
    AgentTextDelta,
)
from copass_core_agents.invocation_context import AgentInvocationContext


logger = logging.getLogger(__name__)


HERMES_MODEL_PREFIX = "hermes/"

# Retry parameters mirror the Daytona helper's posture (S3 backoff
# shape) — short total budget so a stuck sandbox surfaces quickly.
_HERMES_MAX_RETRIES = 2
_HERMES_BASE_DELAY_MS = 250.0
_HERMES_MAX_DELAY_MS = 2_000.0


def _strip_model_prefix(model: str) -> str:
    """Strip the ``hermes/`` prefix; raise if absent (caller bug)."""
    if not isinstance(model, str) or not model.startswith(HERMES_MODEL_PREFIX):
        raise ValueError(
            f"HermesAgentBackend: model must start with {HERMES_MODEL_PREFIX!r}; "
            f"got {model!r}"
        )
    return model[len(HERMES_MODEL_PREFIX):]


class HermesAgentBackend(AgentBackend):
    """:class:`AgentBackend` that drives a per-sandbox Hermes process.

    One instance is bound to ONE sandbox endpoint URL + bearer pair —
    the factory at ``frame_graph.copass_id.api.dependencies.
    get_hermes_agent_backend`` constructs and caches per
    ``(user_id, sandbox_id)``.

    Args:
        endpoint_url: The base URL Hermes is reachable at, e.g.
            ``"https://abcd-8642.preview.daytona.app"``. The backend
            POSTs to ``{endpoint_url}/v1/chat/completions``.
        api_server_key: Caller-side bearer that Hermes' bind-guard
            requires (``Authorization: Bearer ...``). Per-sandbox; not
            an LLM key.
        default_model: Default ``"hermes/<openrouter-id>"`` model when
            :attr:`BaseAgent.model` doesn't carry one; the agent's
            ``model`` field always wins when present.
        request_timeout_s: Total HTTP timeout. Default 120s.
        connect_timeout_s: Connect-only timeout. Default 10s.
        client: Pre-built ``httpx.AsyncClient``. If omitted, a fresh
            client is constructed per backend instance and closed when
            :meth:`aclose` is invoked.
        config: Optional backend-level config dict (inherited).
    """

    def __init__(
        self,
        *,
        endpoint_url: str,
        api_server_key: str,
        default_model: str = "hermes/anthropic/claude-3.5-sonnet",
        request_timeout_s: float = 120.0,
        connect_timeout_s: float = 10.0,
        client: Optional[httpx.AsyncClient] = None,
        config: Optional[dict] = None,
    ) -> None:
        super().__init__(config=config)
        if not endpoint_url:
            raise ValueError("HermesAgentBackend: endpoint_url is required")
        if not api_server_key:
            raise ValueError("HermesAgentBackend: api_server_key is required")
        self._endpoint_url = endpoint_url.rstrip("/")
        self._api_server_key = api_server_key
        self._default_model = default_model
        self._request_timeout_s = request_timeout_s
        self._connect_timeout_s = connect_timeout_s
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(
                request_timeout_s, connect=connect_timeout_s,
            ),
        )

    @property
    def endpoint_url(self) -> str:
        return self._endpoint_url

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    # ---- AgentBackend ABC implementations ----

    async def run(
        self,
        agent: Any,
        messages: Union[str, List[dict]],
        context: AgentInvocationContext,
    ) -> AgentRunResult:
        final_text: list[str] = []
        usage: dict = {}
        stop_reason = "end_turn"
        async for evt in self.stream(agent, messages, context):
            if isinstance(evt, AgentTextDelta):
                final_text.append(evt.text)
            elif isinstance(evt, AgentFinish):
                stop_reason = evt.stop_reason
                usage = dict(evt.usage)
        return AgentRunResult(
            final_text="".join(final_text),
            tool_calls=[],
            stop_reason=stop_reason,
            usage=usage,
            session_id=None,
        )

    async def stream(
        self,
        agent: Any,
        messages: Union[str, List[dict]],
        context: AgentInvocationContext,
    ) -> AsyncIterator[AgentEvent]:
        chat_messages = self._build_chat_messages(agent, messages)
        model_id = self._resolve_model_id(agent)
        body = {
            "model": model_id,
            "messages": chat_messages,
            "stream": True,
        }
        # Optional per-turn overrides land here when the runtime threads
        # them in via context.handles (Phase 1c).
        max_tokens = self._extract_handle(context, "max_tokens")
        if isinstance(max_tokens, int) and max_tokens > 0:
            body["max_tokens"] = max_tokens
        temperature = self._extract_handle(context, "temperature")
        if isinstance(temperature, (int, float)):
            body["temperature"] = float(temperature)

        url = f"{self._endpoint_url}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self._api_server_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

        last_error: Optional[BaseException] = None
        for attempt in range(_HERMES_MAX_RETRIES + 1):
            try:
                async for evt in self._stream_once(url=url, headers=headers, body=body):
                    yield evt
                return
            except asyncio.CancelledError:
                raise
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError) as e:
                last_error = e
                if attempt == _HERMES_MAX_RETRIES:
                    break
                delay_ms = min(
                    _HERMES_BASE_DELAY_MS * (2 ** attempt),
                    _HERMES_MAX_DELAY_MS,
                )
                sleep_s = random.uniform(0, delay_ms) / 1000.0
                logger.warning(
                    "HermesAgentBackend: transient error %s — retrying in %.0fms",
                    type(e).__name__, sleep_s * 1000,
                )
                await asyncio.sleep(sleep_s)
            except httpx.HTTPStatusError as e:
                # 4xx is not retryable. 5xx retried once.
                if e.response.status_code < 500 or attempt == _HERMES_MAX_RETRIES:
                    raise
                last_error = e
                delay_ms = min(
                    _HERMES_BASE_DELAY_MS * (2 ** attempt),
                    _HERMES_MAX_DELAY_MS,
                )
                await asyncio.sleep(random.uniform(0, delay_ms) / 1000.0)
        assert last_error is not None
        raise last_error

    # ---- Internals ----

    async def _stream_once(
        self,
        *,
        url: str,
        headers: dict,
        body: dict,
    ) -> AsyncIterator[AgentEvent]:
        usage_accumulator: dict = {}
        finished = False
        async with self._client.stream(
            "POST", url, json=body, headers=headers,
        ) as response:
            response.raise_for_status()
            async for raw in response.aiter_lines():
                line = raw.strip()
                if not line:
                    continue
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    finished = True
                    break
                try:
                    chunk = json.loads(payload)
                except json.JSONDecodeError:
                    logger.warning(
                        "HermesAgentBackend: malformed SSE chunk (skipped): %s",
                        payload[:200],
                    )
                    continue

                # Usage block — OpenRouter / Hermes attach it on the
                # final chunk in OpenAI-compatible streams.
                usage = chunk.get("usage") if isinstance(chunk, dict) else None
                if isinstance(usage, dict):
                    for k in (
                        "prompt_tokens", "completion_tokens", "total_tokens",
                        "input_tokens", "output_tokens",
                    ):
                        v = usage.get(k)
                        if isinstance(v, int):
                            usage_accumulator[k] = v

                choices = (
                    chunk.get("choices") if isinstance(chunk, dict) else None
                )
                if not isinstance(choices, list):
                    continue
                for choice in choices:
                    if not isinstance(choice, dict):
                        continue
                    delta = choice.get("delta") or {}
                    if not isinstance(delta, dict):
                        continue
                    content = delta.get("content")
                    if isinstance(content, str) and content:
                        yield AgentTextDelta(text=content)
                    finish_reason = choice.get("finish_reason")
                    if finish_reason:
                        finished = True
                        yield AgentFinish(
                            stop_reason=str(finish_reason),
                            usage=dict(usage_accumulator),
                            session_id=None,
                        )
        if not finished:
            yield AgentFinish(
                stop_reason="end_turn",
                usage=dict(usage_accumulator),
                session_id=None,
            )

    def _resolve_model_id(self, agent: Any) -> str:
        candidate = getattr(agent, "model", None) or self._default_model
        return _strip_model_prefix(candidate)

    @staticmethod
    def _build_chat_messages(
        agent: Any, messages: Union[str, List[dict]],
    ) -> list[dict]:
        """Build the OpenAI-compatible ``messages[]`` array.

        Prepends the agent's ``system_prompt`` as a leading
        ``role=system`` message when present. Normalizes the user's
        input — strings become a single user message; lists are
        passed through with role/content normalization.
        """
        out: list[dict] = []
        system_prompt = getattr(agent, "system_prompt", None)
        if isinstance(system_prompt, str) and system_prompt.strip():
            out.append({"role": "system", "content": system_prompt})
        if isinstance(messages, str):
            out.append({"role": "user", "content": messages})
            return out
        for msg in messages or []:
            if not isinstance(msg, dict):
                continue
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if isinstance(content, list):
                # Coerce content blocks back to a single string — Hermes'
                # OpenAI-compat surface expects ``content: str`` (not the
                # multi-block shape Anthropic uses).
                text_parts: list[str] = []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text_parts.append(str(block.get("text", "")))
                    elif isinstance(block, str):
                        text_parts.append(block)
                content = "\n".join(p for p in text_parts if p)
            elif not isinstance(content, str):
                content = str(content)
            out.append({"role": role, "content": content})
        return out

    @staticmethod
    def _extract_handle(context: AgentInvocationContext, key: str) -> Any:
        handles = getattr(context, "handles", None) if context is not None else None
        if not isinstance(handles, dict):
            return None
        return handles.get(key)


__all__ = ["HermesAgentBackend", "HERMES_MODEL_PREFIX"]
