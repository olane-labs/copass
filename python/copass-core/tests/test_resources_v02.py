"""Wire-level tests for v0.2 resource surface.

One representative test per resource — covers the HTTP method, path
shape, and body/query serialization. Mocked via respx; no network.
"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from copass_core import ApiKeyAuth, CopassClient


@pytest.fixture
def client() -> CopassClient:
    return CopassClient(auth=ApiKeyAuth(key="olk_test"), api_url="http://test")


# ─── sandboxes ────────────────────────────────────────────────────────


@respx.mock
async def test_sandboxes_create_posts_body(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/storage/sandboxes").mock(
        return_value=httpx.Response(
            200,
            json={
                "sandbox_id": "sb-1",
                "user_id": "u",
                "owner_id": "owner",
                "name": "demo",
                "tier": "free",
                "status": "active",
                "storage_provider_type": "platform_s3",
                "limits": {"max_data_sources": 10, "max_projects": 5, "max_storage_bytes": 100},
                "metadata": {},
            },
        )
    )
    resp = await client.sandboxes.create(name="demo", owner_id="owner")
    assert resp["sandbox_id"] == "sb-1"
    body = json.loads(route.calls.last.request.content)
    assert body == {"name": "demo", "owner_id": "owner"}


@respx.mock
async def test_sandboxes_list_passes_query(client: CopassClient) -> None:
    route = respx.get("http://test/api/v1/storage/sandboxes").mock(
        return_value=httpx.Response(200, json={"sandboxes": [], "count": 0})
    )
    await client.sandboxes.list(status="active", owner_id="owner-1")
    params = route.calls.last.request.url.params
    assert params.get("status") == "active"
    assert params.get("owner_id") == "owner-1"


@respx.mock
async def test_sandboxes_archive_hits_subpath(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/storage/sandboxes/sb-1/archive").mock(
        return_value=httpx.Response(200, json={"success": True})
    )
    resp = await client.sandboxes.archive("sb-1")
    assert route.called
    assert resp == {"success": True}


# ─── sources ──────────────────────────────────────────────────────────


@respx.mock
async def test_sources_register(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/storage/sandboxes/sb-1/sources").mock(
        return_value=httpx.Response(
            200,
            json={
                "data_source_id": "ds-1",
                "user_id": "u",
                "sandbox_id": "sb-1",
                "provider": "custom",
                "name": "my-source",
                "ingestion_mode": "manual",
                "status": "active",
                "adapter_config": {},
            },
        )
    )
    resp = await client.sources.register(
        "sb-1", provider="custom", name="my-source", ingestion_mode="manual"
    )
    assert resp["data_source_id"] == "ds-1"
    body = json.loads(route.calls.last.request.content)
    assert body["provider"] == "custom"
    assert body["ingestion_mode"] == "manual"


@respx.mock
async def test_sources_ingest_routes_to_ingest_path(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/storage/sandboxes/sb-1/ingest").mock(
        return_value=httpx.Response(
            200,
            json={
                "job_id": "j-1",
                "status": "queued",
                "encrypted": False,
                "sandbox_id": "sb-1",
                "status_url": "/api/v1/storage/ingest/j-1",
            },
        )
    )
    await client.sources.ingest("sb-1", "ds-1", text="hi", source_type="text")
    body = json.loads(route.calls.last.request.content)
    assert body["data_source_id"] == "ds-1"
    assert body["source_type"] == "text"


# ─── ingest ───────────────────────────────────────────────────────────


@respx.mock
async def test_ingest_shorthand_and_explicit(client: CopassClient) -> None:
    respx.post("http://test/api/v1/storage/ingest").mock(
        return_value=httpx.Response(
            200,
            json={"job_id": "j", "status": "queued", "encrypted": False, "sandbox_id": "", "status_url": "/"},
        )
    )
    respx.post("http://test/api/v1/storage/sandboxes/sb-1/ingest").mock(
        return_value=httpx.Response(
            200,
            json={"job_id": "j", "status": "queued", "encrypted": False, "sandbox_id": "sb-1", "status_url": "/"},
        )
    )
    a = await client.ingest.text(text="one")
    b = await client.ingest.text_in_sandbox("sb-1", text="two")
    assert a["job_id"] == "j"
    assert b["sandbox_id"] == "sb-1"


# ─── projects ─────────────────────────────────────────────────────────


@respx.mock
async def test_projects_link_and_unlink_source(client: CopassClient) -> None:
    link = respx.post(
        "http://test/api/v1/storage/sandboxes/sb-1/projects/p-1/sources/ds-1"
    ).mock(return_value=httpx.Response(200, json={"success": True}))
    unlink = respx.delete(
        "http://test/api/v1/storage/sandboxes/sb-1/projects/p-1/sources/ds-1"
    ).mock(return_value=httpx.Response(200, json={"success": True}))
    await client.projects.link_source("sb-1", "p-1", "ds-1")
    await client.projects.unlink_source("sb-1", "p-1", "ds-1")
    assert link.called
    assert unlink.called


# ─── entities ─────────────────────────────────────────────────────────


@respx.mock
async def test_entities_search_returns_results(client: CopassClient) -> None:
    respx.get("http://test/api/v1/storage/sandboxes/sb-1/entities/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    {"canonical_id": "c-1", "name": "Auth", "similarity": 0.91},
                ]
            },
        )
    )
    results = await client.entities.search(
        "sb-1", "auth", limit=5, min_similarity=0.5
    )
    assert len(results) == 1
    assert results[0]["canonical_id"] == "c-1"


# ─── matrix ───────────────────────────────────────────────────────────


@respx.mock
async def test_matrix_query_sends_preset_header(client: CopassClient) -> None:
    route = respx.get("http://test/api/v1/matrix/query").mock(
        return_value=httpx.Response(
            200,
            json={
                "query": "q",
                "answer": "a",
                "preset": "semantic_path",
                "execution_time_ms": 42,
            },
        )
    )
    await client.matrix.query(
        query="q", preset="semantic_path", detail_instruction="be brief", trace_id="t-1"
    )
    headers = route.calls.last.request.headers
    assert headers["X-Search-Matrix"] == "semantic_path"
    assert headers["X-Detail-Instruction"] == "be brief"
    assert headers["X-Trace-Id"] == "t-1"


# ─── vault ────────────────────────────────────────────────────────────


@respx.mock
async def test_vault_store_puts_raw_bytes(client: CopassClient) -> None:
    route = respx.put(
        "http://test/api/v1/storage/sandboxes/sb-1/vault/foo/bar"
    ).mock(
        return_value=httpx.Response(
            200,
            json={"key": "foo/bar", "full_key": "u/sb-1/foo/bar", "size_bytes": 5, "encrypted": False},
        )
    )
    resp = await client.vault.store("sb-1", "foo/bar", b"hello")
    assert resp["size_bytes"] == 5
    req = route.calls.last.request
    assert req.headers["Content-Type"] == "application/octet-stream"
    assert req.content == b"hello"


@respx.mock
async def test_vault_retrieve_returns_raw_bytes(client: CopassClient) -> None:
    respx.get(
        "http://test/api/v1/storage/sandboxes/sb-1/vault/foo/bar"
    ).mock(return_value=httpx.Response(200, content=b"\x01\x02\x03"))
    data = await client.vault.retrieve("sb-1", "foo/bar")
    assert data == b"\x01\x02\x03"


@respx.mock
async def test_vault_key_percent_encodes_segments(client: CopassClient) -> None:
    # Segments encode reserved chars; `/` remains a path separator.
    route = respx.put(
        "http://test/api/v1/storage/sandboxes/sb-1/vault/my%20folder/file%3Aname"
    ).mock(return_value=httpx.Response(200, json={}))
    await client.vault.store("sb-1", "my folder/file:name", b"x")
    assert route.called


# ─── users / api-keys / usage ─────────────────────────────────────────


@respx.mock
async def test_users_get_profile(client: CopassClient) -> None:
    respx.get("http://test/api/v1/users/me/profile").mock(
        return_value=httpx.Response(
            200,
            json={"canonical_id": "c-1", "display_name": "Brendon", "is_user_root": True},
        )
    )
    profile = await client.users.get_profile()
    assert profile["canonical_id"] == "c-1"


@respx.mock
async def test_api_keys_create_and_list(client: CopassClient) -> None:
    respx.post("http://test/api/v1/api-keys").mock(
        return_value=httpx.Response(
            200,
            json={"key_id": "k-1", "key": "olk_new", "name": "ci", "created_at": "..."},
        )
    )
    respx.get("http://test/api/v1/api-keys").mock(
        return_value=httpx.Response(200, json=[{"key_id": "k-1", "name": "ci", "prefix": "olk_", "created_at": "..."}])
    )
    created = await client.api_keys.create(name="ci", expires_in_days=30)
    listed = await client.api_keys.list()
    assert created["key_id"] == "k-1"
    assert listed[0]["name"] == "ci"


@respx.mock
async def test_usage_balance(client: CopassClient) -> None:
    respx.get("http://test/api/v1/usage/credits").mock(
        return_value=httpx.Response(
            200,
            json={"credits_remaining": 100, "credits_used": 50, "credits_total": 150},
        )
    )
    balance = await client.usage.get_balance()
    assert balance["credits_remaining"] == 100
