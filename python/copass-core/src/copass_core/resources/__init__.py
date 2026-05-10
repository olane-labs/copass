"""Resource modules — thin wrappers around specific API paths."""

from copass_core.resources.agents import (
    AgentsResource,
    AgentTriggersResource,
    WireIntegrationMode,
    WireIntegrationResult,
)
from copass_core.resources.api_keys import ApiKeysResource
from copass_core.resources.base import BaseResource
from copass_core.resources.compute import (
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
)
from copass_core.resources.entities import (
    CanonicalEntity,
    EntitiesResource,
)
from copass_core.resources.ingest import IngestResource
from copass_core.resources.integrations import IntegrationsResource
from copass_core.resources.projects import (
    ProjectsResource,
    StorageProject,
    StorageProjectStatus,
)
from copass_core.resources.retrieval import RetrievalResource
from copass_core.resources.sandbox_connections import SandboxConnectionsResource
from copass_core.resources.sandboxes import (
    Sandbox,
    SandboxLimits,
    SandboxStatus,
    SandboxStorageProvider,
    SandboxTier,
    SandboxesResource,
    StatusResponse,
)
from copass_core.resources.sources import (
    DataSource,
    DataSourceIngestionMode,
    DataSourceKind,
    DataSourceProvider,
    DataSourceStatus,
    SourcesResource,
    UserMcpSourceResult,
)
from copass_core.resources.usage import UsageResource
from copass_core.resources.users import UsersResource

__all__ = [
    "BaseResource",
    "RetrievalResource",
    # Sandboxes
    "SandboxesResource",
    "Sandbox",
    "SandboxLimits",
    "SandboxTier",
    "SandboxStatus",
    "SandboxStorageProvider",
    "StatusResponse",
    # Sources
    "SourcesResource",
    "DataSource",
    "DataSourceProvider",
    "DataSourceIngestionMode",
    "DataSourceStatus",
    "DataSourceKind",
    "UserMcpSourceResult",
    # Ingest
    "IngestResource",
    # Projects
    "ProjectsResource",
    "StorageProject",
    "StorageProjectStatus",
    # Entities
    "EntitiesResource",
    "CanonicalEntity",
    # Users
    "UsersResource",
    # API keys
    "ApiKeysResource",
    # Usage
    "UsageResource",
    # Agents
    "AgentsResource",
    "AgentTriggersResource",
    "WireIntegrationMode",
    "WireIntegrationResult",
    # Integrations
    "IntegrationsResource",
    # Sandbox connections
    "SandboxConnectionsResource",
    # Compute
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
]
