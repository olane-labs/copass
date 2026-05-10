"""Wire-level mock tests for ``CopassClient.compute`` (ADR 0020 + ADR 0026).

Covers all seven ``/compute/*`` lifecycle endpoints plus the three
gateway-side helpers on :class:`ComputeSession` (``proxy_url`` /
``websocket_url`` / ``fetch``).
"""

from __future__ import annotations

import json
from typing import Any, Dict
from unittest.mock import AsyncMock

import httpx
import pytest
import respx

from copass_core import (
    ComputeGateway,
    ComputeSession,
    CopassClient,
)
from copass_core.resources.compute import GATEWAY_NOT_CONFIGURED


_BASE = "http://test/api/v1/storage/sandboxes/sb-1/compute"

_GATEWAY = {
    "base_url": "https://staging-gateway.copass.id",
    "url_template": "{base_url}/compute/{session_id}/p/{port}{path}",
    "kind": "edge-proxy-v1",
}


def _session_payload(*, with_gateway: bool = True, session_id: str = "cs-1") -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "session_id": session_id,
        "template": "copass-hermes-py311",
        "status": "running",
        "provisioned_at": "2026-05-09T00:00:00Z",
        "deadline_at": "2026-05-09T00:10:00Z",
        "last_activity_at": "2026-05-09T00:00:00Z",
        "metadata": {"k": "v"},
    }
    if with_gateway:
        payload["gateway"] = _GATEWAY
    return payload


# ─── ComputeResource — lifecycle ─────────────────────────────────────


@respx.mock
async def test_list_templates(client: CopassClient) -> None:
    route = respx.get(f"{_BASE}/templates").mock(
        return_value=httpx.Response(
            200,
            json={
                "templates": [
                    {
                        "name": "copass-hermes-py311",
                        "provider": "daytona",
                        "cpu_count": 2,
                        "memory_mb": 1024,
                        "description": "Hermes runtime, Python 3.11",
                    },
                ],
            },
        ),
    )
    resp = await client.compute.list_templates("sb-1", provider="daytona")
    assert route.called
    params = route.calls.last.request.url.params
    assert params.get("provider") == "daytona"
    assert len(resp.templates) == 1
    assert resp.templates[0].name == "copass-hermes-py311"
    assert resp.templates[0].cpu_count == 2


@respx.mock
async def test_create_session(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/sessions").mock(
        return_value=httpx.Response(200, json=_session_payload()),
    )
    session = await client.compute.create_session(
        "sb-1",
        template="copass-hermes-py311",
        timeout_seconds=600,
        env_vars={"FOO": "bar"},
        metadata={"k": "v"},
    )
    assert isinstance(session, ComputeSession)
    assert session.session_id == "cs-1"
    assert isinstance(session.gateway, ComputeGateway)
    assert session.gateway.base_url == "https://staging-gateway.copass.id"

    body = json.loads(route.calls.last.request.content)
    assert body == {
        "template": "copass-hermes-py311",
        "env_vars": {"FOO": "bar"},
        "timeout_seconds": 600,
        "metadata": {"k": "v"},
    }


@respx.mock
async def test_create_session_minimal(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/sessions").mock(
        return_value=httpx.Response(200, json=_session_payload(with_gateway=False)),
    )
    session = await client.compute.create_session("sb-1", template="copass-hermes-py311")
    assert isinstance(session, ComputeSession)
    assert session.gateway is None
    body = json.loads(route.calls.last.request.content)
    assert body == {"template": "copass-hermes-py311"}


@respx.mock
async def test_list_sessions(client: CopassClient) -> None:
    route = respx.get(f"{_BASE}/sessions").mock(
        return_value=httpx.Response(
            200,
            json={
                "sessions": [
                    _session_payload(session_id="cs-1"),
                    _session_payload(session_id="cs-2"),
                ],
            },
        ),
    )
    resp = await client.compute.list_sessions(
        "sb-1", include_stopped=True, limit=25,
    )
    params = route.calls.last.request.url.params
    assert params.get("include_stopped") == "true"
    assert params.get("limit") == "25"
    assert len(resp.sessions) == 2
    for s in resp.sessions:
        assert isinstance(s, ComputeSession)
    assert resp.sessions[0].session_id == "cs-1"
    assert resp.sessions[1].session_id == "cs-2"


@respx.mock
async def test_get_session(client: CopassClient) -> None:
    respx.get(f"{_BASE}/sessions/cs-1").mock(
        return_value=httpx.Response(200, json=_session_payload()),
    )
    session = await client.compute.get_session("sb-1", "cs-1")
    assert isinstance(session, ComputeSession)
    assert session.session_id == "cs-1"


@respx.mock
async def test_stop_session(client: CopassClient) -> None:
    route = respx.delete(f"{_BASE}/sessions/cs-1").mock(
        return_value=httpx.Response(200, json={"session_id": "cs-1", "status": "stopped"}),
    )
    resp = await client.compute.stop_session("sb-1", "cs-1")
    assert route.called
    assert resp.session_id == "cs-1"
    assert resp.status == "stopped"


@respx.mock
async def test_exec(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/sessions/cs-1/exec").mock(
        return_value=httpx.Response(
            200,
            json={
                "stdout": "hello\n",
                "stderr": "",
                "exit_code": 0,
                "elapsed_ms": 42,
                "truncated": False,
            },
        ),
    )
    resp = await client.compute.exec(
        "sb-1", "cs-1",
        cmd=["python", "-c", "print('hello')"],
        stdin="ignored",
        timeout_seconds=30,
    )
    body = json.loads(route.calls.last.request.content)
    assert body == {
        "cmd": ["python", "-c", "print('hello')"],
        "stdin": "ignored",
        "timeout_seconds": 30,
    }
    assert resp.stdout == "hello\n"
    assert resp.exit_code == 0


