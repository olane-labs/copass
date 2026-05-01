"""Resource modules — thin wrappers around specific API paths."""

from copass_core.resources.agents import (
    AgentsResource,
    AgentTriggersResource,
    WireIntegrationMode,
    WireIntegrationResult,
)
from copass_core.resources.api_keys import ApiKeysResource
from copass_core.resources.base import BaseResource
from copass_core.resources.context import ContextResource, ContextTier
from copass_core.resources.entities import (
    Behavior,
    CanonicalEntity,
    EntitiesResource,
    ProvenanceMetadata,
)
from copass_core.resources.ingest import IngestResource
from copass_core.resources.integrations import IntegrationsResource
from copass_core.resources.matrix import MatrixDetailLevel, MatrixPreset, MatrixResource
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
from copass_core.resources.vault import VaultResource

__all__ = [
    "BaseResource",
    "RetrievalResource",
    "ContextResource",
    "ContextTier",
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
    "Behavior",
    "ProvenanceMetadata",
    # Matrix
    "MatrixResource",
    "MatrixDetailLevel",
    "MatrixPreset",
    # Vault
    "VaultResource",
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
]
