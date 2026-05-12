/**
 * The body of the detached `os _run` host process.
 *
 * Front-ends (CLI, MCP server, custom binary) wire a hidden `os _run`
 * subcommand to call `runOlaneOSHost(...)`. It boots `OlaneOS` via the
 * canonical `@olane/os` lifecycle primitives, mounts a `RelayNode` so
 * other olane peers can dial through circuit-relay-v2, persists state
 * via `ConfigManager`, and stays resident until SIGTERM.
 *
 * Mirrors `@copass/datasource-olane`'s `runLocalOs` but additionally
 * mounts the relay — `runLocalOs` itself doesn't do this and there's no
 * upstream `onStarted` hook (yet). When that hook lands upstream we can
 * consolidate.
 */

import {
  ConfigManager,
  OlaneOSSystemStatus,
  RelayNode,
  defaultOSInstanceConfig,
  startOS,
} from '@olane/os';
import { oAddress, setupGracefulShutdown } from '@olane/o-core';
import portfinder from 'portfinder';

import { NetworkBrokerNode } from './network-broker-node.js';
import {
  registerWithGateway,
  type GatewayRegistrarOptions,
  type RegisteredGatewayHandle,
} from './gateway-registrar.js';
import {
  autoResolveGateway,
  startGatewayKeepalive,
  type GatewayAutoResolveTransport,
} from './auto-resolve-gateway.js';

export interface RunOlaneOSHostOptions {
  /** OS instance name — typically the user's Copass ID or unix username. */
  instanceName: string;
  /** Optional explicit port. Auto-assigned starting at 4999 if omitted. */
  port?: number;
  /** Skip the network-wide indexing on startup. Defaults to `true`. */
  noIndexNetwork?: boolean;
  /** Optional Copass token manager — destroyed on graceful shutdown. */
  tokenManager?: { destroy?: () => Promise<void> } | null;
  /**
   * Optional remote compute-gateway to register with on startup. When
   * set, the daemon dials the gateway's `o://daemons` registry tool,
   * registers itself, and heartbeats periodically so callers (Copass
   * API, web-app) can discover it. On graceful shutdown it unregisters.
   *
   * If omitted (and `GATEWAY_MULTIADDR` / `GATEWAY_USER_ID` envs are
   * also unset), the daemon runs without gateway presence — fine for
   * local-only development.
   */
  gateway?: Partial<GatewayRegistrarOptions> & {
    /** Set false to opt out even when env vars are present. */
    enabled?: boolean;
    /**
     * Optional Copass api transport for auto-resolving the gateway
     * multiaddr when ``GATEWAY_MULTIADDR`` is not set (ADR 0030 Phase
     * 2a). When supplied, the daemon POSTs to
     * ``/api/v1/storage/compute-providers/local/gateway`` to fetch
     * the per-user gateway's libp2p multiaddr + peer-id and uses
     * those to register itself.
     *
     * Precedence:
     *   1. ``options.gateway.gatewayMultiaddr`` (explicit override).
     *   2. ``GATEWAY_MULTIADDR`` env var.
     *   3. api auto-resolution via this transport (if supplied AND
     *      ``OLANE_GATEWAY_AUTO_RESOLVE !== 'false'``).
     *   4. No registration.
     *
     * Callers that already construct a ``CopassClient`` (e.g. the
     * CLI's ``getSdk``) can adapt it to this shape with a thin
     * wrapper around ``client.apiUrl`` + the auth provider's
     * ``getSession()``. The library deliberately stays unaware of
     * ``@copass/core`` to keep the dep graph minimal.
     */
    autoResolveTransport?: GatewayAutoResolveTransport;
    /**
     * Override the fetch implementation used by auto-resolve.
     * Test-only seam — production callers should let it default to
     * the global ``fetch``.
     */
    autoResolveFetchImpl?: typeof fetch;
  };
}

