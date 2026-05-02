"""Unit tests for the copass_tools factory + CopassRetrievalClient."""

from __future__ import annotations

import inspect
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
import respx

from copass_pydantic_ai import CopassRetrievalClient, copass_tools


# --------------------------------------------------------------------------- #
# copass_tools() factory
# --------------------------------------------------------------------------- #


def _make_client() -> CopassRetrievalClient:
    c = CopassRetrievalClient(api_url="https://api.test", api_key="olk_test")
    c.discover = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "header": "stub header",
            "items": [
                {"id": "a", "score": 0.9, "summary": "Checkout", "canonical_ids": ["c1", "c2"]},
                {"id": "b", "score": 0.7, "summary": "Webhooks", "canonical_ids": ["c3"]},
            ],
            "count": 2,
            "next_steps": "Pick items and call interpret",
            "sandbox_id": "sb1",
            "query": "checkout",
        }
    )
    c.interpret = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "brief": "Checkout retries on 5xx from Stripe.",
            "citations": [],
            "items": [["c1", "c2"]],
        }
    )
    c.search = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "answer": "Auth refresh is driven by a background interceptor.",
            "preset": "copass/1.0",
            "execution_time_ms": 123,
        }
    )
    return c


def test_returns_three_async_callables() -> None:
    client = _make_client()
    tools = copass_tools(client=client, sandbox_id="sb1")

    assert len(tools) == 3
    discover, interpret, search = tools

    for fn, name in [(discover, "discover"), (interpret, "interpret"), (search, "search")]:
        assert inspect.iscoroutinefunction(fn)
        assert fn.__name__ == name
        assert fn.__doc__ and fn.__doc__.strip()


@pytest.mark.asyncio
async def test_discover_forwards_query_and_trims_response() -> None:
    client = _make_client()
    discover, _, _ = copass_tools(client=client, sandbox_id="sb1")

    result = await discover(query="checkout")

    client.discover.assert_awaited_once_with(  # type: ignore[attr-defined]
        "sb1", query="checkout", project_id=None, window=None
    )
    assert result == {
        "header": "stub header",
        "items": [
            {"score": 0.9, "summary": "Checkout", "canonical_ids": ["c1", "c2"]},
            {"score": 0.7, "summary": "Webhooks", "canonical_ids": ["c3"]},
        ],
        "next_steps": "Pick items and call interpret",
    }


@pytest.mark.asyncio
async def test_discover_forwards_project_and_window() -> None:
    class FakeWindow:
        def get_turns(self) -> list[dict[str, str]]:
            return [{"role": "user", "content": "earlier"}]

    window = FakeWindow()
    client = _make_client()
    discover, _, _ = copass_tools(
        client=client,
        sandbox_id="sb1",
        project_id="proj_42",
        window=window,
    )

    await discover(query="x")

    client.discover.assert_awaited_once_with(  # type: ignore[attr-defined]
        "sb1", query="x", project_id="proj_42", window=window
    )


@pytest.mark.asyncio
async def test_interpret_forwards_items_and_preset() -> None:
    client = _make_client()
    _, interpret, _ = copass_tools(client=client, sandbox_id="sb1", preset="copass/1.0")

    result = await interpret(query="why is checkout flaky?", items=[["c1", "c2"]])

    client.interpret.assert_awaited_once_with(  # type: ignore[attr-defined]
        "sb1",
        query="why is checkout flaky?",
        items=[["c1", "c2"]],
        project_id=None,
        window=None,
        preset="copass/1.0",
    )
    assert result == {"brief": "Checkout retries on 5xx from Stripe."}


@pytest.mark.asyncio
async def test_interpret_defaults_preset_to_copass_1_0() -> None:
    client = _make_client()
    _, interpret, _ = copass_tools(client=client, sandbox_id="sb1")

    await interpret(query="q", items=[["c1"]])

    assert client.interpret.await_args.kwargs["preset"] == "copass/1.0"  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_search_returns_only_answer() -> None:
    client = _make_client()
    _, _, search = copass_tools(client=client, sandbox_id="sb1", preset="copass/1.0")

    result = await search(query="how does auth handle refresh?")

    client.search.assert_awaited_once_with(  # type: ignore[attr-defined]
        "sb1",
        query="how does auth handle refresh?",
        project_id=None,
        window=None,
        preset="copass/1.0",
    )
    assert result == {"answer": "Auth refresh is driven by a background interceptor."}


# --------------------------------------------------------------------------- #
# CopassRetrievalClient — HTTP layer
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
@respx.mock
async def test_client_posts_bearer_auth_and_default_history() -> None:
    route = respx.post(
        "https://api.test/api/v1/query/sandboxes/sb1/discover"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "header": "h",
                "items": [],
                "count": 0,
                "next_steps": "n",
                "sandbox_id": "sb1",
                "query": "q",
            },
        )
    )

    client = CopassRetrievalClient(api_url="https://api.test", api_key="olk_abc")
    response = await client.discover("sb1", query="q")

    assert route.called
    request = route.calls.last.request
    assert request.headers["authorization"] == "Bearer olk_abc"
    assert request.headers["content-type"] == "application/json"
    import json

    body = json.loads(request.content)
    assert body == {"query": "q", "history": []}
    assert response["header"] == "h"


@pytest.mark.asyncio
@respx.mock
async def test_client_search_forwards_preset_and_project() -> None:
    route = respx.post(
        "https://api.test/api/v1/query/sandboxes/sb1/search"
    ).mock(
        return_value=httpx.Response(
            200,
            json={"answer": "a", "preset": "copass/1.0"},
        )
    )

    client = CopassRetrievalClient(api_url="https://api.test", api_key="olk_abc")
    await client.search("sb1", query="q", project_id="proj", preset="copass/1.0")

    import json

    body = json.loads(route.calls.last.request.content)
    assert body["preset"] == "copass/1.0"
    assert body["project_id"] == "proj"
