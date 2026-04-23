"""CopassClient — top-level entry point.

Hand-ported from ``typescript/packages/core/src/client.ts``. v0.2
ships the full resource surface (matching the TS package):

- ``sandboxes`` / ``sources`` / ``ingest`` / ``projects`` / ``entities``
- ``matrix`` / ``retrieval`` / ``context``
- ``vault`` / ``users`` / ``api_keys`` / ``usage``
- ``context_window`` (builds on ``sources`` + ``ingest``)

Only the Supabase auth provider + crypto module remain deferred to a
future release.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Union

from copass_core.auth.api_key import ApiKeyAuthProvider
from copass_core.auth.bearer import BearerAuthProvider
from copass_core.auth.types import AuthProvider
from copass_core.context_window import ContextWindowResource
from copass_core.http.http_client import (
    HttpClient,
    HttpClientOptions,
    RequestMiddleware,
    ResponseMiddleware,
)
from copass_core.resources.api_keys import ApiKeysResource
from copass_core.resources.context import ContextResource
from copass_core.resources.entities import EntitiesResource
from copass_core.resources.ingest import IngestResource
from copass_core.resources.matrix import MatrixResource
from copass_core.resources.projects import ProjectsResource
from copass_core.resources.retrieval import RetrievalResource
from copass_core.resources.sandboxes import SandboxesResource
from copass_core.resources.sources import SourcesResource
from copass_core.resources.usage import UsageResource
from copass_core.resources.users import UsersResource
from copass_core.resources.vault import VaultResource
from copass_core.types import RetryConfig


DEFAULT_API_URL = "https://ai.copass.id"


@dataclass(frozen=True)
class ApiKeyAuth:
    """``auth=ApiKeyAuth(key="olk_...")``."""

    key: str


@dataclass(frozen=True)
class BearerAuth:
    """``auth=BearerAuth(token="eyJ...")``. Caller owns refresh."""

    token: str
    encryption_key: Optional[str] = None


@dataclass(frozen=True)
class ProviderAuth:
    """``auth=ProviderAuth(provider=MyCustomAuthProvider(...))``."""

    provider: AuthProvider


AuthConfig = Union[ApiKeyAuth, BearerAuth, ProviderAuth]


def _build_auth_provider(auth: AuthConfig) -> AuthProvider:
    if isinstance(auth, ApiKeyAuth):
        return ApiKeyAuthProvider(auth.key)
    if isinstance(auth, BearerAuth):
        return BearerAuthProvider(auth.token, auth.encryption_key)
    if isinstance(auth, ProviderAuth):
        return auth.provider
    raise TypeError(f"Unsupported AuthConfig type: {type(auth).__name__}")


class CopassClient:
    """Main entry point for the Copass Python SDK.

    Resources are accessed as instance attributes (Stripe-style).

    Example::

        client = CopassClient(auth=ApiKeyAuth(key="olk_..."))
        menu = await client.retrieval.discover(
            sandbox_id="sb_...",
            query="How does auth work?",
        )
        sandbox = await client.sandboxes.retrieve("sb_...")
        window = await client.context_window.create(sandbox_id="sb_...")
    """

    # Narrow retrieval
    retrieval: RetrievalResource
    context: ContextResource

    # Storage layer
    sandboxes: SandboxesResource
    sources: SourcesResource
    ingest: IngestResource
    projects: ProjectsResource
    vault: VaultResource

    # Knowledge graph
    entities: EntitiesResource
    matrix: MatrixResource

    # Account
    users: UsersResource
    api_keys: ApiKeysResource
    usage: UsageResource

    # Higher-order primitive (builds on sources + ingest)
    context_window: ContextWindowResource

    def __init__(
        self,
        *,
        auth: AuthConfig,
        api_url: str = DEFAULT_API_URL,
        retry: Optional[RetryConfig] = None,
        on_request: Optional[List[RequestMiddleware]] = None,
        on_response: Optional[List[ResponseMiddleware]] = None,
        timeout: float = 30.0,
    ) -> None:
        auth_provider = _build_auth_provider(auth)
        http = HttpClient(
            HttpClientOptions(
                api_url=api_url,
                auth_provider=auth_provider,
                retry=retry,
                on_request=list(on_request or []),
                on_response=list(on_response or []),
                timeout=timeout,
            )
        )
        self._http = http

        # Narrow
        self.retrieval = RetrievalResource(http)
        self.context = ContextResource(http)

        # Storage
        self.sandboxes = SandboxesResource(http)
        self.sources = SourcesResource(http)
        self.ingest = IngestResource(http)
        self.projects = ProjectsResource(http)
        self.vault = VaultResource(http)

        # Knowledge graph
        self.entities = EntitiesResource(http)
        self.matrix = MatrixResource(http)

        # Account
        self.users = UsersResource(http)
        self.api_keys = ApiKeysResource(http)
        self.usage = UsageResource(http)

        # Higher-order — depends on sources + ingest, init last.
        self.context_window = ContextWindowResource(self)


__all__ = [
    "CopassClient",
    "AuthConfig",
    "ApiKeyAuth",
    "BearerAuth",
    "ProviderAuth",
    "DEFAULT_API_URL",
]
