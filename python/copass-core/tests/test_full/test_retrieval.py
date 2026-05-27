"""Wire-level mock tests for ``CopassClient.retrieval`` — the
``discover`` / ``interpret`` / ``search`` surface mounted at
``/api/v1/query/sandboxes/{sandbox_id}/...``.

Covers every method × every meaningful preset path. Asserts:
- exact URL the SDK posts to
- request body field shape (query, history, project_id, preset, items, etc.)
- response unpacking (including the v2-only subgraph + matched_query_nodes
  fields when copass/copass_2.0 is selected)

The contract verified here IS the deploy guard — when the server
contract changes, the canned responses below need updating, and the
SDK code needs to keep parsing them correctly.
"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from copass_core import ApiKeyAuth, CopassClient, CostInfo


# ─── /discover ────────────────────────────────────────────────────────


@respx.mock
async def test_discover_posts_minimum_body(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/discover").mock(
        return_value=httpx.Response(
            200,
            json={
                "header": "menu",
                "items": [],
                "count": 0,
                "sandbox_id": "sb-1",
                "query": "q",
                "next_steps": "interpret next",
            },
        )
    )
    resp = await client.retrieval.discover(sandbox_id="sb-1", query="q")
    assert resp["sandbox_id"] == "sb-1"
    body = json.loads(route.calls.last.request.content)
    assert body["query"] == "q"
    assert body["history"] == []
    assert "preset" not in body  # omitted when None — server picks default


@respx.mock
async def test_discover_forwards_preset_and_project_id(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/discover").mock(
        return_value=httpx.Response(
            200,
            json={
                "header": "menu",
                "items": [],
                "count": 0,
                "sandbox_id": "sb-1",
                "query": "q",
                "next_steps": "",
            },
        )
    )
    await client.retrieval.discover(
        sandbox_id="sb-1",
        query="q",
        project_id="proj_1",
        reference_date="2026-05-04",
        preset="copass/copass_2.0",
    )
    body = json.loads(route.calls.last.request.content)
    assert body["preset"] == "copass/copass_2.0"
    assert body["project_id"] == "proj_1"
    assert body["reference_date"] == "2026-05-04"


@respx.mock
async def test_discover_unpacks_v2_subgraph_and_matched_query_nodes(
    client: CopassClient,
) -> None:
    """v2 contract: each item carries subgraph (rendered ASCII tree) +
    matched_query_nodes (entities from the question that resolved). The
    SDK returns the raw dict — agents can read the new fields as-is."""
    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/discover").mock(
        return_value=httpx.Response(
            200,
            json={
                "header": "menu",
                "items": [
                    {
                        "id": "cid-1",
                        "score": 0.89,
                        "summary": "",
                        "canonical_ids": ["cid-1", "node-a", "node-b"],
                        "subgraph": "Stripe Integration\n├── webhook_retry_policy ⭐\n└── stripe-webhooks ⭐",
                        "matched_query_nodes": ["webhook_retry_policy", "stripe-webhooks"],
                    },
                ],
                "count": 1,
                "sandbox_id": "sb-1",
                "query": "stripe webhooks",
                "next_steps": "",
            },
        )
    )
    resp = await client.retrieval.discover(
        sandbox_id="sb-1",
        query="stripe webhooks",
        preset="copass/copass_2.0",
    )
    item = resp["items"][0]
    assert item["subgraph"].startswith("Stripe Integration")
    assert "⭐" in item["subgraph"]
    assert item["matched_query_nodes"] == ["webhook_retry_policy", "stripe-webhooks"]
    assert item["canonical_ids"] == ["cid-1", "node-a", "node-b"]


@respx.mock
async def test_discover_resolves_window_to_history(client: CopassClient) -> None:
    """When a WindowLike is passed, the SDK reads its turns and ships them
    as the request's `history` field. window itself never goes on the wire."""
    class FakeWindow:
        def get_turns(self) -> list:
            return [{"role": "user", "content": "earlier"}]

    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/discover").mock(
        return_value=httpx.Response(
            200,
            json={"header": "", "items": [], "count": 0, "sandbox_id": "sb-1", "query": "q", "next_steps": ""},
        )
    )
    await client.retrieval.discover(
        sandbox_id="sb-1",
        query="q",
        window=FakeWindow(),
    )
    body = json.loads(route.calls.last.request.content)
    assert body["history"] == [{"role": "user", "content": "earlier"}]
    assert "window" not in body


