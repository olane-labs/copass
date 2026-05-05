"""Wire-level mock tests for ``CopassClient.users``."""

from __future__ import annotations

import json

import httpx
import respx

from copass_core import CopassClient


@respx.mock
async def test_create_profile(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/users/me/profile").mock(
        return_value=httpx.Response(
            200,
            json={"user_id": "u-1", "display_name": "Alice"},
        )
    )
    resp = await client.users.create_profile(display_name="Alice")
    assert resp["user_id"] == "u-1"
    body = json.loads(route.calls.last.request.content)
    assert body["display_name"] == "Alice"


@respx.mock
async def test_get_profile(client: CopassClient) -> None:
    respx.get("http://test/api/v1/users/me/profile").mock(
        return_value=httpx.Response(
            200,
            json={"user_id": "u-1", "display_name": "Alice"},
        )
    )
    resp = await client.users.get_profile()
    assert resp["display_name"] == "Alice"
