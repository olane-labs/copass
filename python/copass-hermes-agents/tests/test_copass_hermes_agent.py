"""CopassHermesAgent — BaseAgent shape parity with CopassManagedAgent.

Verifies the discover-prefetch + auto-record wiring without a real
``copass_client`` / ``ContextWindow`` — the bare construction must
silently no-op when deps aren't passed (mirrors the Anthropic
sibling), so vanilla `BaseAgent`-only flows still work.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List
from unittest.mock import MagicMock

import httpx
import pytest

from copass_core_agents import (
    AgentInvocationContext,
    AgentScope,
    AgentToolRegistry,
)
from copass_core_agents.events import AgentFinish, AgentTextDelta
from copass_hermes_agents import CopassHermesAgent, HermesAgentBackend


def _empty_registry() -> AgentToolRegistry:
    """BaseAgent rejects construction without tools or a resolver — pass
    an empty registry as the canonical 'no static tools' shape."""
    return AgentToolRegistry()


SSE_BODY = (
    "data: " + json.dumps({
        "choices": [{"delta": {"content": "pong"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 1},
    }) + "\n\n"
    "data: [DONE]\n\n"
)


def _make_handler(captured: Dict[str, Any]):
    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            content=SSE_BODY.encode("utf-8"),
            headers={"Content-Type": "text/event-stream"},
        )
    return handler


def _make_backend(captured: Dict[str, Any]) -> HermesAgentBackend:
    transport = httpx.MockTransport(_make_handler(captured))
    client = httpx.AsyncClient(transport=transport)
    return HermesAgentBackend(
        endpoint_url="https://x.example.com",
        api_server_key="bearer",
        client=client,
    )


@pytest.mark.asyncio
async def test_basic_construction_no_copass_deps_runs_cleanly() -> None:
    """Without ``copass_client`` or ``window``, the agent acts as a
    plain BaseAgent over HermesAgentBackend."""
    captured: Dict[str, Any] = {}
    backend = _make_backend(captured)
    agent = CopassHermesAgent(
        identity="t",
        system_prompt="terse",
        backend=backend,
        tools=_empty_registry(),
    )
    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))
    parts: List[str] = []
    async for evt in agent.stream("ping", context=ctx):
        if isinstance(evt, AgentTextDelta):
            parts.append(evt.text)
    await backend.aclose()
    assert "".join(parts) == "pong"


@pytest.mark.asyncio
async def test_run_returns_aggregated_result() -> None:
    captured: Dict[str, Any] = {}
    backend = _make_backend(captured)
    agent = CopassHermesAgent(
        identity="t",
        system_prompt="terse",
        backend=backend,
        tools=_empty_registry(),
    )
    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))
    result = await agent.run("ping", context=ctx)
    await backend.aclose()
    assert result.final_text == "pong"
    assert result.stop_reason == "stop"
    assert result.usage.get("prompt_tokens") == 5


@pytest.mark.asyncio
async def test_prefetch_warns_when_partial_wiring(caplog) -> None:
    """When ``copass_client`` is set but ``sandbox_id`` isn't (or vice
    versa), the agent emits a warning and silently no-ops the prefetch.
    Same posture as CopassManagedAgent."""
    backend = _make_backend({})
    fake_client = MagicMock()
    with caplog.at_level("WARNING"):
        agent = CopassHermesAgent(
            identity="t",
            system_prompt="terse",
            backend=backend,
            tools=_empty_registry(),
            copass_client=fake_client,
            sandbox_id=None,
        )
    assert any("prefetch_discover" in r.getMessage() for r in caplog.records)
    assert agent._prefetch_discover is False
    await backend.aclose()


@pytest.mark.asyncio
async def test_prefetch_disabled_when_no_copass_intent() -> None:
    """No copass deps + no window: silent. No warnings emitted."""
    backend = _make_backend({})
    import logging
    logger = logging.getLogger("copass_hermes_agents.hermes_agent")
    captured: List[str] = []

    class _H(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record.getMessage())

    h = _H()
    logger.addHandler(h)
    try:
        CopassHermesAgent(
            identity="t",
            system_prompt="terse",
            backend=backend,
            tools=_empty_registry(),
        )
    finally:
        logger.removeHandler(h)
    await backend.aclose()
    assert not any("prefetch_discover" in m for m in captured)
    assert not any("auto_record" in m for m in captured)
