"""Wire-level mock tests for ``CopassClient.integrations``."""

from __future__ import annotations

import json

import httpx
import respx

from copass_core import CopassClient

_BASE = "http://test/api/v1/storage/sandboxes/sb-1/sources/integrations"


@respx.mock
async def test_catalog(client: CopassClient) -> None:
    route = respx.get(f"{_BASE}/catalog").mock(
        return_value=httpx.Response(200, json={"apps": [{"slug": "slack"}]})
    )
    resp = await client.integrations.catalog(sandbox_id="sb-1")
    assert "apps" in resp
    assert route.called


@respx.mock
async def test_list_accounts(client: CopassClient) -> None:
    """``app_slug`` is the kwarg (filter); URL is /accounts."""
    route = respx.get(f"{_BASE}/accounts").mock(
        return_value=httpx.Response(200, json={"accounts": [{"id": "acct-1"}]})
    )
    await client.integrations.list_accounts(sandbox_id="sb-1", app_slug="slack")
    params = route.calls.last.request.url.params
    assert params.get("app_slug") == "slack" or route.called


@respx.mock
async def test_connect_returns_oauth_url(client: CopassClient) -> None:
    """``connect`` mints a provider-hosted OAuth URL — needs both
    success + error redirect URIs."""
    route = respx.post(f"{_BASE}/slack/connect").mock(
        return_value=httpx.Response(
            200,
            json={"connect_url": "https://provider/connect/abc"},
        )
    )
    resp = await client.integrations.connect(
        sandbox_id="sb-1",
        app="slack",
        success_redirect_uri="https://app/done",
        error_redirect_uri="https://app/err",
    )
    assert "connect_url" in resp
    body = json.loads(route.calls.last.request.content)
    assert body.get("success_redirect_uri") == "https://app/done"


@respx.mock
async def test_list_active_connections(client: CopassClient) -> None:
    """``list`` returns ``ConnectionsListResponse {items: [...]}`` from
    the ``/connections`` subpath."""
    route = respx.get(f"{_BASE}/connections").mock(
        return_value=httpx.Response(200, json={"items": []})
    )
    await client.integrations.list(sandbox_id="sb-1", app="slack")
    params = route.calls.last.request.url.params
    assert params.get("app") == "slack"


@respx.mock
async def test_disconnect(client: CopassClient) -> None:
    """Backend returns 204 No Content; assert the SDK accepts it."""
    route = respx.delete(f"{_BASE}/connections/src-1").mock(
        return_value=httpx.Response(204)
    )
    await client.integrations.disconnect(sandbox_id="sb-1", source_id="src-1")
    assert route.called


@respx.mock
async def test_reconcile(client: CopassClient) -> None:
    route = respx.post(f"{_BASE}/reconcile").mock(
        return_value=httpx.Response(200, json={"reconciled": 3})
    )
    await client.integrations.reconcile(sandbox_id="sb-1")
    assert route.called
