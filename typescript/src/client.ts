import type { ExtractionResource } from './resources/extraction.js';
import type { EntitiesResource } from './resources/entities.js';
import type { CosyncResource } from './resources/cosync.js';
import type { PlansResource } from './resources/plans.js';
import type { MatrixResource } from './resources/matrix.js';
import type { ProjectsResource } from './resources/projects.js';
import type { UsersResource } from './resources/users.js';
import type { ApiKeysResource } from './resources/api-keys.js';
import type { UsageResource } from './resources/usage.js';
import type { RetryConfig } from './types/common.js';

/**
 * Authentication configuration.
 *
 * - `api-key`: Long-lived API key with `olk_` prefix
 * - `bearer`: Raw JWT token (caller manages refresh)
 * - `supabase`: Managed Supabase OTP auth (planned)
 */
export type AuthConfig =
  | { type: 'api-key'; key: string }
  | { type: 'bearer'; token: string }
  | { type: 'supabase'; email: string };

export interface CopassClientOptions {
  /** Base URL for the Copass API. Default: 'https://ai.copass.id' */
  apiUrl?: string;
  /** Authentication configuration. */
  auth: AuthConfig;
  /** Master encryption key for payload encryption. Optional. */
  encryptionKey?: string;
  /** Retry configuration for transient failures. */
  retry?: RetryConfig;
  /** Default project ID to include in requests. */
  projectId?: string;
}

const DEFAULT_API_URL = 'https://ai.copass.id';

/**
 * Copass client SDK.
 *
 * Main entry point for interacting with the Copass knowledge graph API.
 * Resources are accessed as properties following the Stripe SDK pattern.
 *
 * @example
 * ```typescript
 * const client = new CopassClient({
 *   auth: { type: 'api-key', key: 'olk_...' },
 * });
 *
 * const result = await client.matrix.query({ query: 'How does auth work?' });
 * ```
 */
export class CopassClient {
  readonly extraction!: ExtractionResource;
  readonly entities!: EntitiesResource;
  readonly cosync!: CosyncResource;
  readonly plans!: PlansResource;
  readonly matrix!: MatrixResource;
  readonly projects!: ProjectsResource;
  readonly users!: UsersResource;
  readonly apiKeys!: ApiKeysResource;
  readonly usage!: UsageResource;

  private readonly apiUrl: string;
  private readonly auth: AuthConfig;
  private readonly encryptionKey?: string;
  private readonly projectId?: string;

  constructor(options: CopassClientOptions) {
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.auth = options.auth;
    this.encryptionKey = options.encryptionKey;
    this.projectId = options.projectId;

    // TODO: Initialize HTTP client and resource instances
    // this.extraction = new ExtractionResource(httpClient);
    // this.entities = new EntitiesResource(httpClient);
    // etc.
  }
}
