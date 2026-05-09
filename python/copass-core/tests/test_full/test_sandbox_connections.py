"""Wire-level mock tests for ``CopassClient.sandbox_connections``."""

from __future__ import annotations

import json

import httpx
import respx

from copass_core import CopassClient

_BASE = "http://test/api/v1/storage/sandboxes/sb-1/connections"


@respx.mock
async def test_create_with_user_id(client: CopassClient) -> None:
    """Create requires ``role`` and one of (copass_id | user_id | email)."""
    route = respx.post(_BASE).mock(
        return_value=httpx.Response(
            200,
            json={"connection_id": "conn-1", "role": "viewer"},
        )
    )
    resp = await client.sandbox_connections.create(
        sandbox_id="sb-1", role="viewer", user_id="u-2",
    )
    assert resp["connection_id"] == "conn-1"
    body = json.loads(route.calls.last.request.content)
    assert body["role"] == "viewer"
    assert body["user_id"] == "u-2"


@respx.mock
async def test_list(client: CopassClient) -> None:
    respx.get(_BASE).mock(
        return_value=httpx.Response(200, json={"connections": [], "count": 0})
    )
    resp = await client.sandbox_connections.list(sandbox_id="sb-1")
    assert "connections" in resp


@respx.mock
async def test_revoke(client: CopassClient) -> None:
    route = respx.delete(f"{_BASE}/conn-1").mock(
        return_value=httpx.Response(200, json={"revoked": True})
    )
    await client.sandbox_connections.revoke(sandbox_id="sb-1", connection_id="conn-1")
    assert route.called


@respx.mock
async def test_spawn_api_key(client: CopassClient) -> None:
    """URL is ``/api-keys`` (plural)."""
    route = respx.post(f"{_BASE}/conn-1/api-keys").mock(
        return_value=httpx.Response(
            200,
            json={"key_id": "k-1", "key": "olk_conn_abc"},
        )
    )
    resp = await client.sandbox_connections.spawn_api_key(
        sandbox_id="sb-1", connection_id="conn-1",
    )
    assert resp["key"] == "olk_conn_abc"
