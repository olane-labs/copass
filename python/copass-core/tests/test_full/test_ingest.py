"""Wire-level mock tests for ``CopassClient.ingest``."""

from __future__ import annotations

import json

import httpx
import respx

from copass_core import CopassClient

_SHORTHAND = "http://test/api/v1/storage/ingest"


@respx.mock
async def test_text_shorthand(client: CopassClient) -> None:
    """Shorthand ``text(...)`` posts to /api/v1/storage/ingest."""
    route = respx.post(_SHORTHAND).mock(
        return_value=httpx.Response(200, json={"job_id": "j-1", "status": "queued"})
    )
    resp = await client.ingest.text(text="hello world", data_source_id="ds-1")
    assert resp["job_id"] == "j-1"
    body = json.loads(route.calls.last.request.content)
    assert body["text"] == "hello world"
    assert body["data_source_id"] == "ds-1"


@respx.mock
async def test_get_job(client: CopassClient) -> None:
    respx.get(f"{_SHORTHAND}/j-1").mock(
        return_value=httpx.Response(200, json={"job_id": "j-1", "status": "completed"})
    )
    resp = await client.ingest.get_job("j-1")
    assert resp["status"] == "completed"


@respx.mock
async def test_text_in_sandbox_explicit(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/storage/sandboxes/sb-1/ingest").mock(
        return_value=httpx.Response(200, json={"job_id": "j-2", "status": "queued"})
    )
    resp = await client.ingest.text_in_sandbox(
        sandbox_id="sb-1", text="data", data_source_id="ds-2",
    )
    assert resp["job_id"] == "j-2"
    body = json.loads(route.calls.last.request.content)
    assert body["text"] == "data"


@respx.mock
async def test_get_sandbox_job(client: CopassClient) -> None:
    respx.get("http://test/api/v1/storage/sandboxes/sb-1/ingest/j-2").mock(
        return_value=httpx.Response(200, json={"job_id": "j-2", "status": "running"})
    )
    resp = await client.ingest.get_sandbox_job(sandbox_id="sb-1", job_id="j-2")
    assert resp["status"] == "running"
