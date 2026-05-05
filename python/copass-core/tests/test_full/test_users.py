"""Wire-level mock tests for ``CopassClient.users``.

The SDK exposes only a minimal public profile shape — ``user_id``,
``display_name``, and the auto-provisioned ``sandbox_id`` / ``project_id``.
Internal ontology fields (``canonical_id``, ``is_user_root``,
``was_created``, ``semantic_tags``, ``metadata``) are returned by the
backend but treated as opaque on the wire.
"""

from __future__ import annotations

import json

import httpx
import respx

from copass_core import CopassClient


_BACKEND_PROFILE = {
    "user_id": "u-1",
    "canonical_id": "c-root",
    "display_name": "Alice",
    "is_user_root": True,
    "semantic_tags": ["person"],
    "was_created": True,
    "created_at": "2026-01-01T00:00:00",
    "metadata": {},
    "sandbox_id": "sb-primary",
    "project_id": "proj-default",
}


@respx.mock
async def test_create_profile(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/users/me/profile").mock(
        return_value=httpx.Response(201, json=_BACKEND_PROFILE)
    )
    resp = await client.users.create_profile(display_name="Alice")
    assert resp["user_id"] == "u-1"
    assert resp["display_name"] == "Alice"
    assert resp["sandbox_id"] == "sb-primary"
    body = json.loads(route.calls.last.request.content)
    assert body["display_name"] == "Alice"


@respx.mock
async def test_get_profile(client: CopassClient) -> None:
    respx.get("http://test/api/v1/users/me/profile").mock(
        return_value=httpx.Response(200, json={**_BACKEND_PROFILE, "was_created": False})
    )
    resp = await client.users.get_profile()
    assert resp["display_name"] == "Alice"
    assert resp["user_id"] == "u-1"
