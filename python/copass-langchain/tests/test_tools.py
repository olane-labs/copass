"""copass_tools — tool shape, argument schema, live-call wiring via
mocked ``CopassClient``."""

from __future__ import annotations

from typing import Any, List

import httpx
import pytest
import respx
from copass_config import (
    DISCOVER_DESCRIPTION,
    INTERPRET_DESCRIPTION,
    SEARCH_DESCRIPTION,
)
from copass_core import ApiKeyAuth, ChatMessage, CopassClient

from copass_langchain import CopassTools, copass_tools


@pytest.fixture
def client() -> CopassClient:
    return CopassClient(
        auth=ApiKeyAuth(key="olk_test"),
        api_url="http://test",
    )


def test_returns_copass_tools_bundle(client: CopassClient) -> None:
    tools = copass_tools(client=client, sandbox_id="sb-1")
    assert isinstance(tools, CopassTools)
    assert tools.discover.name == "discover"
    assert tools.interpret.name == "interpret"
    assert tools.search.name == "search"


def test_descriptions_match_copass_config(client: CopassClient) -> None:
    tools = copass_tools(client=client, sandbox_id="sb-1")
    assert tools.discover.description == DISCOVER_DESCRIPTION
    assert tools.interpret.description == INTERPRET_DESCRIPTION
    assert tools.search.description == SEARCH_DESCRIPTION


def test_tools_all_returns_three(client: CopassClient) -> None:
    tools = copass_tools(client=client, sandbox_id="sb-1")
    assert len(tools.all()) == 3


@respx.mock
async def test_discover_hits_correct_endpoint(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/discover").mock(
        return_value=httpx.Response(
            200,
            json={
                "header": "hits",
                "items": [
                    {"score": 0.9, "summary": "summary-1", "canonical_ids": ["a", "b"]},
                ],
                "count": 1,
                "sandbox_id": "sb-1",
                "query": "auth",
                "next_steps": "interpret one",
            },
        )
    )
    tools = copass_tools(client=client, sandbox_id="sb-1")
    result = await tools.discover.ainvoke({"query": "auth"})
    assert route.called
    assert result["header"] == "hits"
    assert len(result["items"]) == 1
    assert result["items"][0]["canonical_ids"] == ["a", "b"]


@respx.mock
async def test_interpret_forwards_items_and_preset(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/interpret").mock(
        return_value=httpx.Response(
            200,
            json={
                "brief": "synthesized answer",
                "citations": [],
                "items": [["a"]],
                "sandbox_id": "sb-1",
                "query": "q",
            },
        )
    )
    tools = copass_tools(client=client, sandbox_id="sb-1", preset="fast")
    result = await tools.interpret.ainvoke(
        {"query": "q", "items": [["a", "b"]]},
    )
    assert result == {"brief": "synthesized answer"}
    import json as _json

    body = _json.loads(route.calls.last.request.content)
    assert body["items"] == [["a", "b"]]
    assert body["preset"] == "fast"


@respx.mock
async def test_search_wraps_response(client: CopassClient) -> None:
    respx.post("http://test/api/v1/query/sandboxes/sb-1/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "answer": "Because the /checkout worker was pinned to 1 replica.",
                "preset": "auto",
                "execution_time_ms": 200,
                "sandbox_id": "sb-1",
                "query": "checkout flaky",
            },
        )
    )
    tools = copass_tools(client=client, sandbox_id="sb-1")
    result = await tools.search.ainvoke({"query": "checkout flaky"})
    assert "checkout worker" in result["answer"]


@respx.mock
async def test_window_turns_sent_as_history(client: CopassClient) -> None:
    class _Window:
        def __init__(self) -> None:
            self._turns: List[ChatMessage] = [
                ChatMessage(role="user", content="earlier user message"),
                ChatMessage(role="assistant", content="earlier assistant reply"),
            ]

        def get_turns(self) -> List[ChatMessage]:
            return list(self._turns)

        async def add_turn(self, turn: ChatMessage) -> None:  # pragma: no cover
            self._turns.append(turn)

    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/discover").mock(
        return_value=httpx.Response(
            200,
            json={
                "header": "",
                "items": [],
                "count": 0,
                "sandbox_id": "sb-1",
                "query": "q",
                "next_steps": "",
            },
        )
    )
    tools = copass_tools(client=client, sandbox_id="sb-1", window=_Window())
    await tools.discover.ainvoke({"query": "q"})
    import json as _json

    body = _json.loads(route.calls.last.request.content)
    assert body["history"] == [
        {"role": "user", "content": "earlier user message"},
        {"role": "assistant", "content": "earlier assistant reply"},
    ]
