"""Wire-level mock tests for ``CopassClient.entities``."""

from __future__ import annotations

import httpx
import respx

from copass_core import CopassClient


@respx.mock
async def test_list_unwraps_envelope(client: CopassClient) -> None:
    """List endpoint returns ``{"canonical_entities": [...]}`` — SDK
    strips the envelope and returns the bare list."""
    respx.get("http://test/api/v1/users/me/canonical-entities").mock(
        return_value=httpx.Response(
            200,
            json={"canonical_entities": [{"canonical_id": "c-1"}, {"canonical_id": "c-2"}]},
        )
    )
    resp = await client.entities.list()
    assert isinstance(resp, list)
    assert len(resp) == 2


@respx.mock
async def test_get_perspective(client: CopassClient) -> None:
    route = respx.get(
        "http://test/api/v1/users/me/canonical-entities/cid-abc/perspective"
    ).mock(
        return_value=httpx.Response(
            200,
            json={"canonical_id": "cid-abc", "tree": {"nodes": []}},
        )
    )
    resp = await client.entities.get_perspective("cid-abc")
    assert resp["canonical_id"] == "cid-abc"
    assert route.called


@respx.mock
async def test_search_passes_query_params(client: CopassClient) -> None:
    """``q`` is positional; passed as the ``q`` query param."""
    route = respx.get(
        "http://test/api/v1/storage/sandboxes/sb-1/entities/search"
    ).mock(
        return_value=httpx.Response(200, json=[])
    )
    await client.entities.search(sandbox_id="sb-1", q="stripe", limit=5)
    params = route.calls.last.request.url.params
    assert params.get("q") == "stripe"
    assert params.get("limit") == "5"