# ─── /interpret ───────────────────────────────────────────────────────


@respx.mock
async def test_interpret_posts_items_and_preset(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/interpret").mock(
        return_value=httpx.Response(
            200,
            json={
                "brief": "answer",
                "citations": [],
                "items": [["cid-1"]],
                "sandbox_id": "sb-1",
                "query": "q",
            },
        )
    )
    await client.retrieval.interpret(
        sandbox_id="sb-1",
        query="q",
        items=[["cid-1", "cid-2"]],
        preset="copass/copass_2.0",
        max_tokens=500,
    )
    body = json.loads(route.calls.last.request.content)
    assert body["items"] == [["cid-1", "cid-2"]]
    assert body["preset"] == "copass/copass_2.0"
    assert body["max_tokens"] == 500


@respx.mock
async def test_interpret_omits_optional_fields_when_none(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/interpret").mock(
        return_value=httpx.Response(
            200,
            json={"brief": "", "citations": [], "items": [["a"]], "sandbox_id": "sb-1", "query": "q"},
        )
    )
    await client.retrieval.interpret(sandbox_id="sb-1", query="q", items=[["a"]])
    body = json.loads(route.calls.last.request.content)
    assert "preset" not in body
    assert "max_tokens" not in body
    assert "project_id" not in body


@respx.mock
async def test_interpret_unpacks_brief_and_citations(client: CopassClient) -> None:
    respx.post("http://test/api/v1/query/sandboxes/sb-1/interpret").mock(
        return_value=httpx.Response(
            200,
            json={
                "brief": "Stripe webhooks are configured to retry 3x.",
                "citations": [
                    {"canonical_id": "cid-1", "name": "Stripe", "relevance": 0.92},
                ],
                "items": [["cid-1"]],
                "sandbox_id": "sb-1",
                "query": "stripe retries",
            },
        )
    )
    resp = await client.retrieval.interpret(
        sandbox_id="sb-1", query="stripe retries", items=[["cid-1"]],
    )
    assert "Stripe" in resp["brief"]
    assert resp["citations"][0]["relevance"] == 0.92


# ─── /search ──────────────────────────────────────────────────────────


@respx.mock
async def test_search_posts_full_body(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "answer": "ok",
                "preset": "copass/copass_1.0",
                "execution_time_ms": 100,
                "sandbox_id": "sb-1",
                "query": "q",
            },
        )
    )
    await client.retrieval.search(
        sandbox_id="sb-1",
        query="q",
        preset="copass/copass_1.0",
        detail_level="detailed",
        max_tokens=1000,
        project_id="proj-1",
        reference_date="2026-05-04",
    )
    body = json.loads(route.calls.last.request.content)
    assert body["preset"] == "copass/copass_1.0"
    assert body["detail_level"] == "detailed"
    assert body["max_tokens"] == 1000
    assert body["project_id"] == "proj-1"
    assert body["reference_date"] == "2026-05-04"


@respx.mock
async def test_search_thinking_suffix_passes_through(client: CopassClient) -> None:
    """Server applies task decomposition when preset ends in :thinking;
    the SDK just forwards the string verbatim."""
    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "answer": "ok",
                "preset": "copass/copass_2.0:thinking",
                "execution_time_ms": 5000,
                "sandbox_id": "sb-1",
                "query": "complex",
            },
        )
    )
    await client.retrieval.search(
        sandbox_id="sb-1", query="complex", preset="copass/copass_2.0:thinking",
    )
    body = json.loads(route.calls.last.request.content)
    assert body["preset"] == "copass/copass_2.0:thinking"


