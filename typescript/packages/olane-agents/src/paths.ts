import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Canonical filesystem layout used by `@copass/olane-agents`.
 *
 * We honor `OLANE_HOME` if set so users can sandbox state for tests; otherwise
 * everything lives under `~/.olane/`. The OS instance lifecycle goes through
 * `@copass/datasource-olane`'s `ConfigManager`-driven layout
 * (`os-instances/<name>/config.json`); per-session daemon state lives under
 * `sessions/<sessionId>.json`.
 */

export function olaneHome(): string {
  return process.env.OLANE_HOME || path.join(os.homedir(), '.olane');
}

export function sessionsDir(): string {
  return path.join(olaneHome(), 'sessions');
}

export function sessionFilePath(sessionId: string): string {
  return path.join(sessionsDir(), `${sessionId}.json`);
}

export function logsDir(): string {
  return path.join(olaneHome(), 'logs');
}

export function sessionLogFile(sessionId: string): string {
  return path.join(logsDir(), `session-${sessionId}.log`);
}
