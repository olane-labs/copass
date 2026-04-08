export { CopassClient } from './client.js';
export type { CopassClientOptions, AuthConfig } from './client.js';

// Auth
export type { SessionContext, AuthProvider } from './auth/types.js';

// Crypto
export { WRAP_HKDF_SALT, WRAP_HKDF_INFO, DEK_HKDF_SALT, DEK_HKDF_INFO } from './crypto/constants.js';

// HTTP
export { CopassApiError, CopassNetworkError, CopassValidationError } from './http/errors.js';

// Resources
export type { ExtractionResource } from './resources/extraction.js';
export type { EntitiesResource } from './resources/entities.js';
export type { CosyncResource } from './resources/cosync.js';
export type { PlansResource } from './resources/plans.js';
export type { MatrixResource } from './resources/matrix.js';
export type { ProjectsResource } from './resources/projects.js';
export type { UsersResource } from './resources/users.js';
export type { ApiKeysResource } from './resources/api-keys.js';
export type { UsageResource } from './resources/usage.js';

// Types
export type * from './types/index.js';
