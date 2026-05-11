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
export type {
  NetworkBrokerNodeConfig,
  NetworkBrokerDaemonHooks,
} from './network-broker-node.js';
export {
  DEFAULT_NETWORK_BROKER_CONFIG,
  NetworkInstanceLimitExceededError,
  NetworkInstanceNotFoundError,
  NetworkInstanceStatus,
} from './network-types.js';
export type {
  NetworkAttachParams,
  NetworkBackend,
  NetworkBrokerConfig,
  NetworkDetachParams,
  NetworkDiscoverAgentsResult,
  NetworkInstance,
  NetworkListParams,
  NetworkListResult,
  NetworkStartParams,
  NetworkStatusParams,
  NetworkStopParams,
} from './network-types.js';
export {
  LOCAL_SHELL_MAX_OUTPUT_BYTES,
  LOCAL_SHELL_NULL_EXIT_FALLBACK,
  LOCAL_SHELL_TIMEOUT_EXIT_CODE,
  LocalNetworkShellTool,
} from './local-network-shell.tool.js';
export type {
  LocalNetworkShellToolConfig,
  LocalShellExecInput,
  LocalShellExecResult,
} from './local-network-shell.tool.js';

// libp2p client helper
export { withOlaneClient, OlaneOSNotRunningError } from './olane-client.js';
export type { UseFn, WithOlaneClientOptions } from './olane-client.js';

// Gateway registrar (ADR 0027) — daemon-side registration with a remote
// compute-gateway (the `o://daemons` registry tool on a publicly-deployed
// compute-sandbox; see o-private-network/nodes/compute-sandbox/registry.tool.ts).
export {
  registerWithGateway,
  GATEWAY_REGISTRY_ADDRESS,
  DEFAULT_HEARTBEAT_MS,
} from './gateway-registrar.js';
export type {
  GatewayRegistrarOptions,
  RegisteredGatewayHandle,
} from './gateway-registrar.js';

// Filesystem layout helpers
export {
  olaneHome,
  sessionsDir,
  sessionFilePath,
  logsDir,
  sessionLogFile,
} from './paths.js';
