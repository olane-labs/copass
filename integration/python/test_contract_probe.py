"""Live contract probe — Python SDK against deployed API.

Each test sends one real request to the configured API and asserts the
response **shape** matches what the Tier 1 mock fixtures assume. Catches
the case where the API changed but the mocks didn't.

Read-only. Does not create, update, or delete anything.
"""

from __future__ import annotations

import pytest

from copass_core import CopassClient


@pytest.mark.asyncio
async def test_users_me_profile_shape(client: CopassClient) -> None:
    resp = await client.users.get_profile()
    assert isinstance(resp, dict)
    assert "user_id" in resp


@pytest.mark.asyncio
async def test_api_keys_list_shape(client: CopassClient) -> None:
    resp = await client.api_keys.list()
    assert isinstance(resp, list)


@pytest.mark.asyncio
async def test_usage_get_balance_shape(client: CopassClient) -> None:
    resp = await client.usage.get_balance()
    assert isinstance(resp, dict)
    assert "balance_credits" in resp


@pytest.mark.asyncio
async def test_usage_get_summary_shape(client: CopassClient) -> None:
    resp = await client.usage.get_summary()
    assert isinstance(resp, dict)


@pytest.mark.asyncio
async def test_sandboxes_list_shape(client: CopassClient) -> None:
    resp = await client.sandboxes.list()
    assert isinstance(resp, dict)
    assert "sandboxes" in resp


@pytest.mark.asyncio
async def test_discover_v1_shape(client: CopassClient, sandbox_id: str) -> None:
    """copass/copass_1.0: items have score + summary + canonical_ids."""
    resp = await client.retrieval.discover(
        sandbox_id=sandbox_id,
        query="what context is available",
        preset="copass/copass_1.0",
    )
    assert "items" in resp
    if resp["items"]:
        item = resp["items"][0]
        assert "id" in item
        assert "score" in item
        assert "canonical_ids" in item


@pytest.mark.asyncio
async def test_discover_v2_shape_with_subgraph(
    client: CopassClient, sandbox_id: str,
) -> None:
    """copass/copass_2.0: items must carry subgraph + matched_query_nodes
    when the canonical resolves any matches."""
    resp = await client.retrieval.discover(
        sandbox_id=sandbox_id,
        query="what context is available",
        preset="copass/copass_2.0",
    )
    assert "items" in resp
    if resp["items"]:
        item = resp["items"][0]
        # v2 contract: these fields present (may be None on cold-start
        # sandboxes; the mocks assume non-None for populated graphs).
        assert "subgraph" in item
        assert "matched_query_nodes" in item


@pytest.mark.asyncio
async def test_search_shape(client: CopassClient, sandbox_id: str) -> None:
    resp = await client.retrieval.search(
        sandbox_id=sandbox_id,
        query="what is the user working on",
    )
    assert "answer" in resp
    assert "preset" in resp
    assert "execution_time_ms" in resp


@pytest.mark.asyncio
async def test_interpret_shape_when_items_provided(
    client: CopassClient, sandbox_id: str,
) -> None:
    """First /discover to find any item, then /interpret on it."""
    discover = await client.retrieval.discover(
        sandbox_id=sandbox_id, query="overview", preset="copass/copass_1.0",
    )
    if not discover["items"]:
        pytest.skip("smoke sandbox has no discoverable items — seed it first")
    first = discover["items"][0]
    resp = await client.retrieval.interpret(
        sandbox_id=sandbox_id,
        query="overview",
        items=[first["canonical_ids"]],
    )
    assert "brief" in resp
    assert "citations" in resp
