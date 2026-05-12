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

// =======================================================================
// Gateway keepalive — ADR 0030 lifecycle option B (CLI consumer of the
// api-side ``POST /local/gateway/heartbeat`` endpoint).
// =======================================================================
//
// The E2B gateway sandbox auto-stops after `cfg.idle_timeout_seconds`
// (default 900s / 15min) of E2B-side idle. Libp2p heartbeats from this
// daemon to the in-sandbox broker don't refresh the timer — only the
// api process's SDK call does. Without this keepalive the gateway dies
// 15 minutes after the user's last api-side call regardless of whether
// the daemon is happily heartbeating, and the daemon orphans against a
// dead multiaddr / new peer-id.
//
// `startGatewayKeepalive` runs on its OWN loop independent of the
// libp2p heartbeat in `gateway-registrar.ts` — different transports,
// different failure modes. The libp2p loop tells us whether the
// gateway is *reachable*; this loop tells the api the gateway is
// *wanted*.

const LOCAL_GATEWAY_HEARTBEAT_PATH =
  '/api/v1/storage/compute-providers/local/gateway/heartbeat';

/** Default cadence matches the libp2p heartbeat for legibility. The
 *  api side refreshes the E2B timer to `cfg.idle_timeout_seconds`
 *  (typically 900s) so 60s gives 15x headroom — every refresh resets
 *  the deadline. */
export const DEFAULT_KEEPALIVE_MS = 60_000;

/** After this many consecutive non-410 failures (network blips, 5xx,
 *  etc.), the keepalive's `onFailure` fires. The CLI uses it as a soft
 *  alarm — `reconnect-needed` is what actually drives recovery, and
 *  that signal comes from the libp2p heartbeat in `gateway-registrar`
 *  (different transport, different fault mode). A high threshold here
 *  avoids reconnect storms from transient api flakiness. */
export const DEFAULT_KEEPALIVE_FAILURE_THRESHOLD = 5;

export interface GatewayKeepaliveOptions {
  transport: GatewayAutoResolveTransport;
  /** Cadence between heartbeat ticks, ms. Default 60s. */
  intervalMs?: number;
  /** Emit after N consecutive non-410 failures. Default 5. */
  failureThreshold?: number;
  /** Called once when the api returns 410 ``gateway_gone`` — the
   *  underlying sandbox is dead, the api has marked the session
   *  STOPPED, and the daemon must tear down + re-resolve. */
  onGatewayGone?: () => void;
  /** Called once each time the consecutive-failure counter crosses the
   *  threshold. NOT a per-tick callback — the counter resets to 0 the
   *  next successful tick and the next breach fires again. */
  onFailure?: (err: unknown) => void;
  /** Optional logger. */
  log?: (msg: string, err?: unknown) => void;
  /** Test-only fetch seam. */
  fetchImpl?: typeof fetch;
}

/**
 * Start a recurring api-side heartbeat against the user's local gateway.
 * Returns an unsubscribe function — call it on shutdown to stop the
 * loop cleanly.
 *
 * The loop is fire-and-await — successive ticks don't pile up if one
 * is slow. We don't strict-interval; we sleep N ms after the previous
 * tick settles. That's correct posture for a keepalive: drifting a
 * little is fine, doubling up is not.
 *
 * Idempotency:
 *   * `onGatewayGone` fires at most once per loop instance. The api's
 *     410 means "this session is dead"; further ticks against the same
 *     session would return 404 (since the api just marked it STOPPED),
 *     so we stop the loop after the first 410.
 *   * `onFailure` re-fires only on threshold breaches; a single
 *     transient blip won't trigger anything.
 */
