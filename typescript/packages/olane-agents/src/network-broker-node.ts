/**
 * NetworkBrokerNode — the in-daemon olane tool at `o://networks` that
 * owns the lifecycle of `NetworkInstance`s — ADR 0027 Phase 1.
 *
 * Mounted by `runOlaneOSHost` after the relay; lives for the lifetime
 * of the OS process. Exposes `_tool_start / _tool_stop / _tool_list /
 * _tool_status` — callers reach it via `o://networks` over libp2p
 * (CLI / MCP / hooks → `withOlaneClient(use => use('o://networks', …))`).
 *
 * Provisioning path (V0 ship per ADR 0027 + 0024):
 *   - `start` calls `Sandbox.create('olane-compute-sandbox')` from the
 *     `e2b` SDK. The template is the broker image registered out of
 *     `o-private-network/nodes/compute-sandbox/e2b.Dockerfile`.
 *   - The broker writes `LEADER_MULTIADDR=…` and `RELAY_MULTIADDR=…`
 *     to `/app/sandbox-multiaddr.txt` at boot. We read that file via
 *     `sandbox.commands.run('cat …')` to learn the peer-ids and
 *     construct the dialable multiaddrs (E2B HTTPS-proxy form:
 *     `/dns4/<port>-<sandbox-id>.e2b.app/tcp/443/tls/ws/p2p/<peer-id>`).
 *
 * What this node does NOT do at MVP (intentional, per ADR 0027):
 *   - No persistence — state wiped on daemon stop.
 *   - No libp2p-layer auth — Phase 3 work (see `o-private-network/
 *     nodes/leader/src/olane-leader.tool.ts` for the `oTokenManager`
 *     pattern Phase 3 reuses).
 *   - No docker-local backend — `LocalConfig.backend = "docker"` is
 *     reserved for a follow-up; today we only spin via E2B.
 *   - No Python LocalComputeProvider subprocess — the provisioning is
 *     direct E2B SDK from this node, since the only path that exists
 *     today goes E2B-direct anyway.
 *
 * Cap behavior:
 *   - Soft cap of 100 instances per daemon (per ADR 0027 §Rate-Limit).
 *   - Cap is in-process, NOT cross-process — multiple daemons on the
 *     same host each have their own cap (single-tenant per daemon is
 *     the MVP threat model).
 */

import { oAddress } from '@olane/o-core';
import { oLaneTool } from '@olane/o-lane';
import type { oNodeConfig } from '@olane/o-node';
import {
  DEFAULT_NETWORK_BROKER_CONFIG,
  NetworkInstanceLimitExceededError,
  NetworkInstanceNotFoundError,
  NetworkInstanceStatus,
} from './network-types.js';
import type {
  NetworkBackend,
  NetworkBrokerConfig,
  NetworkInstance,
  NetworkListParams,
  NetworkListResult,
  NetworkStartParams,
  NetworkStatusParams,
  NetworkStopParams,
} from './network-types.js';

/** Internal record — the `NetworkInstance` plus the live provider handle. */
interface NetworkInstanceRecord {
  instance: NetworkInstance;
  /** E2B sandbox handle. Opaque `unknown` so this file doesn't pin a
   *  specific e2b SDK version at compile time — callers cast on use. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any;
}

/**
 * Helper: olane RPC framework passes `{...request.toJSON(), stream}`
 * to `_tool_*` methods. Tools that want their typed input must dig
 * `arg.params`. Same fall-through pattern as the broker's shell tool
 * (`o-private-network/nodes/compute-sandbox/src/shell.tool.ts`).
 */
function unwrapParams<T>(arg: T | { params: T }): T {
  if (
    arg &&
    typeof arg === 'object' &&
    'params' in (arg as { params?: unknown })
  ) {
    return (arg as { params: T }).params;
  }
  return arg as T;
}

export interface NetworkBrokerNodeConfig extends oNodeConfig {
  /** Optional broker config overrides — falls back to
   *  `DEFAULT_NETWORK_BROKER_CONFIG`. */
  broker?: Partial<NetworkBrokerConfig>;
}

export class NetworkBrokerNode extends oLaneTool {
  private readonly brokerConfig: NetworkBrokerConfig;
  private readonly instances = new Map<string, NetworkInstanceRecord>();
  // Lazy-loaded e2b SDK — keeps this module importable in environments
  // that don't have the e2b package installed (the dep is declared at
  // the package level but late-binding avoids a hard import at boot).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private e2bSandboxClass: any | null = null;

