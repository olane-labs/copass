"""Retry helper with configurable backoff.

Hand-ported from ``typescript/packages/core/src/http/retry.ts``.
"""

from __future__ import annotations

import asyncio
import re
from typing import Awaitable, Callable, Optional, TypeVar

from copass_core.http.errors import CopassNetworkError
from copass_core.types import RetryConfig

T = TypeVar("T")


_RETRYABLE_PATTERN = re.compile(
    r"5\d{2}|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch failed|connection",
    re.IGNORECASE,
)
_NETWORK_ERROR_PATTERN = re.compile(
    r"fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|connection",
    re.IGNORECASE,
)


def _compute_delay_ms(attempt: int, strategy: str, base_ms: int) -> int:
    """Compute the delay for ``attempt`` (0-indexed)."""
    if strategy == "exponential":
        return (2**attempt) * base_ms
    if strategy == "linear":
        return (attempt + 1) * base_ms
    # fixed
    return base_ms


async def retry_with_backoff(
    fn: Callable[[], Awaitable[T]],
    config: Optional[RetryConfig] = None,
) -> T:
    """Run ``fn`` with retry on transient failures.

    Only retryable errors (5xx status messages, common network error
    tokens) trigger a retry. Non-retryable failures bubble up
    immediately. Network-level failures are wrapped in
    :class:`CopassNetworkError` before raising.
    """
    cfg = config or RetryConfig()
    last_error: Optional[BaseException] = None

    for attempt in range(cfg.max_attempts):
        try:
            return await fn()
        except BaseException as error:  # noqa: BLE001 — we re-classify below
            last_error = error
            message = str(error)
            is_retryable = bool(_RETRYABLE_PATTERN.search(message))

            if not is_retryable or attempt == cfg.max_attempts - 1:
                if _NETWORK_ERROR_PATTERN.search(message):
                    raise CopassNetworkError(
                        "Network request failed — check your internet "
                        "connection and try again",
                        cause=error if isinstance(error, Exception) else None,
                    ) from error
                raise

            delay_ms = _compute_delay_ms(attempt, cfg.backoff_strategy, cfg.backoff_base_ms)
            await asyncio.sleep(delay_ms / 1000)

    # Unreachable — max_attempts >= 1.
    assert last_error is not None
    raise last_error


__all__ = ["retry_with_backoff"]
