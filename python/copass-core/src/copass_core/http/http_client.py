"""Internal async HTTP client for the Copass API.

Port of ``typescript/packages/core/src/http/http-client.ts`` with the
v0.1.0 scope trimmed:

- No encrypted-payload path (crypto module deferred).
- No file-upload path (single consumer today is retrieval; can be
  added when ingest lands).
- Middleware hooks supported — mirror the TS ``onRequest`` /
  ``onResponse`` signatures so telemetry-hook patterns transfer.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union

import httpx

from copass_core.auth.types import AuthProvider
from copass_core.http.errors import CopassApiError
from copass_core.http.retry import retry_with_backoff
from copass_core.types import RetryConfig


@dataclass
class RequestContext:
    """Metadata about a request, passed to middleware."""

    method: str
    path: str
    url: str
    headers: Dict[str, str]
    body: Optional[str] = None


@dataclass
class ResponseContext:
    """Metadata about a completed response, passed to middleware."""

    request: RequestContext
    status: int
    duration_ms: int


RequestMiddleware = Callable[[RequestContext], Union[None, Awaitable[None]]]
"""Middleware invoked before each request. May mutate the
:class:`RequestContext` (headers, body)."""

ResponseMiddleware = Callable[[ResponseContext], Union[None, Awaitable[None]]]
"""Middleware invoked after each successful response."""


@dataclass(frozen=True)
class HttpClientOptions:
    api_url: str
    auth_provider: AuthProvider
    retry: Optional[RetryConfig] = None
    on_request: List[RequestMiddleware] = field(default_factory=list)
    on_response: List[ResponseMiddleware] = field(default_factory=list)
    timeout: float = 30.0


@dataclass(frozen=True)
class RequestOptions:
    method: str = "GET"
    body: Any = None
    query: Optional[Dict[str, Optional[str]]] = None
    headers: Optional[Dict[str, str]] = None
    raw_body: Optional[bytes] = None
    """Raw bytes body. When set, ``body`` is ignored and the caller
    is responsible for setting ``headers['Content-Type']`` (defaults
    to ``application/octet-stream`` if unset)."""
    raw_response: bool = False
    """When True, return ``response.content`` as bytes instead of
    parsing as JSON."""


class HttpClient:
    """Thin async wrapper around ``httpx.AsyncClient`` that handles
    auth-header injection, retry, error normalization, and middleware.

    A single client instance is safe to share across resources — each
    :meth:`request` opens its own short-lived ``httpx.AsyncClient`` so
    connection pooling is not attempted at this layer. (Add a shared
    ``AsyncClient`` in a later release if latency telemetry shows
    per-request handshake cost matters.)
    """

    def __init__(self, options: HttpClientOptions) -> None:
        self._api_url = options.api_url.rstrip("/")
        self._auth_provider = options.auth_provider
        self._retry_config = options.retry
        self._on_request = list(options.on_request or [])
        self._on_response = list(options.on_response or [])
        self._timeout = options.timeout

    async def request(self, path: str, options: Optional[RequestOptions] = None) -> Any:
        opts = options or RequestOptions()
        session = await self._auth_provider.get_session()

        headers: Dict[str, str] = {
            "Authorization": f"Bearer {session.access_token}",
            **(opts.headers or {}),
        }
        if "Content-Type" not in headers and "content-type" not in headers:
            headers["Content-Type"] = (
                "application/octet-stream" if opts.raw_body is not None else "application/json"
            )
        if session.session_token:
            headers["X-Encryption-Token"] = session.session_token

        body_text: Optional[str] = None
        body_bytes: Optional[bytes] = opts.raw_body
        if body_bytes is None and opts.body is not None:
            body_text = json.dumps(opts.body)

        url = self._api_url + path
        if opts.query:
            non_null = {k: v for k, v in opts.query.items() if v is not None}
            if non_null:
                url = f"{url}?{httpx.QueryParams(non_null)}"

        ctx = RequestContext(
            method=opts.method,
            path=path,
            url=url,
            headers=headers,
            body=body_text if body_bytes is None else "<binary>",
        )
        for mw in self._on_request:
            result = mw(ctx)
            if hasattr(result, "__await__"):
                await result  # type: ignore[misc]

        async def _do_request() -> Any:
            start = time.monotonic()
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.request(
                    method=ctx.method,
                    url=ctx.url,
                    headers=ctx.headers,
                    content=body_bytes if body_bytes is not None else body_text,
                )
            duration_ms = int((time.monotonic() - start) * 1000)

            if response.status_code >= 400:
                try:
                    error_body = response.json()
                except Exception:  # noqa: BLE001
                    error_body = response.text
                raise CopassApiError(
                    f"API request failed: {response.status_code} {response.reason_phrase}",
                    status=response.status_code,
                    body=error_body,
                    path=path,
                )

            for mw in self._on_response:
                result = mw(ResponseContext(request=ctx, status=response.status_code, duration_ms=duration_ms))
                if hasattr(result, "__await__"):
                    await result  # type: ignore[misc]

            if opts.raw_response:
                return response.content
            if response.status_code == 204 or not response.content:
                return None
            return response.json()

        return await retry_with_backoff(_do_request, self._retry_config)


__all__ = [
    "HttpClient",
    "HttpClientOptions",
    "RequestOptions",
    "RequestContext",
    "ResponseContext",
    "RequestMiddleware",
    "ResponseMiddleware",
]
