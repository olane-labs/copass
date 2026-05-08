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

export interface RunOlaneOSHostOptions {
  /** OS instance name — typically the user's Copass ID or unix username. */
  instanceName: string;
  /** Optional explicit port. Auto-assigned starting at 4999 if omitted. */
  port?: number;
  /** Skip the network-wide indexing on startup. Defaults to `true`. */
  noIndexNetwork?: boolean;
  /** Optional Copass token manager — destroyed on graceful shutdown. */
  tokenManager?: { destroy?: () => Promise<void> } | null;
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

  setupGracefulShutdown(
    async () => {
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
