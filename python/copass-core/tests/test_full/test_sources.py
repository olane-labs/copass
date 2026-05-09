"""Wire-level mock tests for ``CopassClient.sources``."""

from __future__ import annotations

import json

import httpx
import respx

from copass_core import CopassClient

_BASE = "http://test/api/v1/storage/sandboxes/sb-1/sources"


@respx.mock
async def test_register(client: CopassClient) -> None:
    """``register`` requires ``provider`` + ``name``."""
    route = respx.post(_BASE).mock(
        return_value=httpx.Response(
            200,
            json={"data_source_id": "ds-1", "name": "demo", "provider": "manual"},
        )
    )
    resp = await client.sources.register(
        sandbox_id="sb-1", provider="manual", name="demo",
    )
    assert resp["data_source_id"] == "ds-1"
    body = json.loads(route.calls.last.request.content)
    assert body["provider"] == "manual"
    assert body["name"] == "demo"


@respx.mock
async def test_list(client: CopassClient) -> None:
    respx.get(_BASE).mock(
        return_value=httpx.Response(200, json={"sources": [], "count": 0})
    )
    resp = await client.sources.list(sandbox_id="sb-1")
    assert "sources" in resp


@respx.mock
async def test_retrieve(client: CopassClient) -> None:
    respx.get(f"{_BASE}/ds-1").mock(
        return_value=httpx.Response(200, json={"data_source_id": "ds-1"})
    )
    resp = await client.sources.retrieve(sandbox_id="sb-1", source_id="ds-1")
    assert resp["data_source_id"] == "ds-1"


@respx.mock
async def test_update(client: CopassClient) -> None:
    """``update`` takes name/ingestion_mode/etc. as kwargs."""
    route = respx.patch(f"{_BASE}/ds-1").mock(
        return_value=httpx.Response(200, json={"data_source_id": "ds-1", "name": "renamed"})
    )
    await client.sources.update(sandbox_id="sb-1", source_id="ds-1", name="renamed")
    body = json.loads(route.calls.last.request.content)
    assert body == {"name": "renamed"}


@respx.mock
async def test_connect_linear(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/linear").mock(
        return_value=httpx.Response(
            200,
            json={"data_source_id": "ds-linear", "provider": "linear"},
        )
    )
    await client.sources.connect_linear(sandbox_id="sb-1", api_key="lin_abc")
    body = json.loads(route.calls.last.request.content)
    assert body["api_key"] == "lin_abc"


@respx.mock
async def test_pull(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/ds-1/pull").mock(
        return_value=httpx.Response(
            202,
            json={
                "job_id": "job-1",
                "job_type": "data_source_pull",
                "status": "queued",
            },
        )
    )
    resp = await client.sources.pull(
        sandbox_id="sb-1",
        source_id="ds-1",
        since="2026-01-01T00:00:00Z",
        vault_only=True,
    )
    assert resp["job_id"] == "job-1"
    body = json.loads(route.calls.last.request.content)
    assert body["since"] == "2026-01-01T00:00:00Z"
    assert body["vault_only"] is True


@respx.mock
async def test_pause(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/ds-1/pause").mock(
        return_value=httpx.Response(200, json={"status": "paused"})
    )
    await client.sources.pause(sandbox_id="sb-1", source_id="ds-1")
    assert route.called


@respx.mock
async def test_resume(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/ds-1/resume").mock(
        return_value=httpx.Response(200, json={"status": "active"})
    )
    await client.sources.resume(sandbox_id="sb-1", source_id="ds-1")
    assert route.called


@respx.mock
async def test_disconnect(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/ds-1/disconnect").mock(
        return_value=httpx.Response(200, json={"status": "disconnected"})
    )
    await client.sources.disconnect(sandbox_id="sb-1", source_id="ds-1")
    assert route.called


@respx.mock
async def test_delete(client: CopassClient) -> None:
    route = respx.delete(f"{_BASE}/ds-1").mock(
        return_value=httpx.Response(200, json={"deleted": True})
    )
    await client.sources.delete(sandbox_id="sb-1", source_id="ds-1")
    assert route.called


