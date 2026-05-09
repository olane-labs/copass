/**
 * Compute Router v1 — type definitions for the public compute surface.
 *
 * Backs the seven `/api/v1/storage/sandboxes/{sandbox_id}/compute/*`
 * endpoints (ADR 0020). Mirrors the server-side Pydantic models in
 * `frame_graph/copass_id/api/models.py` (Compute section).
 *
 * Key invariants — keep these in lock-step with the server:
 *   - `session_id` on every wire shape is the platform-issued opaque
 *     UUID. The provider's `external_session_id` is server-internal
 *     and NEVER appears here.
 *   - Reserved metadata keys (`user_id`, `sandbox_id`, `agent_id`,
 *     `run_id`) are stripped from outbound `metadata` server-side.
 *     Don't reintroduce them in client-side typings.
 */

/**
 * Underlying compute provider. Matches the server-side
 * `AgentComputeProvider` enum but stays a free-form union here so
 * adding a third provider on the server doesn't force a client SDK
 * version bump for type-only consumers.
 */
export type ComputeProvider = 'daytona' | 'e2b' | (string & {});

/**
 * Status returned on `ComputeSessionResponse.status`. Mirrors
 * `ComputeSessionStatus` server-side.
 *
 * Free-form union — adding a state on the server should NOT break
 * type-only consumers.
 */
export type ComputeSessionStatus =
  | 'provisioning'
  | 'running'
  | 'idle'
  | 'stopped'
  | 'archived'
  | 'failed'
  | (string & {});

/**
 * Liveness-derived status from `GET /sessions/{session_id}/health`.
 * Distinct from `ComputeSessionStatus` — the row state and the live
 * health probe answer different questions (see ADR 0020).
 */
export type ComputeSessionHealthStatus =
  | 'ready'
  | 'starting'
  | 'stopped'
  | 'errored'
  | (string & {});

/** One curated compute template available for provisioning. */
export interface ComputeTemplate {
  /** Dev-facing template handle (e.g. `'copass-hermes-py311'`). */
  name: string;
  /**
   * Underlying compute provider for this template. Provider-internal
   * template / snapshot ids are NOT exposed.
   */
  provider: ComputeProvider;
  cpu_count: number;
  memory_mb: number;
  description: string;
}

export interface ListComputeTemplatesResponse {
  templates: ComputeTemplate[];
}

/** Optional filter set for `GET /compute/templates`. */
export interface ListComputeTemplatesOptions {
  /** Provider filter — unknown provider returns an empty list. */
  provider?: ComputeProvider;
}

/** POST body for `/compute/sessions` — provision a new sandbox. */
export interface CreateComputeSessionRequest {
  /** Template handle from `GET /compute/templates`. */
  template: string;
  /**
   * Environment variables injected into the sandbox at provision.
   * Server-side size cap applies.
   */
  env_vars?: Record<string, string>;
  /**
   * Session lifetime ceiling (seconds). Defaults to 300; max 3600.
   * The session is force-stopped at `provisioned_at + timeout_seconds`
   * regardless of activity.
   */
  timeout_seconds?: number;
  /**
   * Opaque tags echoed back on read. Reserved keys (`user_id`,
   * `sandbox_id`, `agent_id`, `run_id`) are stripped from responses
   * server-side — don't rely on them surviving a round-trip.
   */
  metadata?: Record<string, string>;
}

/**
 * One compute session as projected onto the wire. The provider's
 * `external_session_id` is server-internal and does NOT appear here
 * (per ADR 0020 §"Public surface — server-side").
 */
export interface ComputeSessionResponse {
  /** Platform-issued opaque UUID. Use this for all subsequent calls. */
  session_id: string;
  /** Template handle used at provision. */
  template: string;
  status: ComputeSessionStatus;
  provisioned_at: string;
  deadline_at: string;
  last_activity_at: string;
  metadata: Record<string, string>;
}

export interface ListComputeSessionsResponse {
  sessions: ComputeSessionResponse[];
}

/** Optional filter set for `GET /compute/sessions`. */
export interface ListComputeSessionsOptions {
  /**
   * When true, include sessions in terminal states (`stopped`,
   * `failed`, `archived`) alongside active ones. Default: `false`.
   */
  include_stopped?: boolean;
  /** Max sessions returned. Server clamps to [1, 100]. Default: 100. */
  limit?: number;
}

/** POST body for `/compute/sessions/{session_id}/exec`. */
export interface ComputeExecRequest {
  /**
   * argv-shaped command. Joined to a single shell-safe string by the
   * provider. Must be non-empty.
   */
  cmd: string[];
  /** Optional stdin to feed the command. Provider may ignore on older SDKs. */
  stdin?: string;
  /**
   * Per-exec timeout (seconds). Defaults to 60; max 3600. Effective
   * timeout is capped at the remaining session lifetime server-side.
   */
  timeout_seconds?: number;
}

/**
 * Result of one `/exec` call. A non-zero `exit_code` is the user's
 * command failing — the call still returns 200; only provider /
 * billing failures return non-2xx.
 */
export interface ComputeExecResponse {
  stdout: string;
  stderr: string;
  exit_code: number;
  elapsed_ms: number;
  /**
   * True when combined stdout+stderr exceeded the server-side cap
   * (10 MB) and was truncated.
   */
  truncated: boolean;
}

export interface ComputeSessionHealthResponse {
  session_id: string;
  status: ComputeSessionHealthStatus;
  last_activity_at: string;
}

export interface StopComputeSessionResponse {
  session_id: string;
  /**
   * Always `'stopped'` on success. Idempotent: a session already in a
   * terminal state returns 200 with `status='stopped'` without
   * re-calling the provider or re-billing.
   */
  status: string;
}
