"""Authentication interfaces.

Hand-ported from ``typescript/packages/core/src/auth/types.ts``. The
Python port drops the session-token / encryption fields that aren't
needed by v0.1.0 consumers; add them back when the crypto module
lands in a later release.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol, runtime_checkable


@dataclass(frozen=True)
class SessionContext:
    """Active session context with resolved credentials.

    Attributes:
        access_token: The JWT or API key for the ``Authorization``
            header.
        session_token: Optional wrapped DEK for the
            ``X-Encryption-Token`` header. ``None`` in v0.1.0 — the
            crypto module is deferred.
        user_id: User id extracted from the token. ``None`` for API
            keys (not decoded).
    """

    access_token: str
    session_token: Optional[str] = None
    user_id: Optional[str] = None


@runtime_checkable
class AuthProvider(Protocol):
    """Structural contract for authentication providers.

    Each auth strategy (API key, bearer JWT, future Supabase) exposes
    :meth:`get_session`. The HTTP client calls it before each request
    to obtain fresh credentials; providers are free to cache + refresh
    under the hood.
    """

    async def get_session(self) -> SessionContext: ...


__all__ = ["AuthProvider", "SessionContext"]
