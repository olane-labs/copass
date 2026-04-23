"""ContextWindow + BaseDataSource tests.

The ContextWindow primitive composes three API calls (register source
→ ingest turn → retrieval). We test the composition shape here; the
underlying resources have their own wire tests.
"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from copass_core import (
    ApiKeyAuth,
    BaseDataSource,
    ChatMessage,
    ContextWindow,
    CopassClient,
    ensure_data_source,
)


@pytest.fixture
def client() -> CopassClient:
    return CopassClient(auth=ApiKeyAuth(key="olk_test"), api_url="http://test")


@respx.mock
async def test_context_window_create_registers_ephemeral_source(
    client: CopassClient,
) -> None:
    route = respx.post("http://test/api/v1/storage/sandboxes/sb-1/sources").mock(
        return_value=httpx.Response(
            200,
            json={
                "data_source_id": "ds-1",
                "user_id": "u",
                "sandbox_id": "sb-1",
                "provider": "custom",
                "name": "window-abc",
                "ingestion_mode": "manual",
                "status": "active",
                "adapter_config": {},
                "kind": "ephemeral",
            },
        )
    )
    window = await client.context_window.create(
        sandbox_id="sb-1", name="window-abc"
    )
    assert isinstance(window, ContextWindow)
    assert window.sandbox_id == "sb-1"
    assert window.data_source_id == "ds-1"
    body = json.loads(route.calls.last.request.content)
    assert body["kind"] == "ephemeral"
    assert body["ingestion_mode"] == "manual"
    assert body["provider"] == "custom"
    assert body["name"] == "window-abc"


@respx.mock
async def test_context_window_add_turn_pushes_through_source(
    client: CopassClient,
) -> None:
    # 1) register source
    respx.post("http://test/api/v1/storage/sandboxes/sb-1/sources").mock(
        return_value=httpx.Response(
            200,
            json={
                "data_source_id": "ds-1",
                "user_id": "u",
                "sandbox_id": "sb-1",
                "provider": "custom",
                "name": "w",
                "ingestion_mode": "manual",
                "status": "active",
                "adapter_config": {},
            },
        )
    )
    # 2) ingest — single endpoint for both turns
    ingest_route = respx.post("http://test/api/v1/storage/sandboxes/sb-1/ingest").mock(
        return_value=httpx.Response(
            200,
            json={
                "job_id": "j",
                "status": "queued",
                "encrypted": False,
                "sandbox_id": "sb-1",
                "status_url": "/",
            },
        )
    )

    window = await client.context_window.create(sandbox_id="sb-1")
    await window.add_turn(ChatMessage(role="user", content="hello"))
    await window.add_turn(ChatMessage(role="assistant", content="hi!"))

    assert ingest_route.call_count == 2
    first_body = json.loads(ingest_route.calls[0].request.content)
    second_body = json.loads(ingest_route.calls[1].request.content)
    assert first_body["text"] == "user: hello"
    assert first_body["data_source_id"] == "ds-1"
    assert first_body["source_type"] == "conversation"
    assert second_body["text"] == "assistant: hi!"

    turns = window.get_turns()
    assert [(t.role, t.content) for t in turns] == [
        ("user", "hello"),
        ("assistant", "hi!"),
    ]


@respx.mock
async def test_context_window_attaches_to_existing_source(client: CopassClient) -> None:
    respx.get("http://test/api/v1/storage/sandboxes/sb-1/sources/ds-42").mock(
        return_value=httpx.Response(
            200,
            json={
                "data_source_id": "ds-42",
                "user_id": "u",
                "sandbox_id": "sb-1",
                "provider": "custom",
                "name": "prior-window",
                "ingestion_mode": "manual",
                "status": "active",
                "adapter_config": {},
            },
        )
    )
    prior = [
        ChatMessage(role="user", content="earlier"),
        ChatMessage(role="assistant", content="yep"),
    ]
    window = await client.context_window.attach(
        sandbox_id="sb-1", data_source_id="ds-42", initial_turns=prior
    )
    assert window.data_source_id == "ds-42"
    assert [t.content for t in window.get_turns()] == ["earlier", "yep"]


@respx.mock
async def test_ensure_data_source_reuses_match(client: CopassClient) -> None:
    list_route = respx.get(
        "http://test/api/v1/storage/sandboxes/sb-1/sources"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "sources": [
                    {
                        "data_source_id": "ds-existing",
                        "user_id": "u",
                        "sandbox_id": "sb-1",
                        "provider": "slack",
                        "name": "my-slack",
                        "ingestion_mode": "manual",
                        "status": "active",
                        "adapter_config": {},
                    }
                ],
                "count": 1,
            },
        )
    )
    register_route = respx.post(
        "http://test/api/v1/storage/sandboxes/sb-1/sources"
    ).mock(return_value=httpx.Response(500, json={}))  # should NOT be called

    source = await ensure_data_source(
        client, "sb-1", provider="slack", name="my-slack"
    )
    assert source["data_source_id"] == "ds-existing"
    assert list_route.called
    assert not register_route.called


@respx.mock
async def test_ensure_data_source_registers_when_no_match(client: CopassClient) -> None:
    respx.get("http://test/api/v1/storage/sandboxes/sb-1/sources").mock(
        return_value=httpx.Response(200, json={"sources": [], "count": 0})
    )
    register_route = respx.post(
        "http://test/api/v1/storage/sandboxes/sb-1/sources"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "data_source_id": "ds-new",
                "user_id": "u",
                "sandbox_id": "sb-1",
                "provider": "slack",
                "name": "my-slack",
                "ingestion_mode": "manual",
                "status": "active",
                "adapter_config": {},
            },
        )
    )
    source = await ensure_data_source(
        client, "sb-1", provider="slack", name="my-slack"
    )
    assert source["data_source_id"] == "ds-new"
    assert register_route.called


class _TestDriver(BaseDataSource):
    """Concrete subclass used to exercise the base primitive's
    lifecycle pass-throughs."""


@respx.mock
async def test_base_data_source_pause_resume_disconnect(client: CopassClient) -> None:
    pause = respx.post(
        "http://test/api/v1/storage/sandboxes/sb-1/sources/ds-1/pause"
    ).mock(return_value=httpx.Response(200, json={"success": True}))
    resume = respx.post(
        "http://test/api/v1/storage/sandboxes/sb-1/sources/ds-1/resume"
    ).mock(return_value=httpx.Response(200, json={"success": True}))
    disconnect = respx.post(
        "http://test/api/v1/storage/sandboxes/sb-1/sources/ds-1/disconnect"
    ).mock(return_value=httpx.Response(200, json={"success": True}))

    driver = _TestDriver(
        client=client, sandbox_id="sb-1", data_source_id="ds-1"
    )
    await driver.pause()
    await driver.resume()
    await driver.disconnect()
    assert pause.called and resume.called and disconnect.called


def test_base_data_source_rejects_missing_ids(client: CopassClient) -> None:
    with pytest.raises(ValueError, match="sandbox_id is required"):
        _TestDriver(client=client, sandbox_id="", data_source_id="ds-1")
    with pytest.raises(ValueError, match="data_source_id is required"):
        _TestDriver(client=client, sandbox_id="sb-1", data_source_id="")
