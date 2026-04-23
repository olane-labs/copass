"""Auth provider contracts."""

from __future__ import annotations

import pytest

from copass_core import (
    ApiKeyAuthProvider,
    AuthProvider,
    BearerAuthProvider,
    SessionContext,
)


async def test_api_key_provider_returns_session_context() -> None:
    p = ApiKeyAuthProvider(key="olk_fake_1234567890")
    s = await p.get_session()
    assert isinstance(s, SessionContext)
    assert s.access_token == "olk_fake_1234567890"
    assert s.session_token is None


def test_api_key_rejects_empty_key() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        ApiKeyAuthProvider(key="")


async def test_bearer_provider_returns_session_context() -> None:
    p = BearerAuthProvider(token="eyJfake")
    s = await p.get_session()
    assert s.access_token == "eyJfake"
    assert s.session_token is None  # crypto deferred in v0.1.0


def test_bearer_rejects_empty_token() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        BearerAuthProvider(token="")


def test_provider_protocol_structural() -> None:
    class MyProvider:
        async def get_session(self) -> SessionContext:
            return SessionContext(access_token="x")

    assert isinstance(MyProvider(), AuthProvider)
