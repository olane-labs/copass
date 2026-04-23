"""HTTP client primitives."""

from copass_core.http.errors import (
    CopassApiError,
    CopassNetworkError,
    CopassValidationError,
)
from copass_core.http.http_client import (
    HttpClient,
    HttpClientOptions,
    RequestContext,
    RequestMiddleware,
    RequestOptions,
    ResponseContext,
    ResponseMiddleware,
)
from copass_core.http.retry import retry_with_backoff

__all__ = [
    "HttpClient",
    "HttpClientOptions",
    "RequestOptions",
    "RequestContext",
    "ResponseContext",
    "RequestMiddleware",
    "ResponseMiddleware",
    "CopassApiError",
    "CopassNetworkError",
    "CopassValidationError",
    "retry_with_backoff",
]
