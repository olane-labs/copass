"""Bearer JWT auth provider.

Hand-ported from ``typescript/packages/core/src/auth/bearer.ts``. In
v0.1.0 the encryption-key path is deferred — the provider simply
forwards the caller-supplied JWT. A later release will add
``createSessionToken`` integration once the crypto module lands.
"""

from __future__ import annotations

from typing import Optional

from copass_core.auth.types import AuthProvider, SessionContext


class BearerAuthProvider:
    """Forwards a caller-managed JWT as the bearer token.

    The caller is responsible for refreshing the JWT when it expires —
    mint a new provider with the new token or wrap your own refresh
    logic in a custom :class:`AuthProvider` implementation.
    """

    def __init__(self, token: str, encryption_key: Optional[str] = None) -> None:
        if not token:
            raise ValueError("BearerAuthProvider requires a non-empty token")
        self._token = token
        # Stored but unused in v0.1.0 — reserved for the forthcoming
        # crypto module (session-token derivation for vault access).
        self._encryption_key = encryption_key

    async def get_session(self) -> SessionContext:
        return SessionContext(access_token=self._token)


__all__ = ["BearerAuthProvider"]