@respx.mock
async def test_purge(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/ds-1/purge").mock(
        return_value=httpx.Response(
            200,
            json={
                "success": True,
                "delete_source_applied": False,
                "events_deleted": 1,
                "extractions_deleted": 0,
                "canonical_index_rows_deleted": 0,
                "entity_vectors_deleted": 2,
                "triggers_deleted": 0,
                "webhooks_deleted": 0,
                "event_seen_deleted": 0,
                "project_links_deleted": 0,
                "strategy_artifacts_deleted": 0,
                "pull_artifacts_deleted": 0,
                "user_strategies_deleted": 0,
                "vault_objects_deleted": 0,
            },
        )
    )
    await client.sources.purge(sandbox_id="sb-1", source_id="ds-1")
    assert route.called
    body = json.loads(route.calls.last.request.content)
    assert body == {}

    route2 = respx.post(f"{_BASE}/ds-2/purge").mock(
        return_value=httpx.Response(
            200,
            json={
                "success": True,
                "delete_source_applied": True,
                "events_deleted": 0,
                "extractions_deleted": 0,
                "canonical_index_rows_deleted": 0,
                "entity_vectors_deleted": 0,
                "triggers_deleted": 0,
                "webhooks_deleted": 0,
                "event_seen_deleted": 0,
                "project_links_deleted": 0,
                "strategy_artifacts_deleted": 0,
                "pull_artifacts_deleted": 0,
                "user_strategies_deleted": 0,
                "vault_objects_deleted": 0,
            },
        )
    )
    await client.sources.purge(
        sandbox_id="sb-1", source_id="ds-2", delete_source=True,
    )
    assert route2.called
    body2 = json.loads(route2.calls.last.request.content)
    assert body2 == {"delete_source": True}


@respx.mock
async def test_register_user_mcp(client: CopassClient) -> None:
    """register_user_mcp requires name + base_url + auth_kind. Returns a
    typed UserMcpSourceResult dataclass — assert via attribute access."""
    route = respx.post(f"{_BASE}/user-mcp").mock(
        return_value=httpx.Response(
            200,
            json={
                "source": {"data_source_id": "ds-mcp-1", "name": "my-mcp"},
                "tools": [],
                "test_results": {"reachable": True},
            },
        )
    )
    resp = await client.sources.register_user_mcp(
        sandbox_id="sb-1",
        name="my-mcp",
        base_url="https://mcp.example",
        auth_kind="none",
    )
    # Returns a UserMcpSourceResult dataclass; just verify the call happened.
    assert resp is not None
    body = json.loads(route.calls.last.request.content)
    assert body["base_url"] == "https://mcp.example"


@respx.mock
async def test_test_user_mcp(client: CopassClient) -> None:
    """URL is ``/sources/{id}/user-mcp/test``."""
    route = respx.post(f"{_BASE}/ds-mcp-1/user-mcp/test").mock(
        return_value=httpx.Response(
            200,
            json={
                "source": {"data_source_id": "ds-mcp-1"},
                "tools": [],
                "test_results": {"reachable": True},
            },
        )
    )
    await client.sources.test_user_mcp(sandbox_id="sb-1", source_id="ds-mcp-1")
    assert route.called


@respx.mock
async def test_revoke_user_mcp(client: CopassClient) -> None:
    """URL is ``/sources/{id}/user-mcp/revoke``."""
    route = respx.post(f"{_BASE}/ds-mcp-1/user-mcp/revoke").mock(
        return_value=httpx.Response(
            200,
            json={
                "source": {"data_source_id": "ds-mcp-1"},
                "tools": [],
                "test_results": {},
            },
        )
    )
    await client.sources.revoke_user_mcp(sandbox_id="sb-1", source_id="ds-mcp-1")
    assert route.called


@respx.mock
async def test_ingest_via_sources(client: CopassClient) -> None:
    """``sources.ingest`` posts to ``/sandboxes/{sid}/ingest`` with
    data_source_id pre-bound from positional ``source_id``."""
    route = respx.post("http://test/api/v1/storage/sandboxes/sb-1/ingest").mock(
        return_value=httpx.Response(200, json={"job_id": "j-1", "status": "queued"})
    )
    await client.sources.ingest(
        sandbox_id="sb-1", source_id="ds-1", text="hello",
    )
    body = json.loads(route.calls.last.request.content)
    assert body["text"] == "hello"
    assert body["data_source_id"] == "ds-1"
