"""Wire-level mock tests for ``CopassClient.vault``.

Mocks mirror the real backend (``frame_graph/copass_id/api/vault.py``):
- ``store`` returns ``VaultStoreResponse {key, full_key, size_bytes, encrypted, ...}``
- ``delete`` returns ``StatusResponse {success, message}``
- The SDK preserves literal ``/`` in keys (segment-encoded), so the
  request URL keeps slashes literal — the mock asserts on that path.
"""

from __future__ import annotations

import httpx
import respx

from copass_core import CopassClient

_BASE = "http://test/api/v1/storage/sandboxes/sb-1/vault"


@respx.mock
async def test_store_puts_raw_bytes(client: CopassClient) -> None:
    """Vault.store sends raw bytes (not JSON) via PUT to the literal key path."""
    route = respx.put(f"{_BASE}/copass/agent/fixture").mock(
        return_value=httpx.Response(
            201,
            json={
                "key": "copass/agent/fixture",
                "full_key": "sandboxes/sb-1/vault/copass/agent/fixture",
                "size_bytes": 17,
                "encrypted": False,
            },
        )
    )
    resp = await client.vault.store(
        sandbox_id="sb-1",
        key="copass/agent/fixture",
        data=b"raw-bytes-payload",
    )
    assert route.called
    # Verify Content-Type header was set (defaults to application/octet-stream)
    headers = route.calls.last.request.headers
    assert "octet-stream" in headers["content-type"]
    assert resp["key"] == "copass/agent/fixture"
    assert resp["size_bytes"] == 17


@respx.mock
async def test_retrieve_returns_raw_bytes(client: CopassClient) -> None:
    respx.get(f"{_BASE}/k1").mock(
        return_value=httpx.Response(200, content=b"binary-content")
    )
    resp = await client.vault.retrieve(sandbox_id="sb-1", key="k1")
    assert resp == b"binary-content"


@respx.mock
async def test_delete(client: CopassClient) -> None:
    route = respx.delete(f"{_BASE}/k1").mock(
        return_value=httpx.Response(200, json={"success": True, "message": "deleted"})
    )
    resp = await client.vault.delete(sandbox_id="sb-1", key="k1")
    assert route.called
    assert resp["success"] is True


@respx.mock
async def test_list_passes_prefix(client: CopassClient) -> None:
    route = respx.get(_BASE).mock(
        return_value=httpx.Response(200, json={"keys": ["copass/a", "copass/b"], "count": 2})
    )
    await client.vault.list(sandbox_id="sb-1", prefix="copass/")
    params = route.calls.last.request.url.params
    assert params.get("prefix") == "copass/"