/**
 * Resolve gateway options from explicit options + env fallbacks +
 * (since ADR 0030 Phase 2a) auto-resolution against the Copass api.
 *
 * Precedence:
 *   1. ``opts.gateway.gatewayMultiaddr`` (explicit override).
 *   2. ``GATEWAY_MULTIADDR`` env var.
 *   3. api auto-resolution via ``opts.gateway.autoResolveTransport``
 *      (skipped if ``OLANE_GATEWAY_AUTO_RESOLVE=false``).
 *   4. Returns null → daemon runs without gateway presence.
 *
 * Env wins by design — power users and local-dev workflows want a
 * deterministic escape hatch. Auto-resolve is the default UX for
 * ``copass os start`` with no env setup.
 */
export async function resolveGatewayOptions(
  opts: RunOlaneOSHostOptions,
): Promise<GatewayRegistrarOptions | null> {
  if (opts.gateway?.enabled === false) return null;

  const explicitMultiaddr =
    opts.gateway?.gatewayMultiaddr ?? process.env.GATEWAY_MULTIADDR ?? '';
  const envUserId = opts.gateway?.userId ?? process.env.GATEWAY_USER_ID ?? '';
  const daemonId =
    opts.gateway?.daemonId ?? process.env.GATEWAY_DAEMON_ID ?? undefined;
  const capabilities =
    opts.gateway?.capabilities ??
    (process.env.GATEWAY_CAPABILITIES
      ? process.env.GATEWAY_CAPABILITIES.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined);
  const heartbeatMs =
    opts.gateway?.heartbeatMs ??
    (process.env.GATEWAY_HEARTBEAT_MS
      ? Number(process.env.GATEWAY_HEARTBEAT_MS)
      : undefined);

  // Path 1+2 — explicit env / option supplied. Use it verbatim.
  if (explicitMultiaddr && envUserId) {
    return {
      gatewayMultiaddr: explicitMultiaddr,
      userId: envUserId,
      daemonId,
      capabilities,
      metadata: opts.gateway?.metadata,
      heartbeatMs,
      log: opts.gateway?.log,
    };
  }

  // Path 3 — auto-resolve via Copass api.
  const autoResolveEnabled =
    process.env.OLANE_GATEWAY_AUTO_RESOLVE !== 'false';
  const transport = opts.gateway?.autoResolveTransport;
  if (autoResolveEnabled && transport && envUserId) {
    const result = await autoResolveGateway({
      transport,
      daemonId,
      log: opts.gateway?.log,
      userId: envUserId,
      fetchImpl: opts.gateway?.autoResolveFetchImpl,
    });
    if (result) {
      return {
        gatewayMultiaddr: result.gatewayMultiaddr,
        userId: envUserId,
        daemonId: result.daemonId,
        capabilities: capabilities ?? ['network-broker', 'shell'],
        metadata: opts.gateway?.metadata,
        heartbeatMs,
        log: opts.gateway?.log,
      };
    }
    // result === null → autoResolveGateway already logged the failure.
    // Fall through to no-registration mode rather than throwing — the
    // daemon still works locally; the gateway just won't see us.
  }

  return null;
}

/**
 * Boots OlaneOS + RelayNode and blocks forever (or until SIGTERM).
 *
 * The function does not return on success; it `await`s an unresolved
 * promise so the host stays resident.
 */
