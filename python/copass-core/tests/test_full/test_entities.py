"""Wire-level mock tests for ``CopassClient.entities``.

The SDK only exposes sandbox-scoped entity-name search. Raw ontology
endpoints (``/users/me/canonical-entities``, perspective trees, behavior
listings) are intentionally not surfaced through the public client.
"""

from __future__ import annotations

import httpx
import respx

from copass_core import CopassClient


@respx.mock
async def test_search_passes_query_params(client: CopassClient) -> None:
    """``q`` is keyword-only; passed as the ``q`` query param.

    Backend returns ``{results, count, query, record_type, sandbox_id, project_id}``
    — the SDK strips the ``results`` envelope and returns the bare list.
    """
    route = respx.get(
        "http://test/api/v1/storage/sandboxes/sb-1/entities/search"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    {"canonical_id": "c-1", "name": "Stripe", "similarity": 0.91},
                    {"canonical_id": "c-2", "name": "Stripe Webhook", "similarity": 0.88},
                ],
                "count": 2,
                "query": "stripe",
                "record_type": "entity",
                "sandbox_id": "sb-1",
                "project_id": None,
            },
        )
    )
    resp = await client.entities.search(sandbox_id="sb-1", q="stripe", limit=5)
    params = route.calls.last.request.url.params
    assert params.get("q") == "stripe"
    assert params.get("limit") == "5"
    assert isinstance(resp, list)
    assert len(resp) == 2
    assert resp[0]["canonical_id"] == "c-1"
    assert resp[0]["similarity"] == 0.91