export function startGatewayKeepalive(
  opts: GatewayKeepaliveOptions,
): () => void {
  const log =
    opts.log ??
    ((msg: string, err?: unknown) => {
      if (err) {
        console.warn(`[gateway-keepalive] ${msg}`, err);
      } else {
        console.warn(`[gateway-keepalive] ${msg}`);
      }
    });
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const intervalMs = opts.intervalMs ?? DEFAULT_KEEPALIVE_MS;
  const failureThreshold =
    opts.failureThreshold ?? DEFAULT_KEEPALIVE_FAILURE_THRESHOLD;

  let stopped = false;
  let goneFired = false;
  let consecutiveFailures = 0;
  // Holds the active sleep timer between ticks so unsubscribe can
  // abort it immediately instead of waiting for `intervalMs` to elapse.
  let sleepTimer: ReturnType<typeof setTimeout> | null = null;
  let sleepResolve: (() => void) | null = null;

  if (!fetchImpl) {
    log(
      'no global fetch available; gateway keepalive disabled. ' +
        'Upgrade to Node 20+ to enable.',
    );
    // Return a no-op unsubscribe so callers always have a teardown
    // handle — keeps the call site uniform.
    return () => {};
  }

  const tick = async (): Promise<void> => {
    let token: string | null;
    try {
      token = await opts.transport.getAccessToken();
    } catch (err) {
      consecutiveFailures += 1;
      log('keepalive: failed to resolve access token', err);
      maybeFireFailure(err);
      return;
    }
    if (!token) {
      // Treat "no token" as a soft failure — log + bump counter. The
      // daemon may have lost its session; the libp2p path will catch
      // a real outage faster than we will.
      consecutiveFailures += 1;
      log('keepalive: no access token available');
      maybeFireFailure(new Error('no access token'));
      return;
    }

    const base = opts.transport.apiBaseUrl.replace(/\/+$/, '');
    const url = `${base}${LOCAL_GATEWAY_HEARTBEAT_PATH}`;
    let resp: Response;
    try {
      resp = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
        // The api endpoint reads the user_id from the bearer, not the
        // body — empty body is the contract.
        body: '',
      });
    } catch (err) {
      consecutiveFailures += 1;
      log('keepalive: network error', err);
      maybeFireFailure(err);
      return;
    }

    if (resp.status === 410) {
      // Gateway is gone — api has already marked the session STOPPED.
      // Fire the callback ONCE and stop the loop; the host wires this
      // event into its reconnect cycle.
      if (!goneFired) {
        goneFired = true;
        log('keepalive: api reports gateway_gone — triggering reconnect');
        try {
          opts.onGatewayGone?.();
        } catch (err) {
          log('keepalive: onGatewayGone callback threw', err);
        }
      }
      stopped = true;
      return;
    }

    if (!resp.ok) {
      consecutiveFailures += 1;
      log(`keepalive: api returned HTTP ${resp.status}`);
      maybeFireFailure(new Error(`HTTP ${resp.status}`));
      return;
    }

    // Successful tick — reset the failure counter.
    consecutiveFailures = 0;
  };

  function maybeFireFailure(err: unknown): void {
    if (consecutiveFailures === failureThreshold) {
      // Equality (not >=) so the callback fires exactly ONCE per breach;
      // the counter resets to 0 on next success and the next breach
      // re-fires.
      try {
        opts.onFailure?.(err);
      } catch (cbErr) {
        log('keepalive: onFailure callback threw', cbErr);
      }
    }
  }

  // Background loop. We intentionally do NOT block the caller — start
  // returns immediately and the loop runs on its own.
  void (async () => {
    while (!stopped) {
      await tick();
      if (stopped) break;
      await new Promise<void>((resolve) => {
        sleepResolve = resolve;
        sleepTimer = setTimeout(() => {
          sleepTimer = null;
          sleepResolve = null;
          resolve();
        }, intervalMs);
      });
    }
  })();

  return () => {
    stopped = true;
    if (sleepTimer) {
      clearTimeout(sleepTimer);
      sleepTimer = null;
    }
    if (sleepResolve) {
      sleepResolve();
      sleepResolve = null;
    }
  };
}
