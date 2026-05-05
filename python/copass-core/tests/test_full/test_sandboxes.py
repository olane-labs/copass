"""Wire-level mock tests for ``CopassClient.sandboxes``."""

from __future__ import annotations

import json

import httpx
import respx

from copass_core import CopassClient

_BASE = "http://test/api/v1/storage/sandboxes"


@respx.mock
async def test_create(client: CopassClient) -> None:
    route = respx.post(_BASE).mock(
        return_value=httpx.Response(
            200,
            json={
                "sandbox_id": "sb-1",
                "owner_id": "owner",
                "name": "demo",
                "tier": "free",
                "status": "active",
                "storage_provider_type": "platform_s3",
                "limits": {},
                "metadata": {},
            },
        )
    )
    resp = await client.sandboxes.create(name="demo", owner_id="owner")
    assert resp["sandbox_id"] == "sb-1"
    body = json.loads(route.calls.last.request.content)
    assert body == {"name": "demo", "owner_id": "owner"}


@respx.mock
async def test_list_passes_filters(client: CopassClient) -> None:
    route = respx.get(_BASE).mock(
        return_value=httpx.Response(200, json={"sandboxes": [], "count": 0})
    )
    await client.sandboxes.list(status="active", owner_id="owner-1")
    params = route.calls.last.request.url.params
    assert params.get("status") == "active"
    assert params.get("owner_id") == "owner-1"


@respx.mock
async def test_retrieve(client: CopassClient) -> None:
    respx.get(f"{_BASE}/sb-1").mock(
        return_value=httpx.Response(200, json={"sandbox_id": "sb-1"})
    )
    resp = await client.sandboxes.retrieve("sb-1")
    assert resp["sandbox_id"] == "sb-1"


@respx.mock
async def test_update_patches(client: CopassClient) -> None:
    route = respx.patch(f"{_BASE}/sb-1").mock(
        return_value=httpx.Response(200, json={"sandbox_id": "sb-1", "name": "renamed"})
    )
    await client.sandboxes.update("sb-1", name="renamed")
    body = json.loads(route.calls.last.request.content)
    assert body == {"name": "renamed"}


@respx.mock
async def test_suspend(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/sb-1/suspend").mock(
        return_value=httpx.Response(200, json={"sandbox_id": "sb-1", "status": "suspended"})
    )
    await client.sandboxes.suspend("sb-1")
    assert route.called


@respx.mock
async def test_reactivate(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/sb-1/reactivate").mock(
        return_value=httpx.Response(200, json={"sandbox_id": "sb-1", "status": "active"})
    )
    await client.sandboxes.reactivate("sb-1")
    assert route.called


@respx.mock
async def test_archive(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/sb-1/archive").mock(
        return_value=httpx.Response(200, json={"success": True})
    )
    resp = await client.sandboxes.archive("sb-1")
    assert resp == {"success": True}


@respx.mock
async def test_destroy(client: CopassClient) -> None:
    route = respx.delete(f"{_BASE}/sb-1").mock(
        return_value=httpx.Response(200, json={"deleted": True})
    )
    await client.sandboxes.destroy("sb-1")
    assert route.called
