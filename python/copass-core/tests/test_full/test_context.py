"""Wire-level mock tests for ``CopassClient.context.for_agent``."""

from __future__ import annotations

import json

import httpx
import respx

from copass_core import CopassClient


@respx.mock
async def test_for_agent_minimal_tier(client: CopassClient) -> None:
    """Tier is part of the URL path; query is the body field."""
    route = respx.post("http://test/api/v1/context/for-agent/minimal").mock(
        return_value=httpx.Response(200, json={"context": "stub", "tier": "minimal"})
    )
    resp = await client.context.for_agent(
        sandbox_id="sb-1", tier="minimal", query="hello",
    )
    assert resp["tier"] == "minimal"
    body = json.loads(route.calls.last.request.content)
    assert body["query"] == "hello"
    assert body["sandbox_id"] == "sb-1"


@respx.mock
async def test_for_agent_full_tier_passes_extras(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/context/for-agent/full").mock(
        return_value=httpx.Response(200, json={"context": "x", "tier": "full"})
    )
    await client.context.for_agent(
        sandbox_id="sb-1",
        tier="full",
        query="hello",
        project_id="proj-1",
        max_tokens=1000,
    )
    body = json.loads(route.calls.last.request.content)
    assert body["project_id"] == "proj-1"
    assert body["max_tokens"] == 1000
