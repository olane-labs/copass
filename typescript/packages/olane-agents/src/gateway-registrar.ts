/**
 * Gateway registrar — connects a running OlaneOS daemon to a remote
 * "compute gateway" (the `o://daemons` tool on a publicly-deployed
 * compute-sandbox instance, per ADR 0027 / o-private-network #16).
 *
 * Note (ADR 0030 Phase 2a): `runOlaneOSHost` now api-resolves the
 * gateway multiaddr by default — when no `GATEWAY_MULTIADDR` env var
 * is set, it POSTs to the Copass api to fetch the per-user gateway's
 * libp2p multiaddr + peer-id and passes the result here. This module
 * itself doesn't talk to the api; it operates on the already-resolved
 * multiaddr supplied via `GatewayRegistrarOptions.gatewayMultiaddr`.
 * See `auto-resolve-gateway.ts` for the api-side resolver.
 *
 * Flow on daemon boot:
 *   1. Use the daemon's own ``os.rootLeader`` to dial the gateway
 *      and call ``o://daemons.register({...})``. The dial is made
 *      from the leader's libp2p stack so the gateway caches an
 *      inbound connection keyed under the LEADER's peer-id.
 *   2. Periodic heartbeat (default 60s) — keeps `last_seen` fresh
 *      so the gateway doesn't filter us out as stale.
 *   3. On graceful shutdown: stop the heartbeat, call
 *      `o://daemons.unregister`.
 *
 * Why the leader does the register itself (rather than a transient
 * `oClientNode`): the gateway's anchor-scoped dialer
 * (``o-private-network/nodes/compute-sandbox/src/registry-http.ts``,
 * PR #21) pre-populates ``oNodeAddress.transports`` with the daemon's
 * libp2p multiaddr so the framework's
 * ``getCachedConnectionFromAddress`` can find an existing inbound
 * connection by peer-id and reuse it (skipping a fresh ``p2pNode.dial``
 * that would trip the libp2p ``denyDialPeer`` gater). For that cache
 * hit to fire, the gateway's inbound-connection cache must be keyed
 * on the same peer-id the gateway-side dialer is looking up — the
 * LEADER's peer-id, which is what ``daemon_address`` carries. The
 * old design booted a transient ``oClientNode`` with its own
 * per-process peer-id; the gateway then had a connection keyed under
 * that transient peer, while dials to the leader's peer always
 * missed → fresh dial → gater block. Using the leader directly
 * closes that loop without touching the framework's gater or
 * connection-cache contract.
 *
 * Best-effort throughout:
 *   - Registration failure during boot is logged but does NOT block the
 *     daemon from running. The daemon still works locally; it's just
 *     not discoverable through the gateway until the next successful
 *     register attempt (we re-attempt on each heartbeat).
 *   - Heartbeat failures are logged + retried on the next interval.
 *   - Unregister at shutdown is best-effort (gateway may already be
 *     unreachable).
 *
 * `daemon_address` reported to the gateway is the daemon's first
 * non-loopback libp2p multiaddr from ``rootLeader``. For the MVP
 * threat model (single-user, single-host or LAN-reachable) this is
 * fine. Phase 2 will add circuit-relay-client reservation against
 * the gateway so the daemon is publicly dialable for clients that
 * can't reach the leader's IP directly.
 */

import { oNodeAddress, oNodeTransport } from '@olane/o-node';

/** Olane address of the registry tool on the gateway. Matches
 *  `REGISTRY_TOOL_ADDRESS` in
 *  `o-private-network/nodes/compute-sandbox/src/registry.tool.ts`. */
export const GATEWAY_REGISTRY_ADDRESS = 'o://daemons';

/** Default heartbeat cadence. Pairs with the gateway's
 *  `DEFAULT_REGISTRY_STALE_MS` (5 min) — at 60s we have ~5x headroom. */
export const DEFAULT_HEARTBEAT_MS = 60_000;

/** Default consecutive-failure threshold before emitting
 *  `reconnect-needed`. At the default 60s cadence, 2 failures = ~2 min
 *  of dead state — enough to ride out single-blip transients, short
 *  enough that a real outage gets caught before the user notices.
 *  (ADR 0030 lifecycle option C.) */
export const DEFAULT_HEARTBEAT_FAILURE_THRESHOLD = 2;

