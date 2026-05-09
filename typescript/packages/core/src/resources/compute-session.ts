/**
 * Runtime wrapper around a compute session record (ADR 0026 Phase 2).
 *
 * `ComputeResource.createSession` / `getSession` / `listSessions` return
 * instances of this class — every field of the underlying
 * `ComputeSessionResponse` wire shape is preserved (field-copied) and
 * three gateway helpers are bolted on:
 *
 *   - `proxyUrl(port, path?)`     → `https://...` URL for the per-port reverse proxy.
 *   - `websocketUrl(port, path?)` → same URL with the scheme rewritten to `wss://`.
 *   - `fetch(port, path, init?)`  → passthrough `globalThis.fetch` with bearer auth.
 *
 * URL construction is template substitution against
 * `record.gateway.url_template` — NOT string concatenation. Path is the
 * caller's responsibility (ADR 0026 §"The `gateway` Envelope (locked)"):
 * pass `""` for the bare per-port URL, or a string starting with `/`.
 *
 * `fetch` deliberately bypasses `HttpClient.request` — see the comment
 * at the call site for why. The auth source is shared, the transport
 * isn't.
 */
import type { HttpClient } from '../http/http-client.js';
import type { ComputeGateway, ComputeSessionResponse, ComputeSessionStatus } from '../types/compute.js';

const GATEWAY_NOT_CONFIGURED =
  'Gateway is not configured on this Copass deployment. ' +
  'The compute session response did not include a `gateway` envelope ' +
  '(ADR 0026 Phase 1 must be deployed server-side and the ' +
  'COMPUTE_GATEWAY_BASE_URL env var must be set).';

export class ComputeSession {
  /** Platform-issued opaque UUID. */
  readonly session_id: string;
  /** Template handle used at provision. */
  readonly template: string;
  readonly status: ComputeSessionStatus;
  readonly provisioned_at: string;
  readonly deadline_at: string;
  readonly last_activity_at: string;
  readonly metadata: Record<string, string>;
  /** Per-session reverse-proxy gateway envelope; absent on deployments without the feature. */
  readonly gateway?: ComputeGateway;

  /** The full underlying wire record (for callers that want it verbatim). */
  readonly record: ComputeSessionResponse;

  /** @internal Used to pull a fresh bearer token for `fetch` per call. */
  private readonly http: HttpClient;

  constructor(http: HttpClient, record: ComputeSessionResponse) {
    this.http = http;
    this.record = record;
    this.session_id = record.session_id;
    this.template = record.template;
    this.status = record.status;
    this.provisioned_at = record.provisioned_at;
    this.deadline_at = record.deadline_at;
    this.last_activity_at = record.last_activity_at;
    this.metadata = record.metadata;
    this.gateway = record.gateway;
  }

  /**
   * Build the `https://` (or `http://` if the gateway base is plain
   * HTTP) reverse-proxy URL for `port` on this session.
   *
   * `path` defaults to `""` — `proxyUrl(3000, "")` yields the bare
   * per-port URL with no trailing slash. Pass `"/api/v1/x"` (leading
   * slash) for a sub-path. Path is the caller's responsibility per
   * ADR 0026 §"The `gateway` Envelope (locked)".
   */
  proxyUrl(port: number, path: string = ''): string {
    const gw = this.requireGateway();
    return gw.url_template
      .replace('{base_url}', gw.base_url)
      .replace('{session_id}', this.session_id)
      .replace('{port}', String(port))
      .replace('{path}', path);
  }

  /**
   * `proxyUrl` with the URL scheme rewritten — `https://` → `wss://`,
   * `http://` → `ws://`. Pure prefix swap; everything after the scheme
   * is identical to `proxyUrl(port, path)`.
   */
  websocketUrl(port: number, path: string = ''): string {
    const url = this.proxyUrl(port, path);
    if (url.startsWith('https://')) return 'wss://' + url.slice('https://'.length);
    if (url.startsWith('http://')) return 'ws://' + url.slice('http://'.length);
    return url;
  }

  /**
   * Issue a request against `port` on this session via the gateway.
   *
   * Thin passthrough to `globalThis.fetch`: the only thing the SDK adds
   * is the gateway-resolved URL and the `Authorization: Bearer <token>`
   * header (token pulled fresh per call from the same auth provider
   * the rest of `@copass/core` uses). Body / headers / method / signal
   * / etc. flow through `init` untouched.
   *
   * No JSON serialization, no JSON parsing, no retries, no error
   * normalization — those would break legitimate sandbox traffic
   * (binary uploads, SSE, intentional non-2xx bodies the caller wants
   * to inspect). See ADR 0026 §"TypeScript SDK".
   */
  async fetch(port: number, path: string, init: RequestInit = {}): Promise<Response> {
    const url = this.proxyUrl(port, path);
    const session = await this.http.getAuthSession();

    // Merge caller-supplied headers with the bearer header. Caller
    // headers take precedence ONLY if they collide on a non-auth key;
    // the bearer always wins because every gateway request needs it.
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${session.accessToken}`);

    // Bypassing HttpClient.request on purpose — the gateway is a
    // transparent passthrough. ADR 0026 §"TypeScript SDK".
    return globalThis.fetch(url, { ...init, headers });
  }

  private requireGateway(): ComputeGateway {
    if (!this.gateway) throw new Error(GATEWAY_NOT_CONFIGURED);
    return this.gateway;
  }
}
