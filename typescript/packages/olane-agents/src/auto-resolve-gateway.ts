/**
 * Gateway auto-resolution — ADR 0030 Phase 2a.
 *
 * `copass os start` used to require the user to know their gateway's
 * libp2p multiaddr ahead of time (`GATEWAY_MULTIADDR=...`). This module
 * removes that requirement: when no `GATEWAY_*` env vars are set, the
 * daemon resolves its gateway by POST-ing to the Copass api at
 * `POST /api/v1/storage/compute-providers/local/gateway`. The api
 * returns a fully-formed multiaddr (constructed from the user's per-
 * user broker sandbox's libp2p peer-id + WS host) — wire-format match
 * what `runOlaneOSHost` would consume from the env vars.
 *
 * Precedence (highest → lowest):
 *   1. `GATEWAY_MULTIADDR` env var (or `options.gateway.gatewayMultiaddr`)
 *      — escape hatch for power users and local dev.
 *   2. api auto-resolution (this module's `autoResolveGateway`).
 *   3. No registration (existing fallback path).
 *
 * The api side of this contract lives in
 * `frame_graph/copass_id/api/compute_providers.py` (see PR partner —
 * o-twin-data-pipeline #TBD); a backend deploy must precede this CLI
 * version landing in production. Tests here mock fetch; the e2e path
 * is verified by hand after both PRs land in staging.
 */

import * as os from 'node:os';

/**
 * The minimum auth + transport surface this module needs to talk to
 * the Copass api. We deliberately do NOT depend on `@copass/core`'s
 * full `CopassClient` — callers may already have a configured client
 * but we don't want to force its construction here (and the daemon
 * may want to use its own fetch / auth wiring). A typed fetch
 * function plus a base URL is the minimal seam.
 */
export interface GatewayAutoResolveTransport {
  /** Base URL of the Copass api (e.g. ``https://ai.copass.id``). */
  apiBaseUrl: string;
  /**
   * Per-call bearer / api-key resolver. Called once per
   * ``autoResolveGateway`` invocation; the result is stamped on the
   * ``Authorization`` header as ``Bearer <token>``. For `olk_` api
   * keys callers should return the key verbatim — the api accepts
   * both bearer JWTs and `olk_` keys in the ``Authorization`` header.
   *
   * Return ``null`` when no credentials are available — auto-resolve
   * skips and the daemon falls through to the no-registration path.
   */
  getAccessToken: () => Promise<string | null>;
}

/**
 * Wire shape returned by `POST /api/v1/storage/compute-providers/local/gateway`
 * (the new fields land alongside the existing `gateway_url` /
 * `sandbox_id` / `session_id` / `provisioned_now` ones). We accept
 * unknown extra fields so the api can evolve without breaking us.
 */
interface LocalGatewayResponse {
  gateway_url: string;
  gateway_multiaddr: string;
  gateway_peer_id: string;
  sandbox_id: string;
  session_id: string;
  provisioned_now: boolean;
}

export interface AutoResolveGatewayOptions {
  transport: GatewayAutoResolveTransport;
  /** Free-form per-process identifier. If unset, generated once and
   *  cached on the module's `_processDaemonId` for stability across
   *  retries within the same process. */
  daemonId?: string;
  /** Optional logger. Defaults to ``console.warn`` for non-fatal
   *  failures; success path stays silent (the gateway registrar logs
   *  its own success line). */
  log?: (msg: string, err?: unknown) => void;
  /**
   * Override the resolved user id. By default this comes from
   * decoding the bearer / api key — but the api endpoint reads the
   * user id from its own ``_get_current_user`` dep, so we don't
   * actually need to know the user_id client-side. The
   * ``GatewayRegistrarOptions.userId`` is reported to the gateway's
   * registry tool over libp2p, and it MUST match the user's identity
   * (the gateway trusts the api-derived user_id at MVP).
   *
   * Callers SHOULD supply this — typically from their already-parsed
   * Supabase session or api-key prefix.
   */
  userId: string;
  /** Optional fetch override for testability. Defaults to ``globalThis.fetch``. */
  fetchImpl?: typeof fetch;
}