@respx.mock
async def test_session_health(client: CopassClient) -> None:
    respx.get(f"{_BASE}/sessions/cs-1/health").mock(
        return_value=httpx.Response(
            200,
            json={
                "session_id": "cs-1",
                "status": "ready",
                "last_activity_at": "2026-05-09T00:00:00Z",
            },
        ),
    )
    resp = await client.compute.session_health("sb-1", "cs-1")
    assert resp.session_id == "cs-1"
    assert resp.status == "ready"


# ─── ComputeSession — gateway helpers ────────────────────────────────


def _make_session(client: CopassClient, *, with_gateway: bool = True) -> ComputeSession:
    from copass_core.resources.compute import ComputeSessionResponse

    record = ComputeSessionResponse.from_dict(_session_payload(with_gateway=with_gateway))
    return ComputeSession(client._http, record)


def test_proxy_url_no_path(client: CopassClient) -> None:
    session = _make_session(client)
    url = session.proxy_url(3000, "")
    # url_template is `{base_url}/compute/{session_id}/p/{port}{path}` —
    # empty path means no trailing slash.
    assert url == "https://staging-gateway.copass.id/compute/cs-1/p/3000"


def test_proxy_url_with_path(client: CopassClient) -> None:
    session = _make_session(client)
    url = session.proxy_url(3000, "/api")
    assert url == "https://staging-gateway.copass.id/compute/cs-1/p/3000/api"


def test_proxy_url_default_path(client: CopassClient) -> None:
    """``path`` defaults to ``""`` — same as test_proxy_url_no_path."""
    session = _make_session(client)
    assert session.proxy_url(3000) == session.proxy_url(3000, "")


def test_websocket_url_https_to_wss(client: CopassClient) -> None:
    session = _make_session(client)
    ws = session.websocket_url(3000, "/ws")
    assert ws == "wss://staging-gateway.copass.id/compute/cs-1/p/3000/ws"


def test_websocket_url_http_to_ws(client: CopassClient) -> None:
    from copass_core.resources.compute import ComputeSessionResponse

    payload = _session_payload()
    payload["gateway"] = {
        **_GATEWAY,
        "base_url": "http://localhost:8080",
    }
    record = ComputeSessionResponse.from_dict(payload)
    session = ComputeSession(client._http, record)
    ws = session.websocket_url(3000)
    assert ws == "ws://localhost:8080/compute/cs-1/p/3000"


def test_absent_gateway_proxy_url_raises(client: CopassClient) -> None:
    session = _make_session(client, with_gateway=False)
    with pytest.raises(ValueError) as exc:
        session.proxy_url(3000, "")
    assert "Gateway is not configured" in str(exc.value)
    assert str(exc.value) == GATEWAY_NOT_CONFIGURED


def test_absent_gateway_websocket_url_raises(client: CopassClient) -> None:
    session = _make_session(client, with_gateway=False)
    with pytest.raises(ValueError) as exc:
        session.websocket_url(3000, "")
    assert str(exc.value) == GATEWAY_NOT_CONFIGURED


async def test_absent_gateway_fetch_raises(client: CopassClient) -> None:
    session = _make_session(client, with_gateway=False)
    with pytest.raises(ValueError) as exc:
        await session.fetch(3000, "/foo")
    assert str(exc.value) == GATEWAY_NOT_CONFIGURED


@respx.mock
async def test_fetch_passthrough(client: CopassClient) -> None:
    session = _make_session(client)
    expected_url = "https://staging-gateway.copass.id/compute/cs-1/p/3000/foo"
    route = respx.post(expected_url).mock(
        return_value=httpx.Response(201, json={"ok": True}),
    )
    resp = await session.fetch(
        3000, "/foo",
        method="POST",
        content=b"x",
        headers={"X-Custom": "yes"},
    )
    assert isinstance(resp, httpx.Response)
    assert resp.status_code == 201
    assert route.called
    sent = route.calls.last.request
    assert str(sent.url) == expected_url
    assert sent.headers.get("authorization") == "Bearer olk_test"
    assert sent.headers.get("x-custom") == "yes"
    assert sent.content == b"x"


@respx.mock
async def test_fetch_caller_cannot_override_authorization(client: CopassClient) -> None:
    """Bearer always wins on the ``Authorization`` key (per ADR 0026)."""
    session = _make_session(client)
    url = "https://staging-gateway.copass.id/compute/cs-1/p/3000/foo"
    route = respx.get(url).mock(return_value=httpx.Response(200, json={}))
    await session.fetch(
        3000, "/foo",
        headers={"Authorization": "Bearer attacker"},
    )
    sent = route.calls.last.request
    assert sent.headers.get("authorization") == "Bearer olk_test"


async def test_fetch_pulls_fresh_bearer(client: CopassClient) -> None:
    """``fetch`` MUST pull a fresh session per call — tokens rotate."""
    from copass_core.auth.types import SessionContext

    session = _make_session(client)
    spy = AsyncMock(side_effect=[
        SessionContext(access_token="t1"),
        SessionContext(access_token="t2"),
    ])
    # Patch the auth surface on the underlying client.
    client._http._auth_provider.get_session = spy  # type: ignore[method-assign]

    url = "https://staging-gateway.copass.id/compute/cs-1/p/3000"
    with respx.mock:
        respx.get(url).mock(return_value=httpx.Response(200, json={}))
        await session.fetch(3000, "")
        await session.fetch(3000, "")

    assert spy.await_count == 2
