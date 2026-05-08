import type {
  AgentCard,
  AgentKind,
  InboxMessage,
  MessagePart,
  RegistryEntry,
} from '@olane/o-agent';

/** OS lifecycle types ─────────────────────────────────────────────── */

export interface OlaneOSManagerOptions {
  /** Name of the OS instance — typically the user's Copass ID or unix username. */
  instanceName: string;
  /** Optional explicit port. Auto-assigned starting at 4999 if omitted. */
  port?: number;
  /** Skip the network-wide indexing on startup. Defaults to `true`. */
  noIndexNetwork?: boolean;
  /** Path to the host CLI entrypoint that will be re-spawned in `_run` mode. */
  cliEntry?: string;
  /** Override logs dir. Defaults to `<DEFAULT_CONFIG_PATH>/logs`. */
  logsDir?: string;
  /** Extra env vars to set on the spawned child. */
  env?: Record<string, string>;
}

export interface OsRunningInfo {
  pid: number;
  port?: number;
  peerId?: string;
  alive: boolean;
}

export interface OsStatus {
  running: boolean;
  info: OsRunningInfo | null;
}

/** Agent broker types ─────────────────────────────────────────────── */

export interface RegisterOptions {
  /** Agent kind — `claude-code`, `codex`, etc. */
  kind: AgentKind | string;
  /** Stable session id from the host (e.g. CLAUDE_SESSION_ID). */
  sessionId: string;
  /**
   * Host CLI entrypoint that exposes `olane _host` and runs
   * `runAgentDaemon` when invoked. Required to avoid silent footguns
   * — defaulting to `process.argv[1]` would couple the daemon to
   * whichever binary called `register()`, which silently breaks for
   * non-cli front-ends (MCP servers, web apps, etc.).
   */
  cliEntry: string;
  /** User segment — defaults to `os.userInfo().username`. */
  user?: string;
  /** Skill ids to advertise. Defaults to the kind's default skills. */
  skills?: string[];
  /** Free-form description for the agent card. */
  description?: string;
  /** Bound on the daemon's in-memory inbox. Defaults to 256. */
  inboxBound?: number;
  /** Override sessions dir. Defaults to `<DEFAULT_CONFIG_PATH>/sessions`. */
  sessionsDir?: string;
  /** Override logs dir. Defaults to `<DEFAULT_CONFIG_PATH>/logs`. */
  logsDir?: string;
}

export interface SessionFile {
  /** Effective canonical olane address — what callers `use()` against. */
  address: string;
  /** Capability card the daemon registered with. */
  card: AgentCard;
  /** Daemon process id. */
  pid: number;
  /** ISO timestamp the session started. */
  startedAt: string;
  /** Path to the daemon's log file. */
  logFile: string;
}

export interface ListFilter {
  kind?: string;
  user?: string;
  /** If true, only return entries with fresh heartbeats (last < 90 s). */
  live?: boolean;
}

export interface SendOptions {
  /** Recipient olane address. */
  to: string;
  /**
   * Send AS this registered session — its session file is read for the
   * daemon's canonical address, and the AgentNode's `_tool_send` is
   * called so the server-side envelope construction stays the single
   * source of truth. Anonymous sends are not supported in v1; register
   * a session daemon first if you need to send.
   */
  fromSessionId: string;
  /** Text body — provide `text` or `data`. */
  text?: string;
  /** Structured payload — provide `text` or `data`. */
  data?: unknown;
  /** A2A task correlation id. */
  taskId?: string;
  /** A2A task state — `submitted`, `working`, `completed`, … */
  taskState?: string;
  /** Caller-supplied correlation id for one-off ack/reply matching. */
  correlationId?: string;
}

export interface SendResult {
  delivered: boolean;
  messageId?: string;
  sentAt?: string;
  error?: string;
}

export interface AgentDaemonOptions {
  kind: AgentKind | string;
  sessionId: string;
  user: string;
  skills?: string[];
  description?: string;
  /** Bound on the in-memory inbox. Defaults to 256. */
  inboxBound?: number;
  /** Override sessions dir. Defaults to `<DEFAULT_CONFIG_PATH>/sessions`. */
  sessionsDir?: string;
}

export interface InstallHooksOptions {
  /** Hooks dir. Defaults to `~/.claude/hooks`. */
  hooksDir?: string;
  /** CLI binary used by the hook scripts. Defaults to `copass`. */
  cliBin?: string;
}

export type { AgentCard, AgentKind, InboxMessage, MessagePart, RegistryEntry };