  constructor(config: NetworkBrokerNodeConfig) {
    super({
      ...config,
      address: config.address || new oAddress('o://networks'),
      description:
        'Lifecycle envelope for user-managed olane network instances ' +
        '(ADR 0027). Provisions broker sandboxes via the configured ' +
        'backend (E2B at MVP) and tracks them in-memory until daemon stop.',
      methods: {
        start: {
          name: 'start',
          description:
            'Provision a new network broker instance and return its ' +
            'leader/relay multiaddrs.',
          parameters: [
            { name: 'name', type: 'string', description: 'Human-friendly name', required: true },
            { name: 'ownerUserId', type: 'string', description: 'Calling user id', required: true },
            { name: 'e2bTemplate', type: 'string', description: 'Override broker template name', required: false },
            { name: 'metadata', type: 'object', description: 'Cost-attribution tags', required: false },
          ],
          dependencies: [],
        },
        stop: {
          name: 'stop',
          description: 'Tear down a network instance by id.',
          parameters: [
            { name: 'id', type: 'string', description: 'Instance id from start()', required: true },
          ],
          dependencies: [],
        },
        list: {
          name: 'list',
          description: 'List all active network instances on this daemon.',
          parameters: [
            { name: 'status', type: 'string', description: 'Filter by lifecycle state', required: false },
            { name: 'ownerUserId', type: 'string', description: 'Filter by owner', required: false },
          ],
          dependencies: [],
        },
        status: {
          name: 'status',
          description: 'Return one network instance by id.',
          parameters: [
            { name: 'id', type: 'string', description: 'Instance id from start()', required: true },
          ],
          dependencies: [],
        },
      },
    });
    this.brokerConfig = {
      ...DEFAULT_NETWORK_BROKER_CONFIG,
      ...(config.broker || {}),
    };
  }

  /** Number of currently-allocated instances (any non-terminal status). */
  private activeCount(): number {
    let n = 0;
    for (const rec of this.instances.values()) {
      if (
        rec.instance.status !== NetworkInstanceStatus.STOPPED &&
        rec.instance.status !== NetworkInstanceStatus.FAILED
      ) {
        n++;
      }
    }
    return n;
  }