export async function runOlaneOSHost(
  options: RunOlaneOSHostOptions,
): Promise<void> {
  const { instanceName, port, noIndexNetwork = true, tokenManager } = options;

  const resolvedPort =
    port ?? (await portfinder.getPortPromise({ port: 4999 }));

  const config = defaultOSInstanceConfig(resolvedPort);
  config.noIndexNetwork = noIndexNetwork;

  const { os } = await startOS(instanceName, config);

  // Mount the relay so other peers can dial through us via
  // circuit-relay-v2. Lives as a child of the root leader for the
  // duration of the OS process.
  const relay = new RelayNode({
    address: new oAddress('o://relay'),
    leader: os.rootLeader?.address || null,
    parent: os.rootLeader?.address || null,
  });
  await os.addNode(relay);

  // Mount the network broker (ADR 0027 — `o://networks`). Lifecycle
  // envelope for user-managed network instances; provisions broker
  // sandboxes via E2B (default) OR mounts an in-daemon shell tool with
  // cwd=<user folder> (the `local` backend). Lives for the daemon's
  // lifetime; state is in-memory and wiped on stop.
  const networkBroker = new NetworkBrokerNode({
    address: new oAddress('o://networks'),
    leader: os.rootLeader?.address || null,
    parent: os.rootLeader?.address || null,
    daemonHooks: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerLocalTool: async (node: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await os.addNode(node as any);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unregisterLocalTool: async (node: any) => {
        // Best-effort — the base olane runtime doesn't expose
        // removeNode today; stop() releases the libp2p listener.
        try {
          if (node && typeof node.stop === 'function') {
            await node.stop();
          }
        } catch {
          /* best-effort */
        }
      },
      getDaemonLeaderTransports: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transports = (os.rootLeader as any)?.transports || [];
        return transports.map((t: { toString(): string }) => t.toString());
      },
    },
  });
  // Cast — NetworkBrokerNode extends oLaneTool (same base as RelayNode)
  // but the OlaneOSNode union is not exported with the right shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await os.addNode(networkBroker as any);

  // Optional: register the daemon with a remote compute gateway so
  // external callers (Copass API, web-app) can discover it. Skipped
  // silently if neither `options.gateway.{gatewayMultiaddr,userId}` nor
  // the matching env vars are set — local-only dev runs fine without it.
  //
  // ADR 0030 lifecycle (option B + C): the registration is now backed
  // by TWO failure-detection loops, on separate transports:
  //   * The libp2p heartbeat (inside `registerWithGateway`) — surfaces
  //     `onReconnectNeeded` after N consecutive libp2p failures, which
  //     means the gateway is unreachable (network glitch, laptop
  //     closed, etc.).
  //   * The api keepalive (`startGatewayKeepalive` below) — POSTs to
  //     `/local/gateway/heartbeat`, refreshing the E2B idle-stop timer
  //     so the sandbox doesn't auto-stop after 15 min. Surfaces
  //     `onGatewayGone` on 410 = sandbox was already stopped by E2B.
  //
  // Both routes converge on the same recovery path: tear down the
  // current registrar, re-resolve the gateway multiaddr via the api,
  // build a fresh registrar. The reconnect path is idempotent (a stale
  // event firing during shutdown is a no-op) and bounded by
  // exponential backoff (1s → 2s → ... → 60s cap).
  let gatewayHandle: RegisteredGatewayHandle | null = null;
  let keepaliveStop: (() => void) | null = null;
  let reconnecting = false;
  let shuttingDown = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_BACKOFF_MS = 60_000;
  const BASE_RECONNECT_BACKOFF_MS = 1_000;

  const initialGatewayOptions = await resolveGatewayOptions(options);

  // The reconnect cycle. Idempotent + recursive-safe — if a reconnect
  // is already in flight subsequent triggers are dropped, and we never
  // recurse on success (the new registrar wires its own callbacks).
  // On failure we back off exponentially and retry until either the
  // daemon shuts down or a reconnect succeeds.
  const reconnect = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    if (reconnecting) {
      console.warn(
        `[runOlaneOSHost] reconnect already in flight; ignoring trigger (${reason})`,
      );
      return;
    }
    reconnecting = true;
    try {
      console.warn(`[runOlaneOSHost] reconnecting to gateway: ${reason}`);
      // Tear down the previous registrar's heartbeat + libp2p client
      // before resolving fresh — keeps the registry clean and avoids
      // dialing the dead multiaddr on the next tick.
      if (gatewayHandle) {
        try {
          await gatewayHandle.unregister();
        } catch (err) {
          console.warn(
            '[runOlaneOSHost] reconnect: previous unregister failed (continuing)',
            err,
          );
        }
        gatewayHandle = null;
      }
      if (keepaliveStop) {
        try {
          keepaliveStop();
        } catch {
          /* best-effort */
        }
        keepaliveStop = null;
      }

      // Re-resolve via the api + rebuild. Each attempt sleeps
      // BASE_BACKOFF * 2^(attempts-1) ms (capped) before trying.
      while (!shuttingDown) {
        reconnectAttempts += 1;
        try {
          const fresh = await resolveGatewayOptions(options);
          if (!fresh) {
            console.warn(
              '[runOlaneOSHost] reconnect: resolveGatewayOptions returned null; ' +
                'falling back to no-registration mode',
            );
            reconnectAttempts = 0;
            return;
          }
          await wireGatewayRegistrationAndKeepalive(fresh);
          console.warn(
            `[runOlaneOSHost] reconnect: success after ${reconnectAttempts} attempt(s)`,
          );
          reconnectAttempts = 0;
          return;
        } catch (err) {
          const backoffMs = Math.min(
            BASE_RECONNECT_BACKOFF_MS *
              Math.pow(2, Math.max(0, reconnectAttempts - 1)),
            MAX_RECONNECT_BACKOFF_MS,
          );
          console.warn(
            `[runOlaneOSHost] reconnect attempt ${reconnectAttempts} failed; ` +
              `retrying in ${backoffMs}ms`,
            err,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    } finally {
      reconnecting = false;
    }
  };

  // Wires both the libp2p registrar and the api keepalive against a
  // given options bundle, with both callbacks pointed at `reconnect`.
  // Pulled out so the initial registration + every reconnect path
  // share the same setup — keeps the wiring honest.
  const wireGatewayRegistrationAndKeepalive = async (
    opts: GatewayRegistrarOptions,
  ): Promise<void> => {
    // The libp2p heartbeat reconnect signal (option C).
    const optsWithCallback: GatewayRegistrarOptions = {
      ...opts,
      onReconnectNeeded: (info) => {
        // Fire-and-forget — don't await inside the registrar's
        // heartbeat loop. The reconnect cycle owns its own lifecycle.
        void reconnect(
          `libp2p heartbeat dead after ${info.consecutiveFailures} ` +
            `consecutive failures`,
        );
      },
    };
    gatewayHandle = await registerWithGateway(os, optsWithCallback);

    // The api keepalive (option B). Only wired when we have an
    // auto-resolve transport — without it the api side has no way to
    // refresh the E2B timer and the gateway dies at the 15-min mark
    // regardless. Power-user setups with env-var multiaddr can opt
    // out by leaving `autoResolveTransport` unset; they're expected
    // to manage gateway lifecycle externally.
    const keepaliveTransport = options.gateway?.autoResolveTransport;
    if (keepaliveTransport) {
      keepaliveStop = startGatewayKeepalive({
        transport: keepaliveTransport,
        intervalMs: opts.heartbeatMs,
        log: opts.log,
        fetchImpl: options.gateway?.autoResolveFetchImpl,
        onGatewayGone: () => {
          void reconnect('api reported gateway_gone (sandbox stopped)');
        },
      });
    }
  };

  if (initialGatewayOptions) {
    try {
      await wireGatewayRegistrationAndKeepalive(initialGatewayOptions);
    } catch (err) {
      // Don't block daemon startup on gateway failure — the daemon
      // still works locally; we just won't appear in the gateway
      // registry until next attempt.
      console.warn(
        '[runOlaneOSHost] gateway registration failed; daemon will run without gateway presence',
        err,
      );
    }
  }

  setupGracefulShutdown(
    async () => {
      shuttingDown = true;
      // Stop the keepalive first so a final 410/5xx doesn't trigger
      // a reconnect mid-shutdown.
      if (keepaliveStop) {
        try {
          keepaliveStop();
        } catch {
          /* best-effort */
        }
      }
      // Unregister BEFORE stopping the OS — gives the gateway a clean
      // signal that we're going away instead of waiting for the
      // stale-after-N-minutes filter.
      if (gatewayHandle) {
        try {
          await gatewayHandle.unregister();
        } catch {
          /* best-effort */
        }
      }
      try {
        if (
          tokenManager &&
          typeof (tokenManager as { destroy?: () => Promise<void> }).destroy ===
            'function'
        ) {
          await (
            tokenManager as { destroy: () => Promise<void> }
          ).destroy();
        }
        await os.stop();
        await ConfigManager.updateOSConfig({
          name: instanceName,
          version: config.network?.version || '0.0.1',
          description: config.network?.description || '',
          port: resolvedPort,
          status: OlaneOSSystemStatus.STOPPED,
          pid: undefined,
        });
      } catch {
        /* best-effort cleanup */
      }
    },
    { timeout: 30_000 },
  );

  // Stay resident until SIGTERM/SIGINT.
  await new Promise<void>(() => {});
}
