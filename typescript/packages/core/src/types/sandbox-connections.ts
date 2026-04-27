/**
 * Cross-user sandbox grants — mirror of `frame_graph/copass_id/api/connections.py`
 * (POST/GET /sandboxes/{sandbox_id}/connections, DELETE /{connection_id},
 * POST /{connection_id}/api-keys).
 *
 * Connections let a sandbox owner grant a teammate access to their
 * sandbox. The grantee gets a connection-scoped API key and acts
 * inside the owner's sandbox at `viewer` or `editor` role.
 */

export type ConnectionRole = 'viewer' | 'editor';
export type ConnectionStatus = 'active' | 'revoked' | 'expired';

export interface SandboxConnection {
  connection_id: string;
  sandbox_id: string;
  /** Grantee's platform UUID — NOT the sandbox owner. */
  user_id: string;
  /**
   * Grantee's *current* Copass handle (without leading `@`), resolved
   * at read time. Absent if the grantee has not claimed a handle.
   * The historical handle (when the grant was minted by `copass_id`)
   * is preserved in `label` instead.
   */
  copass_id?: string | null;
  role: ConnectionRole | string;
  /** Optional project scope. NULL means the grant covers the whole sandbox. */
  project_id?: string | null;
  label?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_by: string;
  created_at: string;
  status: ConnectionStatus | string;
}

export interface CreateSandboxConnectionRequest {
  /**
   * Grantee Copass handle (e.g. `arcus` or `@arcus`). Resolved to a
   * `user_id` at create-time; only the resolved UUID is persisted.
   * Mutually exclusive with `user_id` and `email`.
   */
  copass_id?: string;
  /** Grantee platform UUID. Mutually exclusive with `copass_id` and `email`. */
  user_id?: string;
  /**
   * Grantee email. Reserved for a future invite flow; the server
   * returns 501 today if this is the only identifier supplied. Use
   * `copass_id` or `user_id` instead.
   */
  email?: string;
  role: ConnectionRole;
  /** Optional project-level scope inside this sandbox. */
  project_id?: string;
  label?: string;
  /** ISO 8601 timestamp. NULL = never expires until revoked. */
  expires_at?: string;
}

export interface ListSandboxConnectionsOptions {
  /** When true, includes revoked grants. Defaults to false. */
  include_revoked?: boolean;
}

export interface CreateSandboxConnectionApiKeyResponse {
  api_key_id: string;
  /**
   * Full plaintext API key (`olk_…`). Returned exactly once at
   * creation; the server does not retain plaintext after this
   * response. Persist it immediately or rotate.
   */
  plaintext_key: string;
  key_prefix: string;
  expires_at?: string | null;
  warning?: string;
}
