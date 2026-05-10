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

/** Backend that fulfills a network instance. MVP supports `e2b` only. */
export type NetworkBackend = 'e2b' | 'docker';

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
   * Leader libp2p multiaddr — application-layer dial target (callers
   * use this for `o://shell.exec`, `register_leader`, etc.).
   * Example E2B form:
   *   /dns4/4016-<sandbox-id>.e2b.app/tcp/443/tls/ws/p2p/<leader-peer-id>
   */
  leaderAddress: string;
  /**
   * Relay libp2p multiaddr — circuit-relay-v2 reservation target.
   * Distinct peer-id from leaderAddress. Optional for MVP.
   * Example E2B form:
   *   /dns4/4018-<sandbox-id>.e2b.app/tcp/443/tls/ws/p2p/<relay-peer-id>
   */
  relayAddress?: string;
  /** Backend that fulfilled this instance. */
  backend: NetworkBackend;
  /**
   * Backend-specific session handle. For E2B: the sandbox id (string).
   * Opaque to callers — only the broker uses it for lookup at stop time.
   */
  providerSessionId: string;
  /** Tools currently registered against this network's broker.
   *  MVP: just ["o://shell"]. Phase 2: dynamic Copass tooling. */
  registeredToolAddresses: string[];
  /** Free-form metadata — cost-attribution tags etc. Reserved. */
  metadata: Record<string, string>;
}

/** Input for `o://networks.start`. */
export interface NetworkStartParams {
  name: string;
  ownerUserId: string;
  /** Override the default broker template for E2B. Defaults to
   *  `olane-compute-sandbox`. */
  e2bTemplate?: string;
  /** Free-form metadata stamped on the instance for cost attribution. */
  metadata?: Record<string, string>;
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
