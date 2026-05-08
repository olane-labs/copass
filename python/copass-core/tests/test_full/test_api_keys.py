"""Wire-level mock tests for ``CopassClient.api_keys``.

Mocks must mirror the real backend (``frame_graph/api/routers/api_keys.py``):
``CreateApiKeyResponse`` uses ``id``/``key_prefix`` (NOT ``key_id``), the
list endpoint returns a bare JSON array of ``ApiKeyListItem`` rows, and
``DELETE`` returns ``RevokeApiKeyResponse {revoked, id, name}``.
"""

from __future__ import annotations

import json

import httpx
import respx

from copass_core import CopassClient


@respx.mock
async def test_create(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/api-keys").mock(
        return_value=httpx.Response(
            201,
            json={
                "id": "k-1",
                "name": "ci",
                "key": "olk_live_abc",
                "key_prefix": "olk_live_abc",
                "created_at": "2026-01-01T00:00:00",
                "expires_at": None,
                "warning": "Store this key securely — it will not be shown again.",
            },
        )
    )
    resp = await client.api_keys.create(name="ci")
    assert resp["id"] == "k-1"
    assert resp["key"] == "olk_live_abc"
    assert resp["key_prefix"] == "olk_live_abc"
    body = json.loads(route.calls.last.request.content)
    assert body["name"] == "ci"


@respx.mock
async def test_list_returns_array(client: CopassClient) -> None:
    """The endpoint returns a bare JSON array; the SDK passes it through."""
    respx.get("http://test/api/v1/api-keys").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "id": "k-1",
                    "name": "ci",
                    "key_prefix": "olk_live_abc",
                    "created_at": "2026-01-01T00:00:00",
                    "use_count": 0,
                    "is_expired": False,
                    "jwt_needs_refresh": False,
                },
                {
                    "id": "k-2",
                    "name": "prod",
                    "key_prefix": "olk_live_def",
                    "created_at": "2026-01-02T00:00:00",
                    "use_count": 0,
                    "is_expired": False,
                    "jwt_needs_refresh": False,
                },
            ],
        )
    )
    resp = await client.api_keys.list()
    assert isinstance(resp, list)
    assert len(resp) == 2
    assert resp[0]["id"] == "k-1"
    assert resp[0]["key_prefix"] == "olk_live_abc"


@respx.mock
async def test_revoke(client: CopassClient) -> None:
    route = respx.delete("http://test/api/v1/api-keys/k-1").mock(
        return_value=httpx.Response(200, json={"revoked": True, "id": "k-1", "name": "ci"})
    )
    resp = await client.api_keys.revoke("k-1")
    assert route.called
    assert resp["revoked"] is True
    assert resp["id"] == "k-1"