  /** Lazy-load the e2b SDK. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getSandboxClass(): Promise<any> {
    if (this.e2bSandboxClass) return this.e2bSandboxClass;
    try {
      const mod = await import('e2b');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.e2bSandboxClass = (mod as any).Sandbox;
    } catch (err) {
      throw new Error(
        'NetworkBrokerNode: the `e2b` package is required for the e2b ' +
          'backend but is not installed. Add it as a dependency of the ' +
          'host package.',
      );
    }
    return this.e2bSandboxClass;
  }

  /**
   * Read `/app/sandbox-multiaddr.txt` from a freshly-spawned sandbox
   * and parse the LEADER + RELAY multiaddrs from it.
   *
   * The broker writes the file at boot per ADR 0027 (the file surface
   * exists because the E2B SDK exec sessions can't reach PID 1's stdout).
   * We poll until the file appears or the boot timeout expires.
   */
  private async readBrokerMultiaddrs(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sandbox: any,
  ): Promise<{ leaderPeerId: string; relayPeerId?: string }> {
    const deadline = Date.now() + this.brokerConfig.bootTimeoutMs;
    while (Date.now() < deadline) {
      const result = await sandbox.commands.run(
        'cat /app/sandbox-multiaddr.txt 2>/dev/null',
        { timeoutMs: 3_000 },
      );
      const stdout = (result?.stdout || '').trim();
      if (stdout) {
        const leaderMatch = stdout.match(/^LEADER_MULTIADDR=.*\/p2p\/([A-Za-z0-9]+)$/m);
        const relayMatch = stdout.match(/^RELAY_MULTIADDR=.*\/p2p\/([A-Za-z0-9]+)$/m);
        if (leaderMatch) {
          return {
            leaderPeerId: leaderMatch[1],
            relayPeerId: relayMatch?.[1],
          };
        }
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error(
      `NetworkBrokerNode: broker did not write LEADER_MULTIADDR= within ` +
        `${this.brokerConfig.bootTimeoutMs}ms. Sandbox may have failed to boot.`,
    );
  }

  // ─── _tool_start ─────────────────────────────────────────────────────

  async _tool_start(arg: NetworkStartParams | { params: NetworkStartParams }) {
    const params = unwrapParams(arg);
    if (!params?.name || !params?.ownerUserId) {
      throw new Error(
        'NetworkBrokerNode._tool_start: `name` and `ownerUserId` are required.',
      );
    }

    const active = this.activeCount();
    if (active >= this.brokerConfig.softCap) {
      throw new NetworkInstanceLimitExceededError(active, this.brokerConfig.softCap);
    }

    const id = (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) || '';
    if (!id) {
      // Node 18+ has globalThis.crypto.randomUUID; fall back to Math.random
      // (acceptable for in-memory ids that don't leave the daemon).
    }
    const instanceId = id || Math.random().toString(36).slice(2, 18);
    const startedAt = new Date().toISOString();
    const template = params.e2bTemplate || this.brokerConfig.defaultE2bTemplate;
    const backend: NetworkBackend = 'e2b';

    // Reserve a slot eagerly with PROVISIONING status so concurrent
    // start() calls see the count.
    const reservedInstance: NetworkInstance = {
      id: instanceId,
      name: params.name,
      ownerUserId: params.ownerUserId,
      status: NetworkInstanceStatus.PROVISIONING,
      startedAt,
      stoppedAt: null,
      leaderAddress: '',
      relayAddress: undefined,
      backend,
      providerSessionId: '',
      registeredToolAddresses: ['o://shell'],
      metadata: { ...(params.metadata || {}) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.instances.set(instanceId, { instance: reservedInstance, sandbox: null as any });

    try {
      const SandboxClass = await this.getSandboxClass();
      const sandbox = await SandboxClass.create(template, {
        metadata: {
          olane_network_instance_id: instanceId,
          olane_network_name: params.name,
          olane_owner_user_id: params.ownerUserId,
          ...(params.metadata || {}),
        },
      });
      const sandboxId: string = sandbox.sandboxId || sandbox.id || '';
      if (!sandboxId) {
        throw new Error(
          'NetworkBrokerNode._tool_start: e2b sandbox returned without an id.',
        );
      }

      const { leaderPeerId, relayPeerId } = await this.readBrokerMultiaddrs(sandbox);

      const leaderHost: string = sandbox.getHost(this.brokerConfig.leaderPortWs);
      const relayHost: string | undefined = relayPeerId
        ? sandbox.getHost(this.brokerConfig.relayPortWs)
        : undefined;

      const leaderAddress = `/dns4/${leaderHost}/tcp/443/tls/ws/p2p/${leaderPeerId}`;
      const relayAddress =
        relayHost && relayPeerId
          ? `/dns4/${relayHost}/tcp/443/tls/ws/p2p/${relayPeerId}`
          : undefined;

      const ready: NetworkInstance = {
        ...reservedInstance,
        status: NetworkInstanceStatus.RUNNING,
        leaderAddress,
        relayAddress,
        providerSessionId: sandboxId,
      };
      this.instances.set(instanceId, { instance: ready, sandbox });
      return ready;
    } catch (err) {
      // Mark FAILED + try to clean up the sandbox if it spawned.
      const rec = this.instances.get(instanceId);
      if (rec?.sandbox && typeof rec.sandbox.kill === 'function') {
        try {
          await rec.sandbox.kill();
        } catch {
          /* best-effort */
        }
      }
      this.instances.set(instanceId, {
        instance: { ...reservedInstance, status: NetworkInstanceStatus.FAILED },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sandbox: null as any,
      });
      throw err;
    }
  }

  // ─── _tool_stop ──────────────────────────────────────────────────────

  async _tool_stop(arg: NetworkStopParams | { params: NetworkStopParams }) {
    const params = unwrapParams(arg);
    if (!params?.id) {
      throw new Error('NetworkBrokerNode._tool_stop: `id` is required.');
    }
    const rec = this.instances.get(params.id);
    if (!rec) {
      throw new NetworkInstanceNotFoundError(params.id);
    }

    rec.instance.status = NetworkInstanceStatus.STOPPING;
    try {
      if (rec.sandbox && typeof rec.sandbox.kill === 'function') {
        await rec.sandbox.kill();
      }
      rec.instance.status = NetworkInstanceStatus.STOPPED;
      rec.instance.stoppedAt = new Date().toISOString();
      // Drop the live handle but keep the record so list() can show
      // recently-stopped entries until the next daemon restart.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.instances.set(params.id, { instance: rec.instance, sandbox: null as any });
      return { ok: true, id: params.id };
    } catch (err) {
      rec.instance.status = NetworkInstanceStatus.FAILED;
      throw err;
    }
  }

  // ─── _tool_list ──────────────────────────────────────────────────────

  async _tool_list(
    arg: NetworkListParams | { params: NetworkListParams } = {} as NetworkListParams,
  ): Promise<NetworkListResult> {
    const params = unwrapParams(arg);
    let instances = Array.from(this.instances.values()).map((r) => r.instance);
    if (params?.status) {
      instances = instances.filter((i) => i.status === params.status);
    }
    if (params?.ownerUserId) {
      instances = instances.filter((i) => i.ownerUserId === params.ownerUserId);
    }
    return { count: instances.length, instances };
  }

  // ─── _tool_status ────────────────────────────────────────────────────

  async _tool_status(
    arg: NetworkStatusParams | { params: NetworkStatusParams },
  ): Promise<NetworkInstance> {
    const params = unwrapParams(arg);
    if (!params?.id) {
      throw new Error('NetworkBrokerNode._tool_status: `id` is required.');
    }
    const rec = this.instances.get(params.id);
    if (!rec) {
      throw new NetworkInstanceNotFoundError(params.id);
    }
    return rec.instance;
  }
}
