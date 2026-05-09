/**
 * Compute Router v1 — public compute SDK surface (ADR 0020).
 *
 * Hits the seven `/api/v1/storage/sandboxes/{sandbox_id}/compute/*`
 * endpoints. Auth is the same API key / bearer the developer uses
 * for `/agents`, `/sources`, `/sandboxes` — no new flow.
 *
 * All session ids on this surface are platform-issued opaque UUIDs;
 * the provider's `external_session_id` is server-internal and
 * intentionally not returned (per ADR 0020 §"Public surface —
 * server-side").
 *
 * @example
 * ```typescript
 * const { templates } = await client.compute.listTemplates(sandboxId);
 * const session = await client.compute.createSession(sandboxId, {
 *   template: templates[0].name,
 *   timeout_seconds: 600,
 * });
 * const result = await client.compute.exec(sandboxId, session.session_id, {
 *   cmd: ['python', '-c', 'print("hello")'],
 * });
 * await client.compute.stopSession(sandboxId, session.session_id);
 * ```
 */
import { BaseResource } from './base.js';
import { ComputeSession } from './compute-session.js';
import type {
  ComputeExecRequest,
  ComputeExecResponse,
  ComputeSessionHealthResponse,
  ComputeSessionResponse,
  CreateComputeSessionRequest,
  ListComputeSessionsOptions,
  ListComputeSessionsResponse,
  ListComputeTemplatesOptions,
  ListComputeTemplatesResponse,
  StopComputeSessionResponse,
} from '../types/compute.js';

const BASE = '/api/v1/storage/sandboxes';

function computeBase(sandboxId: string): string {
  return `${BASE}/${sandboxId}/compute`;
}

export class ComputeResource extends BaseResource {
  /** List curated compute templates available for this sandbox. */
  async listTemplates(
    sandboxId: string,
    options: ListComputeTemplatesOptions = {},
  ): Promise<ListComputeTemplatesResponse> {
    return this.get<ListComputeTemplatesResponse>(
      `${computeBase(sandboxId)}/templates`,
      { query: { provider: options.provider } },
    );
  }

  /**
   * Provision a new compute session. Returns the platform-issued
   * `session_id` — pass it to subsequent `/exec` / `/health` /
   * `stopSession` calls.
   *
   * Throws on:
   *   - 402 — insufficient credits (`InsufficientCreditsError`)
   *   - 403 — kill-switch engaged (`ComputeKillSwitchPausedError`)
   *   - 404 — unknown template
   *   - 409 — per-user concurrency cap exceeded
   *   - 502 — vendor SDK error
   */
  async createSession(
    sandboxId: string,
    request: CreateComputeSessionRequest,
  ): Promise<ComputeSession> {
    const raw = await this.post<ComputeSessionResponse>(
      `${computeBase(sandboxId)}/sessions`,
      request,
    );
    return new ComputeSession(this.http, raw);
  }

  /**
   * List compute sessions for this (user, sandbox). Defaults to
   * active sessions; pass `include_stopped: true` to also see
   * terminal-state rows.
   */
  async listSessions(
    sandboxId: string,
    options: ListComputeSessionsOptions = {},
  ): Promise<{ sessions: ComputeSession[] }> {
    const raw = await this.get<ListComputeSessionsResponse>(
      `${computeBase(sandboxId)}/sessions`,
      {
        query: {
          include_stopped: options.include_stopped ? 'true' : undefined,
          limit: options.limit !== undefined ? String(options.limit) : undefined,
        },
      },
    );
    return {
      ...raw,
      sessions: raw.sessions.map((r) => new ComputeSession(this.http, r)),
    };
  }

  /** Fetch one compute session by its platform `session_id`. */
  async getSession(
    sandboxId: string,
    sessionId: string,
  ): Promise<ComputeSession> {
    const raw = await this.get<ComputeSessionResponse>(
      `${computeBase(sandboxId)}/sessions/${sessionId}`,
    );
    return new ComputeSession(this.http, raw);
  }

  /**
   * Stop a compute session and bill the elapsed compute time.
   *
   * Idempotent — a session already in a terminal state returns
   * `status='stopped'` without re-calling the provider or re-billing.
   */
  async stopSession(
    sandboxId: string,
    sessionId: string,
  ): Promise<StopComputeSessionResponse> {
    return this.delete<StopComputeSessionResponse>(
      `${computeBase(sandboxId)}/sessions/${sessionId}`,
    );
  }

  /**
   * Run a single-shot command inside a provisioned sandbox.
   *
   * A non-zero `exit_code` on the returned shape is the user's
   * command failing — the call still returns 200 (no throw). Provider
   * / billing failures throw via the standard `CopassApiError` path.
   */
  async exec(
    sandboxId: string,
    sessionId: string,
    request: ComputeExecRequest,
  ): Promise<ComputeExecResponse> {
    return this.post<ComputeExecResponse>(
      `${computeBase(sandboxId)}/sessions/${sessionId}/exec`,
      request,
    );
  }

  /**
   * Best-effort liveness check on a compute session. Sessions in
   * terminal row states short-circuit without a provider round-trip.
   */
  async sessionHealth(
    sandboxId: string,
    sessionId: string,
  ): Promise<ComputeSessionHealthResponse> {
    return this.get<ComputeSessionHealthResponse>(
      `${computeBase(sandboxId)}/sessions/${sessionId}/health`,
    );
  }
}
