"""HttpClient + CopassClient — wire-level behavior mocked via respx."""

from __future__ import annotations

import httpx
import pytest
import respx

from copass_core import (
    ApiKeyAuth,
    CopassApiError,
    CopassClient,
)


@pytest.fixture
def client() -> CopassClient:
    return CopassClient(
        auth=ApiKeyAuth(key="olk_test"),
        api_url="http://test",
    )


@respx.mock
async def test_retrieval_discover_sends_bearer_and_body(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/discover").mock(
        return_value=httpx.Response(
            200,
            json={
                "header": "hits",
                "items": [],
                "count": 0,
                "sandbox_id": "sb-1",
                "query": "hi",
                "next_steps": "pick one",
            },
        )
    )
    result = await client.retrieval.discover(sandbox_id="sb-1", query="hi")
    assert route.called
    assert result["sandbox_id"] == "sb-1"
    req = route.calls.last.request
    assert req.headers["Authorization"] == "Bearer olk_test"
    assert req.headers["Content-Type"] == "application/json"
    import json as _json

    body = _json.loads(req.content)
    assert body["query"] == "hi"
    assert body["history"] == []


@respx.mock
async def test_retrieval_interpret_passes_items_and_preset(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/interpret").mock(
        return_value=httpx.Response(
            200,
            json={
                "brief": "answer",
                "citations": [],
                "items": [["a"]],
                "sandbox_id": "sb-1",
                "query": "q",
            },
        )
    )
    await client.retrieval.interpret(
        sandbox_id="sb-1",
        query="q",
        items=[["cid-1", "cid-2"]],
        preset="fast",
        project_id="p-1",
    )
    import json as _json

    body = _json.loads(route.calls.last.request.content)
    assert body["items"] == [["cid-1", "cid-2"]]
    assert body["preset"] == "fast"
    assert body["project_id"] == "p-1"


@respx.mock
async def test_context_for_agent_posts_to_tier_path(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/context/for-agent/minimal").mock(
        return_value=httpx.Response(200, json={"context": "..."})
    )
    result = await client.context.for_agent(sandbox_id="sb-1", tier="minimal", query="q")
    assert route.called
    assert result == {"context": "..."}
    import json as _json

    body = _json.loads(route.calls.last.request.content)
    assert body == {"sandbox_id": "sb-1", "query": "q"}


@respx.mock
async def test_api_error_surfaces_status_and_body(client: CopassClient) -> None:
    respx.post("http://test/api/v1/query/sandboxes/sb-1/discover").mock(
        return_value=httpx.Response(400, json={"detail": "bad query"})
    )
    with pytest.raises(CopassApiError) as exc_info:
        await client.retrieval.discover(sandbox_id="sb-1", query="")
    assert exc_info.value.status == 400
    assert exc_info.value.body == {"detail": "bad query"}


async def test_window_like_protocol_used_in_retrieval() -> None:
    from copass_core import ChatMessage

    class MyWindow:
        def __init__(self) -> None:
            self._turns = [
                ChatMessage(role="user", content="hi"),
                ChatMessage(role="assistant", content="hey"),
            ]

        def get_turns(self):
            return list(self._turns)

    with respx.mock(base_url="http://test") as mock:
        mock.post("/api/v1/query/sandboxes/sb-1/discover").mock(
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
        client = CopassClient(auth=ApiKeyAuth(key="olk_t"), api_url="http://test")
        await client.retrieval.discover(sandbox_id="sb-1", query="q", window=MyWindow())
        import json as _json

        body = _json.loads(mock.calls.last.request.content)
        assert body["history"] == [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hey"},
        ]
