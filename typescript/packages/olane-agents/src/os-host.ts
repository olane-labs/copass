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
  };
}

/**
 * Resolve gateway options from explicit options + env fallbacks.
 * Returns null when gateway registration is disabled or not configured.
 */
function resolveGatewayOptions(
  opts: RunOlaneOSHostOptions,
): GatewayRegistrarOptions | null {
  if (opts.gateway?.enabled === false) return null;
  const gatewayMultiaddr =
    opts.gateway?.gatewayMultiaddr ?? process.env.GATEWAY_MULTIADDR ?? '';
  const userId = opts.gateway?.userId ?? process.env.GATEWAY_USER_ID ?? '';
  if (!gatewayMultiaddr || !userId) return null;
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
  return {
    gatewayMultiaddr,
    userId,
    daemonId,
    capabilities,
    metadata: opts.gateway?.metadata,
    heartbeatMs,
    log: opts.gateway?.log,
  };
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
  const gatewayOptions = resolveGatewayOptions(options);
  let gatewayHandle: RegisteredGatewayHandle | null = null;
  if (gatewayOptions) {
    try {
      gatewayHandle = await registerWithGateway(os, gatewayOptions);
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
