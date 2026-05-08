"""copass/2.0 propagation tests for the copass-context-agents discover wrapper.

Verifies the agent-tool wrapper:
  1. Forwards the constructor's ``preset`` to ``client.retrieval.discover()``.
  2. Projects ``subgraph`` + ``matched_query_nodes`` from each item into
     the agent-facing response (instead of dropping them like v1 did).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from copass_context_agents import copass_retrieval_tools


def _client_with_v2_response() -> MagicMock:
    """A mocked CopassClient whose discover() returns a v2-shaped item."""
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
                    "subgraph": "Stripe Integration\n├── webhook_retry_policy ⭐",
                    "matched_query_nodes": ["webhook_retry_policy"],
                },
            ],
            "count": 1,
            "next_steps": "interpret next",
        }
    )
    return c


@pytest.mark.asyncio
async def test_discover_wrapper_forwards_preset_to_underlying_call() -> None:
    client = _client_with_v2_response()
    tools = copass_retrieval_tools(
        client=client,
        sandbox_id="sb-1",
        preset="copass/copass_2.0",
    )
    discover_tool = next(t for t in tools if t.spec.name == "discover")

    await discover_tool.invoke({"query": "stripe"})

    # The wrapper must pass preset to the underlying SDK call.
    call_kwargs = client.retrieval.discover.await_args.kwargs
    assert call_kwargs["preset"] == "copass/copass_2.0"


@pytest.mark.asyncio
async def test_discover_wrapper_projects_v2_fields() -> None:
    client = _client_with_v2_response()
    tools = copass_retrieval_tools(
        client=client,
        sandbox_id="sb-1",
        preset="copass/copass_2.0",
    )
    discover_tool = next(t for t in tools if t.spec.name == "discover")

    result = await discover_tool.invoke({"query": "stripe"})

    item = result["items"][0]
    # v2 fields must survive projection — older wrapper versions dropped them.
    assert item["subgraph"].startswith("Stripe Integration")
    assert item["matched_query_nodes"] == ["webhook_retry_policy"]
    # v1 fields still present alongside.
    assert item["score"] == 0.89
    assert item["canonical_ids"] == ["cid-1", "node-a"]


@pytest.mark.asyncio
async def test_discover_wrapper_handles_v1_response_with_null_v2_fields() -> None:
    """When the server returns v1-shaped items (no subgraph/matched_query_nodes),
    the wrapper must not crash — it should pass None through."""
    client = MagicMock()
    client.retrieval = MagicMock()
    client.retrieval.discover = AsyncMock(
        return_value={
            "header": "",
            "items": [
                {
                    "id": "cid-1",
                    "score": 0.7,
                    "summary": "User > Work > Slack",
                    "canonical_ids": ["cid-1", "cid-2"],
                    # No subgraph / matched_query_nodes — pre-v2 server.
                },
            ],
            "count": 1,
            "next_steps": "",
        }
    )
    tools = copass_retrieval_tools(client=client, sandbox_id="sb-1")
    discover_tool = next(t for t in tools if t.spec.name == "discover")

    result = await discover_tool.invoke({"query": "q"})

    item = result["items"][0]
    assert item["subgraph"] is None
    assert item["matched_query_nodes"] is None
    assert item["summary"] == "User > Work > Slack"