export interface AutoResolveGatewayResult {
  /** Full multiaddr (``/dns4/<host>/tcp/443/tls/ws/p2p/<peer-id>``) the
   *  daemon dials to register with the gateway. */
  gatewayMultiaddr: string;
  /** Gateway peer-id, broken out for logging / future use. */
  gatewayPeerId: string;
  /** Stable per-process daemon id (auto-generated if not supplied). */
  daemonId: string;
}

/**
 * Per-process stable daemon id cache. Without this every call would
 * mint a fresh suffix — fine for the FIRST register call, but if the
 * heartbeat falls back to re-resolving on a transient failure we'd
 * end up with two registry rows for one daemon. Keep the id stable
 * for the lifetime of the host process.
 */
let _processDaemonId: string | null = null;

function defaultDaemonId(): string {
  if (_processDaemonId) return _processDaemonId;
  const host = (os.hostname() || 'unknown').replace(/[^a-z0-9-]/gi, '-');
  const suffix = Math.random().toString(36).slice(2, 8);
  _processDaemonId = `${host}-${suffix}`;
  return _processDaemonId;
}

/** Reset the cached daemon id — test-only seam. */
export function _resetDaemonIdForTest(): void {
  _processDaemonId = null;
}

const LOCAL_GATEWAY_PATH = '/api/v1/storage/compute-providers/local/gateway';

/**
 * Resolve the gateway by POSTing to the Copass api. Returns
 * ``null`` on any failure path so the caller can fall through to
 * the no-registration mode without a hard error.
 *
 * Failure modes (all → null + warn log):
 *   * No access token (caller not authed locally).
 *   * Transport error (network down, DNS, TLS).
 *   * Non-2xx response (4xx auth, 5xx provisioning).
 *   * Malformed JSON / missing required fields.
 *
 * Success returns the multiaddr + peer-id + a stable daemon id.
 */
export async function autoResolveGateway(
  options: AutoResolveGatewayOptions,
): Promise<AutoResolveGatewayResult | null> {
  const log = options.log ?? ((msg: string, err?: unknown) => {
    if (err) {
      console.warn(`[gateway-auto-resolve] ${msg}`, err);
    } else {
      console.warn(`[gateway-auto-resolve] ${msg}`);
    }
  });
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    log(
      'no global fetch available; cannot auto-resolve gateway. ' +
        'Set GATEWAY_MULTIADDR manually or upgrade to Node 20+.',
    );
    return null;
  }

  let token: string | null;
  try {
    token = await options.transport.getAccessToken();
  } catch (err) {
    log('failed to resolve access token; skipping auto-resolve', err);
    return null;
  }
  if (!token) {
    log(
      'no Copass access token available; skipping gateway auto-resolve. ' +
        'Run `copass login` or set GATEWAY_MULTIADDR explicitly.',
    );
    return null;
  }

  const base = options.transport.apiBaseUrl.replace(/\/+$/, '');
  const url = `${base}${LOCAL_GATEWAY_PATH}`;
  let resp: Response;
  try {
    resp = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ provision_if_missing: true }),
    });
  } catch (err) {
    log(
      'could not auto-resolve gateway (network error); ' +
        'set GATEWAY_MULTIADDR env vars or check your network.',
      err,
    );
    return null;
  }

  if (!resp.ok) {
    let detail: unknown;
    try {
      detail = await resp.json();
    } catch {
      /* response may not be JSON; that's fine */
    }
    log(
      `could not auto-resolve gateway: HTTP ${resp.status}. ` +
        'Set GATEWAY_MULTIADDR env vars or check your auth.',
      detail,
    );
    return null;
  }

  let body: LocalGatewayResponse;
  try {
    body = (await resp.json()) as LocalGatewayResponse;
  } catch (err) {
    log('could not parse gateway response as JSON', err);
    return null;
  }

  if (!body.gateway_multiaddr || !body.gateway_peer_id) {
    log(
      'gateway response missing libp2p fields (gateway_multiaddr or ' +
        'gateway_peer_id); api may be out of date. ' +
        'Set GATEWAY_MULTIADDR manually.',
    );
    return null;
  }

  return {
    gatewayMultiaddr: body.gateway_multiaddr,
    gatewayPeerId: body.gateway_peer_id,
    daemonId: options.daemonId ?? defaultDaemonId(),
  };
}
