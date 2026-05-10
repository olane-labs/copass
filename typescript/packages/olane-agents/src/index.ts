// Types
export type {
  AgentCard,
  AgentDaemonOptions,
  AgentKind,
  InboxMessage,
  InstallHooksOptions,
  ListFilter,
  MessagePart,
  OlaneOSManagerOptions,
  OsRunningInfo,
  OsStatus,
  RegisterOptions,
  RegistryEntry,
  SendOptions,
  SendResult,
  SessionFile,
} from './types.js';

// OS lifecycle
export { OlaneOSManager } from './os-manager.js';
export { runOlaneOSHost } from './os-host.js';
export type { RunOlaneOSHostOptions } from './os-host.js';

// Per-session agent broker
export { AgentBroker } from './agent-broker.js';
export { runAgentDaemon } from './agent-daemon.js';

// Network instance broker (ADR 0027 — `o://networks`)
export { NetworkBroker } from './network-broker.js';
export type {
  BrokerStartOptions,
  BrokerListFilter,
} from './network-broker.js';
export { NetworkBrokerNode } from './network-broker-node.js';
export type { NetworkBrokerNodeConfig } from './network-broker-node.js';
export {
  DEFAULT_NETWORK_BROKER_CONFIG,
  NetworkInstanceLimitExceededError,
  NetworkInstanceNotFoundError,
  NetworkInstanceStatus,
} from './network-types.js';
export type {
  NetworkBackend,
  NetworkBrokerConfig,
  NetworkInstance,
  NetworkListParams,
  NetworkListResult,
  NetworkStartParams,
  NetworkStatusParams,
  NetworkStopParams,
} from './network-types.js';

// libp2p client helper
export { withOlaneClient, OlaneOSNotRunningError } from './olane-client.js';
export type { UseFn, WithOlaneClientOptions } from './olane-client.js';

// Filesystem layout helpers
export {
  olaneHome,
  sessionsDir,
  sessionFilePath,
  logsDir,
  sessionLogFile,
} from './paths.js';
