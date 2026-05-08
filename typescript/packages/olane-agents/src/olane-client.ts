/**
 * Transient libp2p client helper.
 *
 * Each one-shot caller (CLI invocation, hook script, MCP shellout) calls
 * `withOlaneClient(use => …)`. We resolve the running OS instance via
 * `@olane/os`'s canonical `ConfigManager` layout (instance.config.json
 * holds peerId + transports), boot a tiny `oClientNode` against the
 * leader, hand the caller a `use(target, params)` function that proxies
 * to `clientNode.use()`, then tear down.
 *
 * Cold-start cost is ~1-2 s per invocation (libp2p init dominates).
 * Acceptable for SessionStart/SessionEnd hooks; if Stop-hook latency
 * proves annoying we replace this with a UDS / HTTP shim against the
 * running OS host (Phase 1.4 idea, not currently scheduled).
 */

import { oAddress } from '@olane/o-core';
import { oClientNode, oNodeAddress, oNodeTransport } from '@olane/o-node';
import { ConfigManager, listOS, statusOS } from '@olane/os';

export type UseFn = (
  target: oAddress | string,
  params: { method: string; params?: Record<string, unknown> },
) => Promise<any>;

export class OlaneOSNotRunningError extends Error {
  constructor(
    message = 'Olane OS is not running. Start it with `copass os start` (or call `OlaneOSManager.start()` from your app).',
  ) {
    super(message);
    this.name = 'OlaneOSNotRunningError';
  }
}

interface ResolvedOs {
  instanceName: string;
  leaderAddress: string;
  peerId: string;
  transports: string[];
}

/**
 * Find a running OS to dial. If `instanceName` is provided, looks it up
 * directly; otherwise picks the first live instance from
 * `ConfigManager.listOSInstances()`.
 */
async function resolveRunningOs(instanceName?: string): Promise<ResolvedOs> {
  if (instanceName) {
    const status = await statusOS(instanceName);
    if (!status?.alive || !status.config?.peerId || !status.config.transports?.length) {
      throw new OlaneOSNotRunningError(
        `Olane OS instance "${instanceName}" is not running.`,
      );
    }
    return {
      instanceName,
      leaderAddress: 'o://leader',
      peerId: status.config.peerId,
      transports: status.config.transports,
    };
  }

  let all: Awaited<ReturnType<typeof listOS>>;
  try {
    all = await listOS();
  } catch {
    // listOS reads + JSON-parses every os-instances config file; an empty
    // or malformed file from a prior aborted run shouldn't block us.
    all = [];
  }
  const live = (all || []).filter(
    (entry) =>
      entry.alive && entry.config?.peerId && entry.config.transports?.length,
  );
  if (live.length === 0) {
    throw new OlaneOSNotRunningError();
  }
  // Prefer the most-recently-started instance.
  const chosen = live.sort((a, b) => {
    const at = a.config.createdAt ? Date.parse(a.config.createdAt) : 0;
    const bt = b.config.createdAt ? Date.parse(b.config.createdAt) : 0;
    return bt - at;
  })[0];
  return {
    instanceName: chosen.config.name,
    leaderAddress: 'o://leader',
    peerId: chosen.config.peerId!,
    transports: chosen.config.transports!,
  };
}

export interface WithOlaneClientOptions {
  /** Target a specific OS instance by name. Defaults to the first live one. */
  instanceName?: string;
}

/**
 * Boot a transient client, hand it to `fn`, then tear it down. Always
 * stops the client even if `fn` throws.
 */
export async function withOlaneClient<T>(
  fn: (use: UseFn) => Promise<T>,
  options: WithOlaneClientOptions = {},
): Promise<T> {
  const target = await resolveRunningOs(options.instanceName);

  const leaderAddress = new oNodeAddress(
    target.leaderAddress,
    target.transports.map((m) => new oNodeTransport(m)),
  );

  const clientId = Math.random().toString(36).slice(2, 10);
  const client = new oClientNode({
    address: new oNodeAddress(`o://cli-${clientId}`),
    leader: leaderAddress,
    parent: null,
  } as any);

  await client.start();
  try {
    const use: UseFn = async (t, params) => {
      const addr = typeof t === 'string' ? new oAddress(t) : t;
      return await (client as any).use(addr, params);
    };
    return await fn(use);
  } finally {
    try {
      await client.stop();
    } catch {
      /* best-effort */
    }
  }
}

// Re-export ConfigManager helpers callers may want.
export { ConfigManager };