@respx.mock
async def test_search_unpacks_warnings(client: CopassClient) -> None:
    respx.post("http://test/api/v1/query/sandboxes/sb-1/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "answer": "thin",
                "preset": "copass/copass_1.0",
                "execution_time_ms": 200,
                "warnings": ["no_context"],
                "sandbox_id": "sb-1",
                "query": "obscure",
            },
        )
    )
    resp = await client.retrieval.search(sandbox_id="sb-1", query="obscure")
    assert resp["warnings"] == ["no_context"]


@respx.mock
async def test_search_alias_preset_passes_through(client: CopassClient) -> None:
    """Short aliases (copass/1.0, copass/2.0) are kept for backward-compat
    and the SDK forwards them as-is — the server resolves them to the
    same SearchMatrix as the canonical names."""
    route = respx.post("http://test/api/v1/query/sandboxes/sb-1/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "answer": "ok", "preset": "copass/2.0",
                "execution_time_ms": 100, "sandbox_id": "sb-1", "query": "q",
            },
        )
    )
    await client.retrieval.search(sandbox_id="sb-1", query="q", preset="copass/2.0")
    body = json.loads(route.calls.last.request.content)
    assert body["preset"] == "copass/2.0"


# ─── Cost field on response envelope ─────────────────────────────────
#
# The server attaches an optional ``cost`` sub-object to all three
# retrieval responses when retrieval has a billable cost. These tests
# verify the SDK does not strip it, and that ``CostInfo.from_dict``
# is the documented path for typed consumption.


@respx.mock
async def test_discover_passes_through_cost_field(client: CopassClient) -> None:
    """Server returns ``cost`` in enforce mode — the SDK does not
    strip it, and ``CostInfo.from_dict`` parses the sub-object."""
    respx.post("http://test/api/v1/query/sandboxes/sb-1/discover").mock(
        return_value=httpx.Response(
            200,
            json={
                "header": "menu",
                "items": [],
                "count": 0,
                "sandbox_id": "sb-1",
                "query": "q",
                "next_steps": "",
                "cost": {
                    "microcents": 1234,
                    "usd": 0.001234,
                    "deduction_id": "5f3e8b9c-1234-4abc-9def-0123456789ab",
                    "gate_mode": "enforce",
                },
            },
        )
    )
    resp = await client.retrieval.discover(sandbox_id="sb-1", query="q")
    assert resp["cost"]["microcents"] == 1234
    cost = CostInfo.from_dict(resp["cost"])
    assert cost.gate_mode == "enforce"
    assert cost.deduction_id == "5f3e8b9c-1234-4abc-9def-0123456789ab"


@respx.mock
async def test_interpret_cost_shadow_with_null_deduction_id(
    client: CopassClient,
) -> None:
    """Shadow mode with no ledger entry: ``cost`` is populated (caller
    learns the figure) but ``deduction_id`` is ``null``. The SDK
    round-trips both correctly."""
    respx.post("http://test/api/v1/query/sandboxes/sb-1/interpret").mock(
        return_value=httpx.Response(
            200,
            json={
                "brief": "answer",
                "citations": [],
                "items": [["cid-1"]],
                "sandbox_id": "sb-1",
                "query": "q",
                "cost": {
                    "microcents": 800,
                    "usd": 0.0008,
                    "deduction_id": None,
                    "gate_mode": "shadow",
                },
            },
        )
    )
    resp = await client.retrieval.interpret(
        sandbox_id="sb-1", query="q", items=[["cid-1"]],
    )
    cost = CostInfo.from_dict(resp["cost"])
    assert cost.gate_mode == "shadow"
    assert cost.deduction_id is None
    assert cost.microcents == 800


@respx.mock
async def test_search_cost_absent_in_gate_off_mode(client: CopassClient) -> None:
    """Gate ``off``: backend omits ``cost`` entirely (or sends null).
    Consumers MUST treat absent / null identically."""
    respx.post("http://test/api/v1/query/sandboxes/sb-1/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "answer": "ok",
                "preset": "copass/copass_1.0",
                "execution_time_ms": 100,
                "sandbox_id": "sb-1",
                "query": "q",
                # no "cost" key — gate_mode = "off"
            },
        )
    )
    resp = await client.retrieval.search(sandbox_id="sb-1", query="q")
    assert resp.get("cost") is None
