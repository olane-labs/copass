"""HTTP error types.

Hand-ported from ``typescript/packages/core/src/http/errors.ts``.
"""

from __future__ import annotations

from typing import Any, List, Optional


class CopassApiError(Exception):
    """Raised when the Copass API returns a non-2xx response.

    Attributes:
        status: HTTP status code.
        body: Parsed JSON body (if parseable) or raw response text.
        path: Request path that failed.
    """

    def __init__(
        self,
        message: str,
        status: int,
        body: Any = None,
        path: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.body = body
        self.path = path


class CopassNetworkError(Exception):
    """Raised on network-level failures (DNS, timeout, connection
    refused). Caller should retry at a higher level or surface to the
    end user."""

    def __init__(self, message: str, cause: Optional[BaseException] = None) -> None:
        super().__init__(message)
        self.cause = cause


class CopassValidationError(Exception):
    """Raised for client-side validation failures before the request
    leaves the SDK (e.g., missing required parameter).

    Attributes:
        fields: The field name(s) that failed validation.
    """

    def __init__(self, message: str, fields: Optional[List[str]] = None) -> None:
        super().__init__(message)
        self.fields = fields or []


__all__ = [
    "CopassApiError",
    "CopassNetworkError",
    "CopassValidationError",
]
