// Client
export { CopassClient } from './client.js';
export type { CopassClientOptions, AuthConfig } from './client.js';

// Auth
export type { SessionContext, AuthProvider } from './auth/types.js';
export { ApiKeyAuthProvider } from './auth/api-key.js';
export { BearerAuthProvider } from './auth/bearer.js';
export { SupabaseAuthProvider } from './auth/supabase.js';
export type { SupabaseAuthOptions, SupabaseSession } from './auth/supabase.js';

// Crypto
export { WRAP_HKDF_SALT, WRAP_HKDF_INFO, DEK_HKDF_SALT, DEK_HKDF_INFO } from './crypto/constants.js';
export { encryptAesGcm, decryptAesGcm } from './crypto/encryption.js';
export type { EncryptedPayload } from './crypto/encryption.js';
export { deriveDek, deriveWrapKey, createSessionToken } from './crypto/session-token.js';

// HTTP
export { CopassApiError, CopassNetworkError, CopassValidationError } from './http/errors.js';
export { retryWithBackoff } from './http/retry.js';
export type {
  RequestContext,
  ResponseContext,
  RequestMiddleware,
  ResponseMiddleware,
} from './http/http-client.js';

// Data sources
export { BaseDataSource, ensureDataSource } from './data-sources/index.js';
export type {
  BaseDataSourceOptions,
  PushOptions,
  EnsureDataSourceOptions,
} from './data-sources/index.js';

// Context window
export { ContextWindow, ContextWindowResource } from './context-window/index.js';
export type {
  ContextWindowOptions,
  CreateContextWindowOptions,
  AttachContextWindowOptions,
  WindowLike,
} from './context-window/index.js';

// Resources
export { BaseResource } from './resources/base.js';
export { SandboxesResource } from './resources/sandboxes.js';
export { SandboxConnectionsResource } from './resources/sandbox-connections.js';
export { SourcesResource } from './resources/sources.js';
export { ProjectsResource } from './resources/projects.js';
export { VaultResource } from './resources/vault.js';
export { IngestResource } from './resources/ingest.js';
export { EntitiesResource } from './resources/entities.js';
export { MatrixResource } from './resources/matrix.js';
export { RetrievalResource } from './resources/retrieval.js';
export type {
  ChatRole,
  ChatMessage,
  DiscoveryItem,
  DiscoverRequest,
  DiscoverResponse,
  InterpretRequest,
  InterpretCitation,
  InterpretResponse,
  SearchRequest,
  SearchResponse,
  SearchPreset,
} from './resources/retrieval.js';
export { UsersResource } from './resources/users.js';
export { ApiKeysResource } from './resources/api-keys.js';
export { UsageResource } from './resources/usage.js';
export { IntegrationsResource } from './resources/integrations.js';
export type {
  AppCatalogItem,
  AppCatalogResponse,
  CatalogOptions,
  ConnectionItem,
  ConnectionsListResponse,
  ConnectRequest,
  ConnectResponse,
  IntegrationScope,
  ListConnectionsOptions,
  ReconcileRequest,
  ReconcileReportItem,
  ReconcileResponse,
} from './types/integrations.js';

// Reactive Agents (OLANE-1532)
export type {
  Agent,
  AgentBackend,
  AgentListResponse,
  AgentModelSettings,
  AgentRun,
  AgentRunListResponse,
  AgentStatus,
  AgentToolCatalogResponse,
  AgentToolDescriptor,
  AgentTrigger,
  CreateAgentRequest,
  CreateTriggerRequest,
  ListAgentRunsOptions,
  ListAgentsOptions,
  ListTriggerComponentsOptions,
  ListTriggersOptions,
  RunStatus,
  TestFireRequest,
  TriggerComponent,
  TriggerComponentListResponse,
  TriggerListResponse,
  TriggerStatus,
  UpdateAgentRequest,
  UpdateTriggerRequest,
} from './types/agents.js';

// Copass Concierge (per-user platform agent)
export { ConciergeResource } from './resources/concierge.js';
export type {
  ConciergeChatRequest,
  ConciergeEvent,
  ConciergeTestRequest,
  ConciergeTestResponse,
} from './types/concierge.js';

// SSE utilities
export { parseSSE } from './util/sse.js';
export type { SSEEvent } from './util/sse.js';

// Config
export {
  ProjectConfigSchema,
  CopassConfigSchema,
  IndexingConfigSchema,
  WatchConfigSchema,
  RetryConfigSchema,
  DefaultsConfigSchema,
  ScoreThresholdsSchema,
  defaultProjectConfig,
  normalizeProjectConfig,
  mergeConfigs,
} from './config/index.js';
export type {
  ProjectConfig,
  CopassConfig,
  IndexingConfig,
  WatchConfig,
  ProjectRetryConfig,
  DefaultsConfig,
  ScoreThresholds,
} from './config/index.js';

// Util
export {
  DEFAULT_LANGUAGE_MAP,
  buildLanguageMap,
  detectLanguage,
  isIndexableCodePath,
} from './util/language-map.js';
export { buildQueryMetadata } from './util/metadata.js';

// Types
export type * from './types/index.js';
