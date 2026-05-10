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
  NetworkAttachParams,
  NetworkDetachParams,
  NetworkDiscoverAgentsResult,
  NetworkListParams,
  NetworkListResult,
  NetworkStartParams,
  NetworkStatusParams,
  NetworkStopParams,
} from './network-types.js';
import { LocalNetworkShellTool } from './local-network-shell.tool.js';

/** Internal record — the `NetworkInstance` plus the live provider handle. */
interface NetworkInstanceRecord {
  instance: NetworkInstance;
  /** E2B sandbox handle (e2b backend) OR the LocalNetworkShellTool
   *  instance (local backend). Opaque to callers; the broker uses it
   *  for cleanup at stop time. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providerHandle: any;
}

/**
 * Daemon hooks for the broker's `local` backend (Path B per ADR 0027).
 * Provided by `runOlaneOSHost` — it owns the OlaneOS instance and the
 * leader, so it can mount/unmount tool nodes for us.
 */
export interface NetworkBrokerDaemonHooks {
  /** Mount a tool node into the daemon's olane runtime. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerLocalTool: (node: any) => Promise<void>;
  /**
   * Best-effort tool-node teardown. The base olane runtime doesn't
   * expose `removeNode` today; implementations typically call
   * `node.stop()` and accept that the address remains in the registry
   * until daemon restart.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unregisterLocalTool: (node: any) => Promise<void>;
  /** Daemon leader's libp2p multiaddrs — used as `leaderAddress` for
   *  local-backend NetworkInstances (callers dial these to reach the
   *  per-network shell tool via olane routing). */
  getDaemonLeaderTransports: () => string[];
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
  /** Daemon-side hooks. Required for the `local` backend (used to
   *  mount LocalNetworkShellTool); ignored if every network you start
   *  uses the `e2b` backend. */
  daemonHooks?: NetworkBrokerDaemonHooks;
}

export class NetworkBrokerNode extends oLaneTool {
  private readonly brokerConfig: NetworkBrokerConfig;
  private readonly daemonHooks?: NetworkBrokerDaemonHooks;
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
            { name: 'backend', type: 'string', description: '`e2b` (default) or `local`', required: false },
            { name: 'cwd', type: 'string', description: 'Working directory for the local backend\'s shell', required: false },
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
        attach: {
          name: 'attach',
          description: 'Record an existing AgentNode session as a participant in this network.',
          parameters: [
            { name: 'networkId', type: 'string', description: 'Network instance id', required: true },
            { name: 'agentSessionId', type: 'string', description: 'Stable agent session id', required: true },
          ],
          dependencies: [],
        },
        detach: {
          name: 'detach',
          description: 'Remove an agent session from a network\'s attached list.',
          parameters: [
            { name: 'networkId', type: 'string', description: 'Network instance id', required: true },
            { name: 'agentSessionId', type: 'string', description: 'Stable agent session id', required: true },
          ],
          dependencies: [],
        },
        discoverAgents: {
          name: 'discoverAgents',
          description: 'List existing AgentNode sessions available to attach.',
          parameters: [],
          dependencies: [],
        },
      },
    });
    this.brokerConfig = {
      ...DEFAULT_NETWORK_BROKER_CONFIG,
      ...(config.broker || {}),
    };
    this.daemonHooks = config.daemonHooks;
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
    const backend: NetworkBackend = params.backend || 'e2b';
    if (backend !== 'e2b' && backend !== 'local') {
      throw new Error(
        `NetworkBrokerNode._tool_start: unknown backend '${backend}' (expected 'e2b' or 'local').`,
      );
    }
    if (backend === 'local' && !params.cwd) {
      throw new Error(
        'NetworkBrokerNode._tool_start: `cwd` is required when backend === "local".',
      );
    }
    if (backend === 'local' && !this.daemonHooks) {
      throw new Error(
        'NetworkBrokerNode._tool_start: backend === "local" requires daemonHooks to be ' +
          'configured. Pass `daemonHooks` to NetworkBrokerNode in `runOlaneOSHost`.',
      );
    }

    const active = this.activeCount();
    if (active >= this.brokerConfig.softCap) {
      throw new NetworkInstanceLimitExceededError(active, this.brokerConfig.softCap);
    }

    const id =
      (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) ||
      Math.random().toString(36).slice(2, 18);
    // Short id used to scope per-network tool addresses (avoids collisions
    // when multiple local-backend networks coexist in the same daemon).
    const shortId = id.slice(0, 8).replace(/-/g, '');
    const instanceId = id;
    const startedAt = new Date().toISOString();

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
      cwd: backend === 'local' ? params.cwd : undefined,
      registeredToolAddresses: [],
      attachedAgents: [],
      metadata: { ...(params.metadata || {}) },
    };
    this.instances.set(instanceId, {
      instance: reservedInstance,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providerHandle: null as any,
    });

    try {
      if (backend === 'e2b') {
        return await this.startE2B(instanceId, params, reservedInstance);
      }
      return await this.startLocal(instanceId, shortId, params, reservedInstance);
    } catch (err) {
      this.instances.set(instanceId, {
        instance: { ...reservedInstance, status: NetworkInstanceStatus.FAILED },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        providerHandle: null as any,
      });
      throw err;
    }
  }

  /** E2B backend — same path the libp2p-smoke validates end-to-end. */
  private async startE2B(
    instanceId: string,
    params: NetworkStartParams,
    reservedInstance: NetworkInstance,
  ): Promise<NetworkInstance> {
    const SandboxClass = await this.getSandboxClass();
    const template = params.e2bTemplate || this.brokerConfig.defaultE2bTemplate;
    const sandbox = await SandboxClass.create(template, {
      metadata: {
        olane_network_instance_id: instanceId,
        olane_network_name: params.name,
        olane_owner_user_id: params.ownerUserId,
        ...(params.metadata || {}),
      },
    });
    // Park the sandbox handle in the instances map IMMEDIATELY so that
    // any failure between here and the end-of-method records is cleaned
    // up by `_tool_start`'s catch.
    this.instances.set(instanceId, { instance: reservedInstance, providerHandle: sandbox });
    try {
      const sandboxId: string = sandbox.sandboxId || sandbox.id || '';
      if (!sandboxId) {
        throw new Error('NetworkBrokerNode.startE2B: e2b sandbox returned without an id.');
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
        registeredToolAddresses: ['o://shell'],
      };
      this.instances.set(instanceId, { instance: ready, providerHandle: sandbox });
      return ready;
    } catch (err) {
      // Best-effort cleanup of the spawned sandbox before letting the
      // outer catch mark FAILED.
      try {
        if (sandbox && typeof sandbox.kill === 'function') {
          await sandbox.kill();
        }
      } catch {
        /* best-effort */
      }
      throw err;
    }
  }

  /** Local backend — mount a LocalNetworkShellTool in the daemon's
   *  runtime; cwd binds to the user-specified folder. */
  private async startLocal(
    instanceId: string,
    shortId: string,
    params: NetworkStartParams,
    reservedInstance: NetworkInstance,
  ): Promise<NetworkInstance> {
    const hooks = this.daemonHooks!;
    const cwd = params.cwd!;
    const shellAddress = `o://shell-${shortId}`;
    const shellTool = new LocalNetworkShellTool({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      address: new oAddress(shellAddress) as any,
      // The local shell is a child of the daemon's leader. Parent +
      // leader fields populated by `addNode` once mounted; we don't need
      // to wire them at construction time.
      cwd,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await hooks.registerLocalTool(shellTool);

    const transports = hooks.getDaemonLeaderTransports();
    // Pick the first non-loopback transport if available; else first.
    const leaderAddress =
      transports.find((t) => !t.includes('/127.0.0.1/')) || transports[0] || '';

    const ready: NetworkInstance = {
      ...reservedInstance,
      status: NetworkInstanceStatus.RUNNING,
      leaderAddress,
      relayAddress: undefined,
      providerSessionId: shellAddress,
      registeredToolAddresses: [shellAddress],
    };
    this.instances.set(instanceId, { instance: ready, providerHandle: shellTool });
    return ready;
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
      if (rec.instance.backend === 'e2b') {
        if (rec.providerHandle && typeof rec.providerHandle.kill === 'function') {
          await rec.providerHandle.kill();
        }
      } else if (rec.instance.backend === 'local') {
        if (this.daemonHooks && rec.providerHandle) {
          await this.daemonHooks.unregisterLocalTool(rec.providerHandle);
        }
      }
      rec.instance.status = NetworkInstanceStatus.STOPPED;
      rec.instance.stoppedAt = new Date().toISOString();
      this.instances.set(params.id, {
        instance: rec.instance,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        providerHandle: null as any,
      });
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

  // ─── _tool_attach ────────────────────────────────────────────────────

  /**
   * Record an existing AgentNode session as a participant in this network.
   * The agent is already addressable on `o://agent-…` (registered there
   * by `runAgentDaemon`); attach() is purely a logical grouping that lets
   * `list()` show network membership and lets the front-end fan-out
   * messages via `AgentBroker.send` to all attached agents.
   *
   * Idempotent: re-attaching the same agent is a no-op.
   */
  async _tool_attach(
    arg: NetworkAttachParams | { params: NetworkAttachParams },
  ) {
    const params = unwrapParams(arg);
    if (!params?.networkId || !params?.agentSessionId) {
      throw new Error(
        'NetworkBrokerNode._tool_attach: `networkId` and `agentSessionId` are required.',
      );
    }
    const rec = this.instances.get(params.networkId);
    if (!rec) {
      throw new NetworkInstanceNotFoundError(params.networkId);
    }
    if (!rec.instance.attachedAgents.includes(params.agentSessionId)) {
      rec.instance.attachedAgents = [
        ...rec.instance.attachedAgents,
        params.agentSessionId,
      ];
    }
    return {
      ok: true,
      networkId: params.networkId,
      agentSessionId: params.agentSessionId,
      attachedAgents: rec.instance.attachedAgents,
    };
  }

  // ─── _tool_detach ────────────────────────────────────────────────────

  async _tool_detach(
    arg: NetworkDetachParams | { params: NetworkDetachParams },
  ) {
    const params = unwrapParams(arg);
    if (!params?.networkId || !params?.agentSessionId) {
      throw new Error(
        'NetworkBrokerNode._tool_detach: `networkId` and `agentSessionId` are required.',
      );
    }
    const rec = this.instances.get(params.networkId);
    if (!rec) {
      throw new NetworkInstanceNotFoundError(params.networkId);
    }
    rec.instance.attachedAgents = rec.instance.attachedAgents.filter(
      (id) => id !== params.agentSessionId,
    );
    return {
      ok: true,
      networkId: params.networkId,
      agentSessionId: params.agentSessionId,
      attachedAgents: rec.instance.attachedAgents,
    };
  }

  // ─── _tool_discoverAgents ────────────────────────────────────────────

  /**
   * List existing AgentNode sessions on the daemon. Implemented as
   * `useSelf({address: 'o://agents', method: 'list', params: {}})`
   * — the registry is in the same daemon, so we route via the parent
   * leader. Caller-side filtering by `kind` (e.g. claude-code) is
   * encouraged but not enforced here.
   */
  async _tool_discoverAgents(): Promise<NetworkDiscoverAgentsResult> {
    try {
      // Cast — `use` is not strictly typed on the base oLaneTool
      // surface, but it exists at runtime. Same pattern as how
      // `agent-broker.ts` uses withOlaneClient externally; here we're
      // routing via the same leader, so we use the framework's own
      // dispatch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const self = this as any;
      const raw = await self.use(new oAddress('o://agents'), {
        method: 'list',
        params: {},
      });
      const inner = (raw as { result?: { data?: { entries?: unknown[] } } })?.result;
      const entries = (inner?.data?.entries as unknown[]) || [];
      return { entries };
    } catch (err) {
      // If o://agents isn't registered (no agents have been started),
      // return an empty list rather than failing the call.
      if (err instanceof Error && /not found|not registered|no.*agents/i.test(err.message)) {
        return { entries: [] };
      }
      throw err;
    }
  }
}
