"""Wire-level mock tests for ``CopassClient.vault``."""

from __future__ import annotations

import urllib.parse

import httpx
import respx

from copass_core import CopassClient

_BASE = "http://test/api/v1/storage/sandboxes/sb-1/vault"


@respx.mock
async def test_store_puts_raw_bytes(client: CopassClient) -> None:
    """Vault.store sends raw bytes (not JSON) via PUT to the encoded key."""
    encoded = urllib.parse.quote("copass/agent/fixture", safe="")
    route = respx.put(f"{_BASE}/{encoded}").mock(
        return_value=httpx.Response(200, json={"key": "copass/agent/fixture", "stored": True})
    )
    await client.vault.store(
        sandbox_id="sb-1",
        key="copass/agent/fixture",
        data=b"raw-bytes-payload",
    )
    assert route.called
    # Verify Content-Type header was set (defaults to application/octet-stream)
    headers = route.calls.last.request.headers
    assert "octet-stream" in headers["content-type"]


@respx.mock
async def test_retrieve_returns_raw_bytes(client: CopassClient) -> None:
    encoded = urllib.parse.quote("k1", safe="")
    respx.get(f"{_BASE}/{encoded}").mock(
        return_value=httpx.Response(200, content=b"binary-content")
    )
    resp = await client.vault.retrieve(sandbox_id="sb-1", key="k1")
    assert resp == b"binary-content"


@respx.mock
async def test_delete(client: CopassClient) -> None:
    encoded = urllib.parse.quote("k1", safe="")
    route = respx.delete(f"{_BASE}/{encoded}").mock(
        return_value=httpx.Response(200, json={"deleted": True})
    )
    await client.vault.delete(sandbox_id="sb-1", key="k1")
    assert route.called


@respx.mock
async def test_list_passes_prefix(client: CopassClient) -> None:
    route = respx.get(_BASE).mock(
        return_value=httpx.Response(200, json={"keys": ["copass/a", "copass/b"], "count": 2})
    )
    await client.vault.list(sandbox_id="sb-1", prefix="copass/")
    params = route.calls.last.request.url.params
    assert params.get("prefix") == "copass/"
