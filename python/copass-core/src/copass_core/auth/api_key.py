"""API key auth provider.

Hand-ported from ``typescript/packages/core/src/auth/api-key.ts``.
"""

from __future__ import annotations

from copass_core.auth.types import AuthProvider, SessionContext


class ApiKeyAuthProvider:
    """Sends a long-lived API key (``olk_...``) as a bearer token.

    No session token; API keys don't support DEK wrapping in this
    release.
    """

    def __init__(self, key: str) -> None:
        if not key:
            raise ValueError("ApiKeyAuthProvider requires a non-empty key")
        self._key = key

    async def get_session(self) -> SessionContext:
        return SessionContext(access_token=self._key)


__all__ = ["ApiKeyAuthProvider"]
