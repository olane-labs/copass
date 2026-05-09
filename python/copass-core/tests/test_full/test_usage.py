"""Wire-level mock tests for ``CopassClient.usage``.

Mirrors the real backend (``frame_graph/api/routers/usage.py``):
- ``GET /api/v1/usage`` returns ``UsageResponse`` (summary + by_model[] + by_call_type[])
- ``GET /api/v1/usage/balance`` returns ``TokenBalanceResponse``
  (credits_purchased / credits_used / credits_remaining / currency).
"""

from __future__ import annotations

import httpx
import respx

from copass_core import CopassClient


@respx.mock
async def test_get_summary(client: CopassClient) -> None:
    respx.get("http://test/api/v1/usage").mock(
        return_value=httpx.Response(
            200,
            json={
                "summary": {
                    "total_prompt_tokens": 10000,
                    "total_completion_tokens": 2345,
                    "total_tokens": 12345,
                    "total_cost_usd": 1.23,
                    "total_calls": 7,
                },
                "by_model": [],
                "by_call_type": [],
                "start_date": None,
                "end_date": None,
            },
        )
    )
    resp = await client.usage.get_summary()
    assert resp["summary"]["total_tokens"] == 12345
    assert resp["summary"]["total_cost_usd"] == 1.23


@respx.mock
async def test_get_balance(client: CopassClient) -> None:
    respx.get("http://test/api/v1/usage/balance").mock(
        return_value=httpx.Response(
            200,
            json={
                "credits_purchased": 1_000_000,
                "credits_used": 500_000,
                "credits_remaining": 500_000,
                "currency": "USD_microcents",
            },
        )
    )
    resp = await client.usage.get_balance()
    assert resp["credits_remaining"] == 500_000
    assert resp["currency"] == "USD_microcents"
