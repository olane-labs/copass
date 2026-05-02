"""HermesAgentBackend — wire-shape tests against a mocked HTTP server.

Spike-finding compliance:
  * Finding #2 — every call MUST carry ``Authorization: Bearer <bearer>``
  * Finding #3 — URL ends in ``/v1/chat/completions``; ``messages``
    contains the full history; NO ``X-Hermes-Session-Id`` header sent
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

import httpx
import pytest

from copass_core_agents import AgentInvocationContext, AgentScope
from copass_core_agents.events import AgentFinish, AgentTextDelta
from copass_hermes_agents import HermesAgentBackend


SSE_BODY = (
    "data: " + json.dumps({
        "choices": [{"delta": {"content": "po"}, "finish_reason": None}],
    }) + "\n\n"
    "data: " + json.dumps({
        "choices": [{"delta": {"content": "ng"}, "finish_reason": None}],
    }) + "\n\n"
    "data: " + json.dumps({
        "choices": [{"delta": {}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 9, "completion_tokens": 2},
    }) + "\n\n"
    "data: [DONE]\n\n"
)


class _StubAgent:
    model = "hermes/anthropic/claude-3.5-sonnet"
    system_prompt = "be terse"


def _make_handler(captured: Dict[str, Any]):
    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            content=SSE_BODY.encode("utf-8"),
            headers={"Content-Type": "text/event-stream"},
        )
    return handler


@pytest.mark.asyncio
async def test_stream_targets_chat_completions_endpoint() -> None:
    """Spike Finding #3 — URL must end in ``/v1/chat/completions`` and
    ``messages`` must contain history (NOT a session-id reference)."""
    captured: Dict[str, Any] = {}
    transport = httpx.MockTransport(_make_handler(captured))
    client = httpx.AsyncClient(transport=transport)
    backend = HermesAgentBackend(
        endpoint_url="https://abc-8642.preview.daytona.app",
        api_server_key="bearer-xyz",
        client=client,
    )
    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))
    events: List[Any] = []
    async for evt in backend.stream(_StubAgent(), "ping", ctx):
        events.append(evt)
    await client.aclose()

    assert captured["url"].endswith("/v1/chat/completions")
    assert "messages" in captured["body"]
    assert isinstance(captured["body"]["messages"], list)
    assert len(captured["body"]["messages"]) >= 1
    # No session-id leak.
    assert "X-Hermes-Session-Id" not in captured["headers"]
    assert "x-hermes-session-id" not in {k.lower() for k in captured["headers"]}


@pytest.mark.asyncio
async def test_stream_attaches_caller_bearer_on_every_call() -> None:
    """Spike Finding #2 — Authorization: Bearer <api_server_key> is
    on every Hermes call."""
    captured: Dict[str, Any] = {}
    transport = httpx.MockTransport(_make_handler(captured))
    client = httpx.AsyncClient(transport=transport)
    backend = HermesAgentBackend(
        endpoint_url="https://abc-8642.preview.daytona.app",
        api_server_key="bearer-the-secret",
        client=client,
    )
    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))
    async for _ in backend.stream(_StubAgent(), "ping", ctx):
        pass
    await client.aclose()

    auth = captured["headers"].get("authorization") or captured["headers"].get("Authorization")
    assert auth == "Bearer bearer-the-secret"


@pytest.mark.asyncio
async def test_stream_strips_hermes_prefix_from_model() -> None:
    captured: Dict[str, Any] = {}
    transport = httpx.MockTransport(_make_handler(captured))
    client = httpx.AsyncClient(transport=transport)
    backend = HermesAgentBackend(
        endpoint_url="https://x.example.com",
        api_server_key="b",
        client=client,
    )

    class _Agent:
        model = "hermes/openai/gpt-4o"
        system_prompt = "x"

    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))
    async for _ in backend.stream(_Agent(), "ping", ctx):
        pass
    await client.aclose()

    # Hermes' OpenAI-compat surface receives the OpenRouter id WITHOUT
    # the ``hermes/`` prefix.
    assert captured["body"]["model"] == "openai/gpt-4o"


@pytest.mark.asyncio
async def test_stream_translates_sse_to_agent_events() -> None:
    transport = httpx.MockTransport(_make_handler({}))
    client = httpx.AsyncClient(transport=transport)
    backend = HermesAgentBackend(
        endpoint_url="https://x.example.com",
        api_server_key="b",
        client=client,
    )
    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))
    text_deltas: List[str] = []
    finish: AgentFinish | None = None
    async for evt in backend.stream(_StubAgent(), "ping", ctx):
        if isinstance(evt, AgentTextDelta):
            text_deltas.append(evt.text)
        elif isinstance(evt, AgentFinish):
            finish = evt
    await client.aclose()

    assert "".join(text_deltas) == "pong"
    assert finish is not None
    assert finish.stop_reason == "stop"
    assert finish.usage.get("prompt_tokens") == 9
    assert finish.usage.get("completion_tokens") == 2


@pytest.mark.asyncio
async def test_stream_sends_full_history_in_messages() -> None:
    """Spike Finding #3 — Hermes is stateless; ``messages`` carries the
    full multi-turn history every call. The system prompt is prepended."""
    captured: Dict[str, Any] = {}
    transport = httpx.MockTransport(_make_handler(captured))
    client = httpx.AsyncClient(transport=transport)
    backend = HermesAgentBackend(
        endpoint_url="https://x.example.com",
        api_server_key="b",
        client=client,
    )
    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))
    history = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi back"},
        {"role": "user", "content": "what's the time?"},
    ]
    async for _ in backend.stream(_StubAgent(), history, ctx):
        pass
    await client.aclose()

    msgs = captured["body"]["messages"]
    # System prompt prepended.
    assert msgs[0]["role"] == "system"
    # Full user/assistant history threaded through.
    assert [m["role"] for m in msgs[1:]] == ["user", "assistant", "user"]
    assert msgs[-1]["content"] == "what's the time?"


@pytest.mark.asyncio
async def test_constructor_rejects_missing_inputs() -> None:
    with pytest.raises(ValueError):
        HermesAgentBackend(endpoint_url="", api_server_key="b")
    with pytest.raises(ValueError):
        HermesAgentBackend(
            endpoint_url="https://a", api_server_key="",
        )
