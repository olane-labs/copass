import { BaseResource } from './base.js';
import type { StatusResponse } from '../types/sandboxes.js';
import type {
  SandboxConnection,
  CreateSandboxConnectionRequest,
  ListSandboxConnectionsOptions,
  CreateSandboxConnectionApiKeyResponse,
} from '../types/sandbox-connections.js';

const BASE = '/api/v1/storage/sandboxes';

/**
 * Sandbox Connections — cross-user sandbox grants.
 *
 * Grants a non-owner (the *grantee*) `viewer` or `editor` access to a
 * sandbox the caller owns. Backed by `sandbox_connections` and
 * `copass_api_keys` (migration 058).
 *
 * Identity resolution: `create()` accepts `copass_id`, `user_id`, or
 * `email` — exactly one. `copass_id` is resolved server-side to the
 * grantee's UUID; only the resolved UUID is persisted, so the grant
 * survives the grantee renaming or releasing their handle.
 */
export class SandboxConnectionsResource extends BaseResource {
  /** Grant a connection on a sandbox you own. Owner-only. */
  async create(
    sandboxId: string,
    request: CreateSandboxConnectionRequest,
  ): Promise<SandboxConnection> {
    return this.post<SandboxConnection>(
      `${BASE}/${sandboxId}/connections`,
      request,
    );
  }

  /** List all grants on a sandbox you own. Owner-only. */
  async list(
    sandboxId: string,
    options: ListSandboxConnectionsOptions = {},
  ): Promise<SandboxConnection[]> {
    return this.get<SandboxConnection[]>(`${BASE}/${sandboxId}/connections`, {
      query: {
        include_revoked: options.include_revoked ? 'true' : undefined,
      },
    });
  }

  /**
   * Revoke (soft-delete) a grant. Cascades to API keys bound to this
   * connection so no key outlives its grant.
   */
  async revoke(sandboxId: string, connectionId: string): Promise<StatusResponse> {
    return this.delete<StatusResponse>(
      `${BASE}/${sandboxId}/connections/${connectionId}`,
    );
  }

  /**
   * Spawn a connection-scoped API key for an existing grant. The
   * plaintext key is returned **exactly once** — persist it
   * immediately or rotate.
   */
  async spawnApiKey(
    sandboxId: string,
    connectionId: string,
  ): Promise<CreateSandboxConnectionApiKeyResponse> {
    return this.post<CreateSandboxConnectionApiKeyResponse>(
      `${BASE}/${sandboxId}/connections/${connectionId}/api-keys`,
    );
  }
}
