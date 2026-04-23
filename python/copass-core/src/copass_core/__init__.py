"""Copass Python client SDK.

Python mirror of `@copass/core`_. v0.2 ships the full resource
surface matching the TS package, plus the ``ContextWindow`` /
``BaseDataSource`` primitives:

- ``CopassClient`` top-level entry point
- Auth: ``ApiKeyAuthProvider``, ``BearerAuthProvider``
- ``HttpClient`` with retry + middleware + raw body / raw response
- Resources: ``retrieval``, ``context``, ``sandboxes``, ``sources``,
  ``ingest``, ``projects``, ``entities``, ``matrix``, ``vault``,
  ``users``, ``api_keys``, ``usage``
- Higher-order: ``context_window`` (ephemeral data source wrapping
  agent conversations), ``BaseDataSource`` + ``ensure_data_source``
  for custom driver subclasses

Deferred to v0.3: Supabase OTP auth + crypto module (HKDF,
AES-GCM, session tokens, DEK — needed for ``BearerAuth(encryption_key=...)``
to actually generate a wrapped DEK).

.. _`@copass/core`: https://github.com/olane-labs/copass-harness/tree/main/typescript/packages/core
"""

from copass_core.auth import (
    ApiKeyAuthProvider,
    AuthProvider,
    BearerAuthProvider,
    SessionContext,
)
from copass_core.client import (
    DEFAULT_API_URL,
    ApiKeyAuth,
    AuthConfig,
    BearerAuth,
    CopassClient,
    ProviderAuth,
)
from copass_core.context_window import ContextWindow, ContextWindowResource
from copass_core.data_sources import BaseDataSource, ensure_data_source
from copass_core.http import (
    CopassApiError,
    CopassNetworkError,
    CopassValidationError,
    HttpClient,
    HttpClientOptions,
    RequestContext,
    RequestMiddleware,
    RequestOptions,
    ResponseContext,
    ResponseMiddleware,
    retry_with_backoff,
)
from copass_core.resources import (
    ApiKeysResource,
    BaseResource,
    Behavior,
    CanonicalEntity,
    ContextResource,
    ContextTier,
    DataSource,
    DataSourceIngestionMode,
    DataSourceKind,
    DataSourceProvider,
    DataSourceStatus,
    EntitiesResource,
    IngestResource,
    MatrixDetailLevel,
    MatrixPreset,
    MatrixResource,
    ProjectsResource,
    ProvenanceMetadata,
    RetrievalResource,
    Sandbox,
    SandboxLimits,
    SandboxStatus,
    SandboxStorageProvider,
    SandboxTier,
    SandboxesResource,
    SourcesResource,
    StatusResponse,
    StorageProject,
    StorageProjectStatus,
    UsageResource,
    UsersResource,
    VaultResource,
)
from copass_core.types import (
    ChatMessage,
    ChatRole,
    RetryConfig,
    SearchPreset,
    WindowLike,
)

__version__ = "0.2.0"

__all__ = [
    "__version__",
    # Client
    "CopassClient",
    "AuthConfig",
    "ApiKeyAuth",
    "BearerAuth",
    "ProviderAuth",
    "DEFAULT_API_URL",
    # Auth
    "AuthProvider",
    "SessionContext",
    "ApiKeyAuthProvider",
    "BearerAuthProvider",
    # HTTP
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
    # Resources — narrow
    "BaseResource",
    "RetrievalResource",
    "ContextResource",
    "ContextTier",
    # Resources — storage
    "SandboxesResource",
    "Sandbox",
    "SandboxLimits",
    "SandboxTier",
    "SandboxStatus",
    "SandboxStorageProvider",
    "StatusResponse",
    "SourcesResource",
    "DataSource",
    "DataSourceProvider",
    "DataSourceIngestionMode",
    "DataSourceStatus",
    "DataSourceKind",
    "IngestResource",
    "ProjectsResource",
    "StorageProject",
    "StorageProjectStatus",
    "VaultResource",
    # Resources — knowledge graph
    "EntitiesResource",
    "CanonicalEntity",
    "Behavior",
    "ProvenanceMetadata",
    "MatrixResource",
    "MatrixDetailLevel",
    "MatrixPreset",
    # Resources — account
    "UsersResource",
    "ApiKeysResource",
    "UsageResource",
    # Higher-order
    "ContextWindow",
    "ContextWindowResource",
    "BaseDataSource",
    "ensure_data_source",
    # Types
    "RetryConfig",
    "ChatMessage",
    "ChatRole",
    "WindowLike",
    "SearchPreset",
]
