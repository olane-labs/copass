/**
 * Type contract for the network-instance broker — ADR 0027 Phase 1.
 *
 * A `NetworkInstance` is the lifecycle envelope that the user manages
 * via `copass networks {start,stop,list,status}`. Each instance wraps:
 *   - a compute-sandbox process (the broker itself — leader + relay +
 *     shell, per `o-private-network/nodes/compute-sandbox/`)
 *   - the broker's libp2p multiaddrs (leader + relay)
 *   - lifecycle state (id, name, status, started_at, etc.)
 *
 * Shape mirrors the Python `NetworkInstance` dataclass at
 * `frame_graph/copass_id/agents/compute/network_instance.py` so the
 * Python LocalComputeProvider (when wired in a follow-up) and the TS
 * NetworkBrokerNode see the same data shape across the language
 * boundary.
 */

/** Lifecycle states. Mirrors `NetworkInstanceStatus` (Python). */
export enum NetworkInstanceStatus {
  PROVISIONING = 'provisioning',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  FAILED = 'failed',
}

/**
 * Backend that fulfills a network instance.
 *   - `e2b` — spawn the broker template (`olane-compute-sandbox`) on E2B
 *     and dial via E2B's HTTPS-WS proxy.
 *   - `local` — mount a `LocalNetworkShellTool` in the daemon's own
 *     olane runtime, with cwd bound to the user-specified folder.
 *     No separate process; reaches the daemon's existing leader.
 */
export type NetworkBackend = 'e2b' | 'local';

/**
 * The wire shape exchanged between the broker tool, the TS wrapper,
 * and (later) the Python LocalComputeProvider. ALL fields of the
 * long-term schema are defined; MVP populates only the lifecycle subset
 * (id, name, ownerUserId, status, startedAt, leaderAddress, relayAddress).
 */
export interface NetworkInstance {
  /** Daemon-issued identifier. Stable within the daemon's lifetime;
   *  not persisted across daemon restarts (in-memory by design). */
  id: string;
  /** Human-friendly name supplied by the caller. */
  name: string;
  /** Caller's user id (from CLI auth). */
  ownerUserId: string;
  /** Current lifecycle state. */
  status: NetworkInstanceStatus;
  /** ISO timestamp when provisioning began. */
  startedAt: string;
  /** ISO timestamp when stop was called. Null while alive. */
  stoppedAt?: string | null;
  /**
   * Leader libp2p multiaddr — application-layer dial target.
   *   - `e2b` backend: the spawned sandbox's leader, exposed via E2B's
   *     HTTPS-WS proxy:
   *     /dns4/4016-<sandbox-id>.e2b.app/tcp/443/tls/ws/p2p/<leader-peer-id>
   *   - `local` backend: the running daemon's own leader (single-process
   *     architecture). Callers in the same daemon can `o://shell-<id>`
   *     directly; external callers dial the daemon's leader transports.
   */
  leaderAddress: string;
  /**
   * Relay libp2p multiaddr — circuit-relay-v2 reservation target.
   * Only populated for `e2b` backend at MVP.
   */
  relayAddress?: string;
  /** Backend that fulfilled this instance. */
  backend: NetworkBackend;
  /**
   * Backend-specific session handle.
   *   - `e2b`: the sandbox id.
   *   - `local`: the LocalNetworkShellTool's address (e.g. `o://shell-<id>`).
   */
  providerSessionId: string;
  /**
   * Working directory the local-backend shell tool spawns commands in.
   * Only populated for `local` backend. The full point of the local
   * backend is for the user to run commands in their project folder —
   * this field IS that folder.
   */
  cwd?: string;
  /** Tools currently registered against this network's broker.
   *  MVP: just the shell tool address. */
  registeredToolAddresses: string[];
  /**
   * Existing Claude Code (or other AgentNode) sessions attached to
   * this network — recorded by `attach()`. Routing is unchanged
   * (the agents are already on `o://agent-…` in the same daemon);
   * the network is just a logical grouping that lets the user see
   * them together and message-fan-out via AgentBroker.send.
   * Each entry is the agent's stable session id.
   */
  attachedAgents: string[];
  /** Free-form metadata — cost-attribution tags etc. Reserved. */
  metadata: Record<string, string>;
}

