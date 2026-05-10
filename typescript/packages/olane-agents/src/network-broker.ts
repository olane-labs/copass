/**
 * NetworkBroker — TS wrapper that calls the in-daemon `o://networks`
 * tool over libp2p (ADR 0027 Phase 1).
 *
 * Mirrors `AgentBroker`'s shape — both wrap `withOlaneClient(use => …)`
 * and unwrap the JSON-RPC envelope. Front-ends (CLI, MCP server, hooks)
 * import this rather than constructing libp2p clients themselves.
 *
 * The daemon-side counterpart is `NetworkBrokerNode` (registered at
 * `o://networks` in `runOlaneOSHost`).
 */

import { withOlaneClient } from './olane-client.js';
import { NetworkInstanceStatus } from './network-types.js';
import type {
  NetworkInstance,
  NetworkListResult,
} from './network-types.js';

/** Options for `NetworkBroker.start`. */
export interface BrokerStartOptions {
  /** Human-friendly name for the network instance. */
  name: string;
  /** Calling user id (from CLI auth context). */
  ownerUserId: string;
  /** Override the default broker template (E2B). */
  e2bTemplate?: string;
  /** Free-form metadata stamped on the instance for cost attribution. */
  metadata?: Record<string, string>;
}

/** Options for `NetworkBroker.list`. */
export interface BrokerListFilter {
  status?: NetworkInstanceStatus;
  ownerUserId?: string;
}

function unwrapResult<T>(raw: unknown): T {
  // The olane RPC envelope shape — verified end-to-end via
  // `o-private-network/nodes/compute-sandbox/smoke/v0-libp2p-smoke.ts`:
  //   {jsonrpc, id, result: {id, data: <T>, success, _last, …}}
  // Be tolerant of older clients/servers that omit the JSON-RPC outer.
  const inner =
    (raw as { result?: { data?: T } })?.result ??
    (raw as { data?: T });
  const data = (inner as { data?: T })?.data ?? (inner as T);
  return data as T;
}

export class NetworkBroker {
  /**
   * Provision a new network instance. Returns the populated
   * `NetworkInstance` (status RUNNING + leader/relay multiaddrs filled in).
   *
   * Throws `NetworkInstanceLimitExceededError` if the daemon's soft cap
   * is hit, and any provider-level error if the broker sandbox fails to
   * boot. The thrown error names are surfaced from the daemon-side
   * `NetworkBrokerNode` — front-ends can introspect via `error.name`.
   */
  async start(options: BrokerStartOptions): Promise<NetworkInstance> {
    const raw = await withOlaneClient(async (use) => {
      return await use('o://networks', {
        method: 'start',
        params: {
          name: options.name,
          ownerUserId: options.ownerUserId,
          e2bTemplate: options.e2bTemplate,
          metadata: options.metadata,
        },
      });
    });
    return unwrapResult<NetworkInstance>(raw);
  }

  /** Tear down a network instance by id. */
  async stop(id: string): Promise<{ ok: boolean; id: string }> {
    const raw = await withOlaneClient(async (use) => {
      return await use('o://networks', {
        method: 'stop',
        params: { id },
      });
    });
    return unwrapResult<{ ok: boolean; id: string }>(raw);
  }

  /** List all instances on the running daemon. */
  async list(filter: BrokerListFilter = {}): Promise<NetworkInstance[]> {
    const raw = await withOlaneClient(async (use) => {
      return await use('o://networks', {
        method: 'list',
        params: filter as Record<string, unknown>,
      });
    });
    const result = unwrapResult<NetworkListResult>(raw);
    return result?.instances || [];
  }

  /** Look up one instance by id. */
  async status(id: string): Promise<NetworkInstance> {
    const raw = await withOlaneClient(async (use) => {
      return await use('o://networks', {
        method: 'status',
        params: { id },
      });
    });
    return unwrapResult<NetworkInstance>(raw);
  }
}
