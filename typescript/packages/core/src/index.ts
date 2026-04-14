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
export type {
  RequestContext,
  ResponseContext,
  RequestMiddleware,
  ResponseMiddleware,
} from './http/http-client.js';

// Resources
export { BaseResource } from './resources/base.js';
export { SandboxesResource } from './resources/sandboxes.js';
export { SourcesResource } from './resources/sources.js';
export { ProjectsResource } from './resources/projects.js';
export { VaultResource } from './resources/vault.js';
export { IngestResource } from './resources/ingest.js';
export { EntitiesResource } from './resources/entities.js';
export { CosyncResource } from './resources/cosync.js';
export { PlansResource } from './resources/plans.js';
export { MatrixResource } from './resources/matrix.js';
export { UsersResource } from './resources/users.js';
export { ApiKeysResource } from './resources/api-keys.js';
export { UsageResource } from './resources/usage.js';

// Config
export {
  ProjectConfigSchema,
  CopassConfigSchema,
  IndexingConfigSchema,
  WatchConfigSchema,
  RetryConfigSchema,
  IngestionPipelineSchema,
  IngestionTransformSchema,
  PipelineMatchSchema,
  RetrievalProfileSchema,
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
  IngestionPipeline,
  IngestionTransform,
  PipelineMatch,
  RetrievalProfile,
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
export { matchPipeline } from './util/pipeline-resolver.js';
export { applyTransforms } from './util/transforms.js';

// Types
export type * from './types/index.js';
