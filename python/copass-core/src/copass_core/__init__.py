"""Copass Python client SDK.

Python mirror of `@copass/core`_. v0.2 ships the full resource
surface matching the TS package, plus the ``ContextWindow`` /
``BaseDataSource`` primitives:

- ``CopassClient`` top-level entry point
- Auth: ``ApiKeyAuthProvider``, ``BearerAuthProvider``
- ``HttpClient`` with retry + middleware + raw body / raw response
- Resources: ``retrieval``, ``sandboxes``, ``sources``,
  ``ingest``, ``projects``, ``entities``,
  ``users``, ``api_keys``, ``usage``
- Higher-order: ``context_window`` (ephemeral data source wrapping
  agent conversations), ``BaseDataSource`` + ``ensure_data_source``
  for custom driver subclasses

Deferred to v0.3: Supabase OTP auth + crypto module (HKDF,
AES-GCM, session tokens, DEK — needed for ``BearerAuth(encryption_key=...)``
to actually generate a wrapped DEK).

.. _`@copass/core`: https://github.com/olane-labs/copass/tree/main/typescript/packages/core
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
    AgentsResource,
    AgentTriggersResource,
    WireIntegrationMode,
    WireIntegrationResult,
    ApiKeysResource,
    BaseResource,
    ComputeExecResponse,
    ComputeGateway,
    ComputeResource,
    ComputeSession,
    ComputeSessionHealthResponse,
    ComputeSessionResponse,
    ComputeTemplate,
    ListComputeSessionsResponse,
    ListComputeTemplatesResponse,
    StopComputeSessionResponse,
    CanonicalEntity,
    DataSource,
    DataSourceIngestionMode,
    DataSourceKind,
    DataSourceProvider,
    DataSourceStatus,
    EntitiesResource,
    IngestResource,
    IntegrationsResource,
    ProjectsResource,
    RetrievalResource,
    Sandbox,
    SandboxConnectionsResource,
    SandboxLimits,
    SandboxStatus,
    SandboxStorageProvider,
    SandboxTier,
    SandboxesResource,
    SourcesResource,
    StatusResponse,
    UserMcpSourceResult,
    StorageProject,
    StorageProjectStatus,
    UsageResource,
    UsersResource,
)
from copass_core.types import (
    AgentBackend,
    AgentComputeProvider,
    ChatMessage,
    ChatRole,
    CostInfo,
    DEFAULT_MODEL_BY_BACKEND,
    GateMode,
    RetryConfig,
    SearchPreset,
    WindowLike,
)

__all__ = [
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
    "UserMcpSourceResult",
    "IngestResource",
    "ProjectsResource",
    "StorageProject",
    "StorageProjectStatus",
    # Resources — knowledge graph
    "EntitiesResource",
    "CanonicalEntity",
    # Resources — account
    "UsersResource",
    "ApiKeysResource",
    "UsageResource",
    # Resources — agents + integrations + cross-user grants
    "AgentsResource",
    "AgentTriggersResource",
    "WireIntegrationMode",
    "WireIntegrationResult",
    "IntegrationsResource",
    "SandboxConnectionsResource",
    # Resources — compute
    "ComputeResource",
    "ComputeSession",
    "ComputeGateway",
    "ComputeTemplate",
    "ComputeSessionResponse",
    "ListComputeTemplatesResponse",
    "ListComputeSessionsResponse",
    "ComputeExecResponse",
    "ComputeSessionHealthResponse",
    "StopComputeSessionResponse",
    # Higher-order
    "ContextWindow",
    "ContextWindowResource",
    "BaseDataSource",
    "ensure_data_source",
    # Types
    "AgentBackend",
    "AgentComputeProvider",
    "CostInfo",
    "DEFAULT_MODEL_BY_BACKEND",
    "GateMode",
    "RetryConfig",
    "ChatMessage",
    "ChatRole",
    "WindowLike",
    "SearchPreset",
]
