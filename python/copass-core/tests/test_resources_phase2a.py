"""Wire-level tests for Phase 2A write resources.

Covers the two new ``AgentsResource`` write methods that back the
Phase 2A SDK extension:

* ``update_tool_sources(sandbox_id, slug, tool_sources)`` — calls
  ``PATCH /agents/{slug}/tool-sources``.
* ``wire_integration(sandbox_id, slug, app_slug)`` — calls
  ``POST /agents/{slug}/wire-integration`` and parses the response
  envelope into :class:`WireIntegrationResult`.

One representative test per method — covers HTTP method, path shape,
and body serialization. Mocked via respx; no network.
"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from copass_core import ApiKeyAuth, CopassClient, WireIntegrationResult


@pytest.fixture
def client() -> CopassClient:
    return CopassClient(auth=ApiKeyAuth(key="olk_test"), api_url="http://test")


# --- update_tool_sources ----------------------------------------


@respx.mock
async def test_update_tool_sources_with_explicit_list(client: CopassClient) -> None:
    route = respx.patch(
        "http://test/api/v1/storage/sandboxes/sb-1/agents/demo/tool-sources",
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "agent_id": "ag-1",
                "slug": "demo",
                "version": 5,
            },
        )
    )
    await client.agents.update_tool_sources(
        "sb-1", "demo", ["copass_retrieval", "pipedream"],
    )
    body = json.loads(route.calls.last.request.content)
    assert body == {"tool_sources": ["copass_retrieval", "pipedream"]}


@respx.mock
async def test_update_tool_sources_with_none_sends_null(client: CopassClient) -> None:
    route = respx.patch(
        "http://test/api/v1/storage/sandboxes/sb-1/agents/demo/tool-sources",
    ).mock(
        return_value=httpx.Response(
            200,
            json={"agent_id": "ag-1", "slug": "demo", "version": 6},
        )
    )
    await client.agents.update_tool_sources("sb-1", "demo", None)
    # JSON null distinguishes "revert to caller default" from "absent".
    body = json.loads(route.calls.last.request.content)
    assert body == {"tool_sources": None}


@respx.mock
async def test_update_tool_sources_with_empty_list(client: CopassClient) -> None:
    route = respx.patch(
        "http://test/api/v1/storage/sandboxes/sb-1/agents/demo/tool-sources",
    ).mock(
        return_value=httpx.Response(
            200,
            json={"agent_id": "ag-1", "slug": "demo", "version": 7},
        )
    )
    await client.agents.update_tool_sources("sb-1", "demo", [])
    body = json.loads(route.calls.last.request.content)
    assert body == {"tool_sources": []}


# --- wire_integration -------------------------------------------


@respx.mock
async def test_wire_integration_returns_typed_result(client: CopassClient) -> None:
    route = respx.post(
        "http://test/api/v1/storage/sandboxes/sb-1/agents/demo/wire-integration",
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "wired": True,
                "agent_slug": "demo",
                "app_slug": "slack",
                "sources_added": ["pipedream"],
                "tool_count": 12,
                "mode": "explicit",
                "message": "Slack is now wired to demo — 12 tools available.",
            },
        )
    )
    result = await client.agents.wire_integration("sb-1", "demo", "slack")
    assert isinstance(result, WireIntegrationResult)
    assert result.wired is True
    assert result.mode == "explicit"
    assert result.sources_added == ["pipedream"]
    assert result.tool_count == 12
    body = json.loads(route.calls.last.request.content)
    assert body == {"app_slug": "slack"}


@respx.mock
async def test_wire_integration_handles_not_connected_branch(
    client: CopassClient,
) -> None:
    respx.post(
        "http://test/api/v1/storage/sandboxes/sb-1/agents/demo/wire-integration",
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "wired": False,
                "agent_slug": "demo",
                "app_slug": "gmail",
                "sources_added": [],
                "tool_count": 0,
                "mode": "not_connected",
                "message": "Gmail is not connected.",
            },
        )
    )
    result = await client.agents.wire_integration("sb-1", "demo", "gmail")
    assert result.wired is False
    assert result.mode == "not_connected"
    assert result.tool_count == 0
    assert result.sources_added == []
