"""Wire-level mock tests for ``CopassClient.usage``."""

from __future__ import annotations

import httpx
import respx

from copass_core import CopassClient


@respx.mock
async def test_get_summary(client: CopassClient) -> None:
    respx.get("http://test/api/v1/usage").mock(
        return_value=httpx.Response(
            200,
            json={"period": "2026-05", "tokens_used": 12345, "credits_consumed": 1.23},
        )
    )
    resp = await client.usage.get_summary()
    assert resp["tokens_used"] == 12345


@respx.mock
async def test_get_balance(client: CopassClient) -> None:
    respx.get("http://test/api/v1/usage/credits").mock(
        return_value=httpx.Response(
            200,
            json={"balance_credits": 100.5, "low_balance": False},
        )
    )
    resp = await client.usage.get_balance()
    assert resp["balance_credits"] == 100.5
