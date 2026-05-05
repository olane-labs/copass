"""Wire-level mock tests for ``CopassClient.matrix.query``."""

from __future__ import annotations

import httpx
import respx

from copass_core import CopassClient


@respx.mock
async def test_query_basic(client: CopassClient) -> None:
    route = respx.get("http://test/api/v1/matrix/query").mock(
        return_value=httpx.Response(
            200,
            json={
                "query": "q",
                "answer": "a",
                "preset": "copass/copass_1.0",
                "execution_time_ms": 42,
            },
        )
    )
    resp = await client.matrix.query(query="q")
    assert resp["answer"] == "a"
    params = route.calls.last.request.url.params
    assert params.get("query") == "q"


@respx.mock
async def test_query_sends_x_search_matrix_header(client: CopassClient) -> None:
    route = respx.get("http://test/api/v1/matrix/query").mock(
        return_value=httpx.Response(
            200,
            json={
                "query": "q",
                "answer": "a",
                "preset": "copass/copass_2.0",
                "execution_time_ms": 100,
            },
        )
    )
    await client.matrix.query(query="q", preset="copass/copass_2.0", trace_id="t-1")
    headers = route.calls.last.request.headers
    assert headers["X-Search-Matrix"] == "copass/copass_2.0"
    assert headers["X-Trace-Id"] == "t-1"


@respx.mock
async def test_query_passes_detail_instruction_header(client: CopassClient) -> None:
    route = respx.get("http://test/api/v1/matrix/query").mock(
        return_value=httpx.Response(200, json={"query": "q", "answer": "a"})
    )
    await client.matrix.query(query="q", detail_instruction="be brief")
    headers = route.calls.last.request.headers
    assert headers.get("X-Detail-Instruction") == "be brief"
