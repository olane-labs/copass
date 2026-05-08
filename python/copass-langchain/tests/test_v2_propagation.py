"""copass/2.0 propagation tests for the copass-langchain discover wrapper."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from copass_langchain import copass_tools


def _client_with_v2_response() -> MagicMock:
    c = MagicMock()
    c.retrieval = MagicMock()
    c.retrieval.discover = AsyncMock(
        return_value={
            "header": "menu",
            "items": [
                {
                    "id": "cid-1",
                    "score": 0.89,
                    "summary": "",
                    "canonical_ids": ["cid-1", "node-a"],
                    "subgraph": "Tree ⭐",
                    "matched_query_nodes": ["A"],
                },
            ],
            "count": 1,
            "next_steps": "",
        }
    )
    return c


@pytest.mark.asyncio
async def test_discover_wrapper_forwards_preset() -> None:
    client = _client_with_v2_response()
    tools = copass_tools(client=client, sandbox_id="sb-1", preset="copass/copass_2.0")

    await tools.discover.ainvoke({"query": "q"})
    call_kwargs = client.retrieval.discover.await_args.kwargs
    assert call_kwargs["preset"] == "copass/copass_2.0"


@pytest.mark.asyncio
async def test_discover_wrapper_projects_v2_fields() -> None:
    client = _client_with_v2_response()
    tools = copass_tools(client=client, sandbox_id="sb-1", preset="copass/copass_2.0")

    result = await tools.discover.ainvoke({"query": "q"})
    item = result["items"][0]
    assert item["subgraph"] == "Tree ⭐"
    assert item["matched_query_nodes"] == ["A"]
