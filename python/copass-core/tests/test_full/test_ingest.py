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


# ─── ADR 0022: speaker / participants / source_type round-trip ─────────


@respx.mock
async def test_text_forwards_speaker(client: CopassClient) -> None:
    route = respx.post(_SHORTHAND).mock(
        return_value=httpx.Response(200, json={"job_id": "j-1", "status": "queued"})
    )
    await client.ingest.text(
        text="I just ran 5km in the Spring Run.",
        source_type="conversation",
        speaker="User",
    )
    body = json.loads(route.calls.last.request.content)
    assert body["speaker"] == "User"
    assert body["source_type"] == "conversation"
    assert "participants" not in body


@respx.mock
async def test_text_forwards_participants(client: CopassClient) -> None:
    route = respx.post(_SHORTHAND).mock(
        return_value=httpx.Response(200, json={"job_id": "j-1", "status": "queued"})
    )
    await client.ingest.text(
        text="Hey Alice, did you finish the report?",
        source_type="conversation",
        speaker="Bob",
        participants=["Alice", "Bob"],
    )
    body = json.loads(route.calls.last.request.content)
    assert body["speaker"] == "Bob"
    assert body["participants"] == ["Alice", "Bob"]


@respx.mock
async def test_text_omits_when_not_provided(client: CopassClient) -> None:
    """Legacy caller — payload is unchanged from pre-ADR-0022 shape."""
    route = respx.post(_SHORTHAND).mock(
        return_value=httpx.Response(200, json={"job_id": "j-1", "status": "queued"})
    )
    await client.ingest.text(text="A doc snippet.", source_type="text")
    body = json.loads(route.calls.last.request.content)
    assert "speaker" not in body
    assert "participants" not in body


@respx.mock
async def test_source_type_accepts_artifact_kind(client: CopassClient) -> None:
    """source_type widens to artifact-kind tokens (`ticket`, `email`, …)."""
    route = respx.post(_SHORTHAND).mock(
        return_value=httpx.Response(200, json={"job_id": "j-1", "status": "queued"})
    )
    await client.ingest.text(text="Issue body", source_type="ticket")
    body = json.loads(route.calls.last.request.content)
    assert body["source_type"] == "ticket"


@respx.mock
async def test_text_in_sandbox_forwards_metadata(client: CopassClient) -> None:
    route = respx.post("http://test/api/v1/storage/sandboxes/sb-1/ingest").mock(
        return_value=httpx.Response(200, json={"job_id": "j-2", "status": "queued"})
    )
    await client.ingest.text_in_sandbox(
        sandbox_id="sb-1",
        text="payload",
        speaker="Assistant",
        participants=["User", "Assistant"],
    )
    body = json.loads(route.calls.last.request.content)
    assert body["speaker"] == "Assistant"
    assert body["participants"] == ["User", "Assistant"]
