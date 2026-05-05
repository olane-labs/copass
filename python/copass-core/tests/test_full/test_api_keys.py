"""Wire-level mock tests for ``CopassClient.api_keys``."""

from __future__ import annotations

import json

import httpx
import respx

from copass_core import CopassClient


@respx.mock
async def test_create(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/api-keys").mock(
        return_value=httpx.Response(
            200,
            json={"key_id": "k-1", "key": "olk_live_abc", "name": "ci"},
        )
    )
    resp = await client.api_keys.create(name="ci")
    assert resp["key"] == "olk_live_abc"
    body = json.loads(route.calls.last.request.content)
    assert body["name"] == "ci"


@respx.mock
async def test_list_returns_array(client: CopassClient) -> None:
    """The endpoint returns a JSON array; the SDK passes it through."""
    respx.get("http://test/api/v1/api-keys").mock(
        return_value=httpx.Response(
            200,
            json=[{"key_id": "k-1"}, {"key_id": "k-2"}],
        )
    )
    resp = await client.api_keys.list()
    assert isinstance(resp, list)
    assert len(resp) == 2
    assert resp[0]["key_id"] == "k-1"


@respx.mock
async def test_revoke(client: CopassClient) -> None:
    route = respx.delete("http://test/api/v1/api-keys/k-1").mock(
        return_value=httpx.Response(200, json={"revoked": True})
    )
    await client.api_keys.revoke("k-1")
    assert route.called
