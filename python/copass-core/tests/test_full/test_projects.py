"""Wire-level mock tests for ``CopassClient.projects``."""

from __future__ import annotations

import json

import httpx
import respx

from copass_core import CopassClient

_BASE = "http://test/api/v1/storage/sandboxes/sb-1/projects"


@respx.mock
async def test_create(client: CopassClient) -> None:
    route = respx.post(_BASE).mock(
        return_value=httpx.Response(
            200,
            json={"project_id": "p-1", "name": "Demo", "status": "active"},
        )
    )
    resp = await client.projects.create(sandbox_id="sb-1", name="Demo")
    assert resp["project_id"] == "p-1"
    body = json.loads(route.calls.last.request.content)
    assert body["name"] == "Demo"


@respx.mock
async def test_list_passes_status(client: CopassClient) -> None:
    route = respx.get(_BASE).mock(
        return_value=httpx.Response(200, json={"projects": [], "count": 0})
    )
    await client.projects.list(sandbox_id="sb-1", status="active")
    params = route.calls.last.request.url.params
    assert params.get("status") == "active"


@respx.mock
async def test_retrieve(client: CopassClient) -> None:
    respx.get(f"{_BASE}/p-1").mock(
        return_value=httpx.Response(200, json={"project_id": "p-1"})
    )
    resp = await client.projects.retrieve(sandbox_id="sb-1", project_id="p-1")
    assert resp["project_id"] == "p-1"


@respx.mock
async def test_update(client: CopassClient) -> None:
    """``update`` takes name/description/metadata as kwargs (no ``updates`` dict)."""
    route = respx.patch(f"{_BASE}/p-1").mock(
        return_value=httpx.Response(200, json={"project_id": "p-1", "name": "renamed"})
    )
    await client.projects.update(sandbox_id="sb-1", project_id="p-1", name="renamed")
    body = json.loads(route.calls.last.request.content)
    assert body == {"name": "renamed"}


@respx.mock
async def test_archive(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/p-1/archive").mock(
        return_value=httpx.Response(200, json={"status": "archived"})
    )
    await client.projects.archive(sandbox_id="sb-1", project_id="p-1")
    assert route.called


@respx.mock
async def test_delete(client: CopassClient) -> None:
    route = respx.delete(f"{_BASE}/p-1").mock(
        return_value=httpx.Response(200, json={"deleted": True})
    )
    await client.projects.delete(sandbox_id="sb-1", project_id="p-1")
    assert route.called


@respx.mock
async def test_link_source(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/p-1/sources/src-1").mock(
        return_value=httpx.Response(200, json={"linked": True})
    )
    await client.projects.link_source(sandbox_id="sb-1", project_id="p-1", source_id="src-1")
    assert route.called


@respx.mock
async def test_unlink_source(client: CopassClient) -> None:
    route = respx.delete(f"{_BASE}/p-1/sources/src-1").mock(
        return_value=httpx.Response(200, json={"unlinked": True})
    )
    await client.projects.unlink_source(sandbox_id="sb-1", project_id="p-1", source_id="src-1")
    assert route.called
