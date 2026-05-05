"""Wire-level mock tests for ``CopassClient.users``.

Mirrors the real backend (``frame_graph/api/routers/users.py``):
``UserProfileResponse`` returns ``user_id, canonical_id, display_name,
is_user_root, semantic_tags, was_created, created_at, metadata,
sandbox_id, project_id``. POST returns 201 Created on first creation.
"""

from __future__ import annotations

import json

import httpx
import respx

from copass_core import CopassClient


_FULL_PROFILE = {
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
        return_value=httpx.Response(201, json=_FULL_PROFILE)
    )
    resp = await client.users.create_profile(display_name="Alice")
    assert resp["user_id"] == "u-1"
    assert resp["canonical_id"] == "c-root"
    assert resp["sandbox_id"] == "sb-primary"
    assert resp["was_created"] is True
    body = json.loads(route.calls.last.request.content)
    assert body["display_name"] == "Alice"


@respx.mock
async def test_get_profile(client: CopassClient) -> None:
    respx.get("http://test/api/v1/users/me/profile").mock(
        return_value=httpx.Response(200, json={**_FULL_PROFILE, "was_created": False})
    )
    resp = await client.users.get_profile()
    assert resp["display_name"] == "Alice"
    assert resp["is_user_root"] is True
    assert resp["was_created"] is False
