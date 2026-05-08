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

// libp2p client helper
export {
  withOlaneClient,
  OlaneOSNotRunningError,
  ConfigManager,
} from './olane-client.js';
export type { UseFn, WithOlaneClientOptions } from './olane-client.js';

// Filesystem layout helpers
export {
  olaneHome,
  sessionsDir,
  sessionFilePath,
  logsDir,
  sessionLogFile,
} from './paths.js';