export interface GatewayRegistrarOptions {
  /**
   * libp2p multiaddr of the gateway's leader. The leader hosts the
   * `o://daemons` registry tool. Example forms:
   *   /dns4/relay.olane.com/tcp/443/tls/ws/p2p/<gateway-peer>
   *   /ip4/127.0.0.1/tcp/4015/p2p/<gateway-peer>   (local dev)
   */
  gatewayMultiaddr: string;
  /** Owner user id. Trusted by the gateway today; Phase 3 will derive
   *  it from a verified Supabase JWT instead of the call params. */
  userId: string;
  /** Stable daemon id. If unset, a per-process random suffix is used —
   *  acceptable for V0 but persistence-aware deployments should supply
   *  a stable value (e.g. hash of hostname + instance name). */
  daemonId?: string;
  /** Capabilities this daemon offers to gateway consumers. Free-form
   *  strings; consumers filter client-side. */
  capabilities?: string[];
  /** Free-form metadata stamped on the registration row. */
  metadata?: Record<string, string>;
  /** Override the heartbeat cadence (ms). */
  heartbeatMs?: number;
  /** Logger for non-fatal failures. Defaults to `console.warn`. */
  log?: (msg: string, err?: unknown) => void;
  /**
   * Fired after `failureThreshold` consecutive libp2p heartbeat
   * failures (ADR 0030 lifecycle option C). The host wires this to its
   * reconnect cycle — tear down the libp2p client, re-resolve the
   * gateway multiaddr via the api, build a new client, re-register.
   *
   * The callback fires AT MOST ONCE per registrar lifetime —
   * subsequent failures past the threshold don't keep firing. The host
   * is expected to either unregister + drive a reconnect (which
   * spawns a fresh registrar) or treat the event as fatal.
   */
  onReconnectNeeded?: (info: {
    consecutiveFailures: number;
    lastError: unknown;
  }) => void;
  /**
   * Override the consecutive-failure threshold. Default
   * `DEFAULT_HEARTBEAT_FAILURE_THRESHOLD` (2 — about 2 min of dead
   * state at the default cadence).
   */
  failureThreshold?: number;
}

export interface RegisteredGatewayHandle {
  /** Tear down the heartbeat + unregister + stop the client.
   *  Idempotent — safe to call multiple times. */
  unregister: () => Promise<void>;
  /** The exact daemon_id reported to the gateway. Useful for the
   *  caller to log / surface in CLI output. */
  daemonId: string;
}

/**
 * Register the running OlaneOS with a remote gateway. Returns a handle
 * the caller must invoke on shutdown to leave cleanly.
 *
 * The `os` argument is an `OlaneOS` instance from `@olane/os`; we
 * `getMultiaddrs()` off its `rootLeader` (or fall back to a known
 * leader-shaped object) to report the daemon's dialable address.
 */
