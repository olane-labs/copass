"""retry_with_backoff semantics."""

from __future__ import annotations

import asyncio

import pytest

from copass_core import CopassNetworkError, RetryConfig, retry_with_backoff


async def test_succeeds_on_first_try() -> None:
    calls = 0

    async def fn():
        nonlocal calls
        calls += 1
        return "ok"

    result = await retry_with_backoff(fn)
    assert result == "ok"
    assert calls == 1


async def test_retries_on_retryable_500() -> None:
    calls = 0

    async def fn():
        nonlocal calls
        calls += 1
        if calls < 3:
            raise RuntimeError("API request failed: 503 Service Unavailable")
        return "recovered"

    result = await retry_with_backoff(
        fn, RetryConfig(max_attempts=3, backoff_base_ms=1)
    )
    assert result == "recovered"
    assert calls == 3


async def test_exhausts_retries_then_raises() -> None:
    async def fn():
        raise RuntimeError("500 Server Error")

    with pytest.raises(RuntimeError, match="500"):
        await retry_with_backoff(
            fn, RetryConfig(max_attempts=2, backoff_base_ms=1)
        )


async def test_wraps_network_errors_on_final_attempt() -> None:
    async def fn():
        raise RuntimeError("fetch failed: connection refused")

    with pytest.raises(CopassNetworkError, match="Network request failed"):
        await retry_with_backoff(
            fn, RetryConfig(max_attempts=1, backoff_base_ms=1)
        )


async def test_non_retryable_400_raises_immediately() -> None:
    calls = 0

    async def fn():
        nonlocal calls
        calls += 1
        raise RuntimeError("API request failed: 400 Bad Request")

    with pytest.raises(RuntimeError, match="400"):
        await retry_with_backoff(fn, RetryConfig(max_attempts=3, backoff_base_ms=1))
    assert calls == 1
