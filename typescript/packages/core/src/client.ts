import { ApiKeyAuthProvider } from './auth/api-key.js';
import { BearerAuthProvider } from './auth/bearer.js';
import { SupabaseAuthProvider } from './auth/supabase.js';
import type { SupabaseAuthOptions } from './auth/supabase.js';
import type { AuthProvider } from './auth/types.js';
import { HttpClient } from './http/http-client.js';
import { EntitiesResource } from './resources/entities.js';
import { CosyncResource } from './resources/cosync.js';
import { PlansResource } from './resources/plans.js';
import { MatrixResource } from './resources/matrix.js';
import { ProjectsResource } from './resources/projects.js';
import { UsersResource } from './resources/users.js';
import { ApiKeysResource } from './resources/api-keys.js';
import { UsageResource } from './resources/usage.js';
import { SandboxesResource } from './resources/sandboxes.js';
import { SourcesResource } from './resources/sources.js';
import { VaultResource } from './resources/vault.js';
import { IngestResource } from './resources/ingest.js';
import type { RequestMiddleware, ResponseMiddleware } from './http/http-client.js';
import type { RetryConfig } from './types/common.js';

/**
 * Authentication configuration.
 *
 * - `api-key`: Long-lived API key with `olk_` prefix
 * - `bearer`: Raw JWT token (caller manages refresh)
 * - `supabase`: Managed Supabase OTP auth with auto-refresh
 * - `provider`: Custom AuthProvider implementation
 */
export type AuthConfig =
  | { type: 'api-key'; key: string }
  | { type: 'bearer'; token: string }
  | { type: 'supabase'; options: SupabaseAuthOptions }
  | { type: 'provider'; provider: AuthProvider };

export interface CopassClientOptions {
  /** Base URL for the Copass API. Default: 'https://ai.copass.id' */
  apiUrl?: string;
  /** Authentication configuration. */
  auth: AuthConfig;
  /** Master encryption key for payload encryption. Optional. */
  encryptionKey?: string;
  /** Retry configuration for transient failures. */
  retry?: RetryConfig;
  /** Middleware hooks called before each request. */
  onRequest?: RequestMiddleware[];
  /** Middleware hooks called after each successful response. */
  onResponse?: ResponseMiddleware[];
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
 * const score = await client.cosync.score({ canonical_ids: ['...'] });
 * ```
 */
export class CopassClient {
  readonly sandboxes: SandboxesResource;
  readonly sources: SourcesResource;
  readonly projects: ProjectsResource;
  readonly vault: VaultResource;
  readonly ingest: IngestResource;
  readonly entities: EntitiesResource;
  readonly cosync: CosyncResource;
  readonly plans: PlansResource;
  readonly matrix: MatrixResource;
  readonly users: UsersResource;
  readonly apiKeys: ApiKeysResource;
  readonly usage: UsageResource;

  constructor(options: CopassClientOptions) {
    const authProvider = createAuthProvider(options.auth, options.encryptionKey);
    const http = new HttpClient({
      apiUrl: options.apiUrl ?? DEFAULT_API_URL,
      authProvider,
      retry: options.retry,
      onRequest: options.onRequest,
      onResponse: options.onResponse,
    });

    this.sandboxes = new SandboxesResource(http);
    this.sources = new SourcesResource(http);
    this.projects = new ProjectsResource(http);
    this.vault = new VaultResource(http);
    this.ingest = new IngestResource(http);
    this.entities = new EntitiesResource(http);
    this.cosync = new CosyncResource(http);
    this.plans = new PlansResource(http);
    this.matrix = new MatrixResource(http);
    this.users = new UsersResource(http);
    this.apiKeys = new ApiKeysResource(http);
    this.usage = new UsageResource(http);
  }
}

function createAuthProvider(auth: AuthConfig, encryptionKey?: string): AuthProvider {
  switch (auth.type) {
    case 'api-key':
      return new ApiKeyAuthProvider(auth.key);
    case 'bearer':
      return new BearerAuthProvider(auth.token, encryptionKey);
    case 'supabase':
      return new SupabaseAuthProvider({
        ...auth.options,
        encryptionKey: auth.options.encryptionKey ?? encryptionKey,
      });
    case 'provider':
      return auth.provider;
  }
}