/** Input for `o://networks.start`. */
export interface NetworkStartParams {
  name: string;
  ownerUserId: string;
  /** Backend choice. Default: `e2b`. Use `local` to mount a shell tool
   *  in the daemon's own runtime with cwd=<your folder>. */
  backend?: NetworkBackend;
  /** Working directory for the `local` backend's shell. Required when
   *  backend === 'local'. Ignored for `e2b`. */
  cwd?: string;
  /** Override the default broker template for E2B. Defaults to
   *  `olane-compute-sandbox`. Ignored for `local`. */
  e2bTemplate?: string;
  /** Free-form metadata stamped on the instance for cost attribution. */
  metadata?: Record<string, string>;
}

/** Input for `o://networks.attach` — record an existing AgentNode session
 *  as a participant in this network. Routing is unchanged; this just
 *  groups the agent under the network in `list()` output. */
export interface NetworkAttachParams {
  /** Network instance id. */
  networkId: string;
  /** Stable session id of the agent (matches AgentBroker session files). */
  agentSessionId: string;
}

/** Input for `o://networks.detach` — remove an agent from a network's
 *  attached list. Does NOT stop the agent itself. */
export interface NetworkDetachParams {
  networkId: string;
  agentSessionId: string;
}

/** Output of `o://networks.discoverAgents` — proxies o://agents.list
 *  so callers can see what's available to attach. Caller-side filtering
 *  by `kind` (e.g. claude-code) is recommended. */
export interface NetworkDiscoverAgentsResult {
  /** Raw RegistryEntry list from o://agents.list. Opaque to the
   *  network broker; passes through verbatim. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entries: any[];
}

/** Input for `o://networks.stop`. */
export interface NetworkStopParams {
  id: string;
}

/** Input for `o://networks.status`. */
export interface NetworkStatusParams {
  id: string;
}

/** Input for `o://networks.list`. */
export interface NetworkListParams {
  /** Filter by status. */
  status?: NetworkInstanceStatus;
  /** Filter by owner. */
  ownerUserId?: string;
}

/** Output of `o://networks.list`. */
export interface NetworkListResult {
  count: number;
  instances: NetworkInstance[];
}

/** Configurable knobs for the broker — defaults baked into the node. */
export interface NetworkBrokerConfig {
  /** Soft cap on concurrent network instances per daemon. ADR 0027 §Rate-Limit. */
  softCap: number;
  /** Default E2B template name. */
  defaultE2bTemplate: string;
  /** WebSocket port the broker exposes for HTTPS-proxy dialing.
   *  Matches `LEADER_PORT_WS` in the broker's e2b.Dockerfile. */
  leaderPortWs: number;
  /** WebSocket port for the relay. Matches `RELAY_PORT_WS`. */
  relayPortWs: number;
  /** Maximum time to wait for the broker's multiaddr file. */
  bootTimeoutMs: number;
}

export const DEFAULT_NETWORK_BROKER_CONFIG: NetworkBrokerConfig = {
  softCap: 100, // per ADR 0027 §Rate-Limit (user-confirmed default)
  defaultE2bTemplate: 'olane-compute-sandbox',
  leaderPortWs: 4016,
  relayPortWs: 4018,
  bootTimeoutMs: 30_000,
};

/** Thrown when the soft cap is exceeded. Caller decides whether to retry. */
export class NetworkInstanceLimitExceededError extends Error {
  readonly current: number;
  readonly cap: number;
  constructor(current: number, cap: number) {
    super(
      `Cannot start network instance: ${current} active >= soft cap ${cap}. ` +
        `Stop an existing instance or raise the cap (NetworkBrokerConfig.softCap).`,
    );
    this.name = 'NetworkInstanceLimitExceededError';
    this.current = current;
    this.cap = cap;
  }
}

/** Thrown when an instance id is unknown to the broker. */
export class NetworkInstanceNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`No network instance with id="${id}" — it may have been stopped or never existed.`);
    this.name = 'NetworkInstanceNotFoundError';
    this.id = id;
  }
}