export async function registerWithGateway(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  os: any,
  options: GatewayRegistrarOptions,
): Promise<RegisteredGatewayHandle> {
  const log = options.log ?? ((msg: string, err?: unknown) => {
    if (err) {
      console.warn(`[gateway-registrar] ${msg}`, err);
    } else {
      console.warn(`[gateway-registrar] ${msg}`);
    }
  });

  const daemonId =
    options.daemonId ||
    `daemon-${Math.random().toString(36).slice(2, 10)}`;
  const capabilities = options.capabilities ?? ['network-broker'];
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

  // Resolve the daemon's primary dialable multiaddr off the LEADER —
  // the gateway-side dialer (registry-http.ts:buildDialAddress)
  // expects ``daemon.daemon_address`` to carry the leader's peer-id,
  // because that's the peer the gateway will open streams against
  // after the registration cache is hit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leaderNode = os?.rootLeader as any;
  if (!leaderNode || typeof leaderNode.use !== 'function') {
    throw new Error(
      'registerWithGateway: os.rootLeader is missing or has no use() — ' +
        'expected an oNode-shaped leader; the registration dial must ' +
        'originate from the leader so the gateway caches an inbound ' +
        'connection under the leader\'s peer-id.',
    );
  }
  const transports: Array<{ toString(): string }> =
    leaderNode?.transports ||
    (typeof leaderNode?.getMultiaddrs === 'function'
      ? leaderNode.getMultiaddrs()
      : []) ||
    [];
  // Prefer a non-loopback transport so external callers can dial it;
  // fall back to whatever the leader has if all are loopback (MVP
  // single-host setups will only have loopback).
  const transportStrings = transports.map((t) => t.toString());
  const daemonAddress =
    transportStrings.find((s) => !s.includes('/127.0.0.1/')) ||
    transportStrings[0] ||
    '';
  if (!daemonAddress) {
    throw new Error(
      'registerWithGateway: daemon\'s rootLeader has no libp2p transports — ' +
        'cannot construct a dialable address to advertise.',
    );
  }

  // The gateway hosts the registry tool at ``o://daemons``. We address
  // it directly with the gateway's libp2p multiaddr as a transport
  // hint — the framework's ``oSearchResolver`` early-returns when
  // ``address.transports.length > 0`` (matching the gateway-side
  // dialer's pattern), and the leader's libp2p stack opens an
  // outbound connection to the gateway's peer. From the gateway's
  // perspective the connection is INBOUND from the leader's
  // peer-id — its connection-manager ``answer()`` path caches it
  // (``o-node-connection.manager.ts:205``). Subsequent gateway →
  // daemon dials look the leader peer-id up in that cache and skip
  // the dial path entirely.
  const gatewayRegistryAddress = new oNodeAddress(
    GATEWAY_REGISTRY_ADDRESS,
    [new oNodeTransport(options.gatewayMultiaddr)],
  );

  const registerPayload = {
    daemon_id: daemonId,
    user_id: options.userId,
    daemon_address: daemonAddress,
    capabilities,
    metadata: options.metadata ?? {},
  };

  // Best-effort initial registration. If this fails the daemon still
  // boots; the next heartbeat re-attempts register-on-not_registered.
  try {
    await leaderNode.use(gatewayRegistryAddress, {
      method: 'register',
      params: registerPayload,
    });
    log(`registered with gateway as daemon_id=${daemonId} address=${daemonAddress}`);
  } catch (err) {
    log('initial register failed (will retry on heartbeat)', err);
  }

  let stopped = false;
  let consecutiveFailures = 0;
  let reconnectFired = false;
  const failureThreshold =
    options.failureThreshold ?? DEFAULT_HEARTBEAT_FAILURE_THRESHOLD;
  const timer = setInterval(async () => {
    if (stopped) return;
    try {
      // The registry's heartbeat refreshes last_seen; if the daemon
      // isn't currently registered (e.g. gateway restarted, our row was
      // dropped), heartbeat returns `{ok: false, reason: 'not_registered'}`
      // — in that case we re-register so the daemon reappears.
      const raw = await leaderNode.use(gatewayRegistryAddress, {
        method: 'heartbeat',
        params: { daemon_id: daemonId },
      });
      const result =
        (raw as { result?: { data?: { ok?: boolean; reason?: string } } })
          ?.result?.data;
      if (result?.ok === false && result.reason === 'not_registered') {
        await leaderNode.use(gatewayRegistryAddress, {
          method: 'register',
          params: registerPayload,
        });
        log(`re-registered (gateway dropped our row)`);
      }
      // Successful tick — reset the failure counter. A single live
      // heartbeat undoes the entire "dead state" accumulation. The
      // reconnect signal is meant for genuinely-dead gateways, not
      // single-tick blips.
      consecutiveFailures = 0;
    } catch (err) {
      log('heartbeat failed', err);
      consecutiveFailures += 1;
      // ADR 0030 lifecycle option C: when the libp2p heartbeat fails
      // N times in a row (default 2 ≈ ~2 min) we surface a
      // reconnect-needed signal. The host listens for this and drives
      // tear-down + re-resolve + re-register. We deliberately fire
      // only ONCE per registrar — the host is expected to spawn a
      // fresh registrar instance on reconnect, so a continued failure
      // loop is the host's problem, not this module's.
      if (
        consecutiveFailures >= failureThreshold &&
        !reconnectFired &&
        options.onReconnectNeeded
      ) {
        reconnectFired = true;
        try {
          options.onReconnectNeeded({
            consecutiveFailures,
            lastError: err,
          });
        } catch (cbErr) {
          log('onReconnectNeeded callback threw', cbErr);
        }
      }
    }
  }, heartbeatMs);

  const unregister = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    try {
      await leaderNode.use(gatewayRegistryAddress, {
        method: 'unregister',
        params: { daemon_id: daemonId },
      });
    } catch (err) {
      log('unregister failed (gateway may already be unreachable)', err);
    }
    // No client.stop() — the leader is the daemon's own root node and
    // outlives the registrar. The host shuts it down via OlaneOS.
  };

  return { unregister, daemonId };
}
