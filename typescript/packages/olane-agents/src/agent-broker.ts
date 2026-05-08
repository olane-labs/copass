/**
 * Per-session agent daemon lifecycle + RPC against the running Olane OS.
 *
 * Front-ends call:
 *   - `register()` to spawn a detached daemon for a session
 *   - `deregister()` to SIGTERM it
 *   - `list/send/drain` to query / message / drain via the running OS
 *   - `installHooks()` to write Claude Code hook scripts that drive the above
 *
 * The package owns the libp2p plumbing and filesystem layout
 * (`<DEFAULT_CONFIG_PATH>/sessions/<id>.json`,
 * `<DEFAULT_CONFIG_PATH>/logs/session-<id>.log`).
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import type {
  InboxMessage,
  MessagePart,
  RegistryEntry,
} from '@olane/o-agent';
import { withOlaneClient, OlaneOSNotRunningError } from './olane-client.js';
import type {
  InstallHooksOptions,
  ListFilter,
  RegisterOptions,
  SendOptions,
  SendResult,
  SessionFile,
} from './types.js';
import {
  logsDir as defaultLogsDir,
  sessionFilePath,
  sessionLogFile,
  sessionsDir as defaultSessionsDir,
} from './paths.js';

function defaultUserSegment(): string {
  return os.userInfo().username || 'local';
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readSessionFile(
  sessionId: string,
  sessionsDir?: string,
): Promise<SessionFile | null> {
  const filePath = sessionsDir
    ? path.join(sessionsDir, `${sessionId}.json`)
    : sessionFilePath(sessionId);
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw) as SessionFile;
  } catch {
    return null;
  }
}

export class AgentBroker {
  /**
   * Spawn a detached daemon for `sessionId`. Idempotent: if an alive
   * daemon already exists for this session, returns its file unchanged.
   *
   * The daemon process runs the same CLI binary with `olane _host …`;
   * `cliEntry` defaults to `process.argv[1]` so the front-end's own
   * binary handles the spawn. (Custom binaries that use this package
   * must wire a hidden `olane _host` subcommand to `runAgentDaemon`.)
   */
  async register(options: RegisterOptions): Promise<SessionFile> {
    const sessionsDirectory = options.sessionsDir || defaultSessionsDir();
    const logsDirectory = options.logsDir || defaultLogsDir();
    await fsp.mkdir(sessionsDirectory, { recursive: true });
    await fsp.mkdir(logsDirectory, { recursive: true });

    const user = options.user || defaultUserSegment();
    const kind = options.kind;

    // Idempotency check.
    const existing = await readSessionFile(options.sessionId, sessionsDirectory);
    if (existing && isAlive(existing.pid)) {
      return existing;
    }
    if (existing) {
      // Stale file — clear it so the new daemon owns it.
      await fsp.rm(
        path.join(sessionsDirectory, `${options.sessionId}.json`),
        { force: true },
      );
    }

    // OS must be running before we spawn.
    await withOlaneClient(async () => {
      // a no-op call just to verify connectivity; we throw early if down
    }).catch((err) => {
      if (err instanceof OlaneOSNotRunningError) throw err;
      // Other errors during the empty body are unlikely; rethrow.
      throw err;
    });

    const cliEntry = options.cliEntry || process.argv[1];
    if (!cliEntry) {
      throw new Error(
        'AgentBroker.register needs `cliEntry` — the front-end binary that exposes `olane _host`.',
      );
    }

    const args: string[] = [
      cliEntry,
      'olane',
      '_host',
      '--kind',
      kind,
      '--session',
      options.sessionId,
      '--user',
      user,
    ];
    if (options.description) args.push('--description', options.description);
    if (options.skills?.length) {
      for (const s of options.skills) args.push('--skill', s);
    }

    const isTsSource = cliEntry.endsWith('.ts');
    const spawnArgs = isTsSource
      ? ['--import', 'tsx', ...args]
      : args;

    const logPath = sessionLogFile(options.sessionId);
    const out = fs.openSync(logPath, 'a');
    const err = fs.openSync(logPath, 'a');

    const child = spawn(process.execPath, spawnArgs, {
      detached: true,
      stdio: ['ignore', out, err],
      env: {
        ...process.env,
        COPASS_OLANE_DAEMON: '1',
        DEBUG: process.env.DEBUG || 'olane-os:*',
      },
    });
    child.unref();

    // Wait for the daemon to write its session file.
    const deadline = Date.now() + 60_000;
    let session: SessionFile | null = null;
    while (Date.now() < deadline) {
      if (!isAlive(child.pid!)) {
        throw new Error(
          `Agent daemon exited during boot. Tail ${logPath} for details.`,
        );
      }
      session = await readSessionFile(options.sessionId, sessionsDirectory);
      if (session && session.pid === child.pid) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!session || session.pid !== child.pid) {
      try {
        process.kill(child.pid!, 'SIGTERM');
      } catch {
        /* ignore */
      }
      throw new Error(
        `Timed out waiting for agent daemon to register. Check ${logPath}.`,
      );
    }
    session.logFile = logPath;
    return session;
  }

  /**
   * SIGTERM the daemon for `sessionId`. The daemon's stop handler
   * deregisters from `o://agents` and removes the session file.
   */
  async deregister(
    sessionId: string,
    options: { sessionsDir?: string } = {},
  ): Promise<{ ok: boolean; address?: string; alreadyDead?: boolean }> {
    const sessionsDirectory = options.sessionsDir || defaultSessionsDir();
    const session = await readSessionFile(sessionId, sessionsDirectory);
    if (!session) {
      return { ok: false };
    }

    if (!isAlive(session.pid)) {
      await fsp.rm(
        path.join(sessionsDirectory, `${sessionId}.json`),
        { force: true },
      );
      return { ok: true, address: session.address, alreadyDead: true };
    }

    try {
      process.kill(session.pid, 'SIGTERM');
    } catch {
      return { ok: false };
    }

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && isAlive(session.pid)) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (isAlive(session.pid)) {
      try {
        process.kill(session.pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
      await fsp.rm(
        path.join(sessionsDirectory, `${sessionId}.json`),
        { force: true },
      );
    }
    return { ok: true, address: session.address };
  }

  /** Query the running registry. */
  async list(filter: ListFilter = {}): Promise<RegistryEntry[]> {
    const result = await withOlaneClient(async (use) => {
      return await use('o://agents', {
        method: 'list',
        params: {
          kind: filter.kind,
          user: filter.user,
          live: filter.live,
        },
      });
    });
    const data = (result as any)?.result?.data || { count: 0, entries: [] };
    return (data.entries as RegistryEntry[]) || [];
  }

  /**
   * Drain the inbox for the daemon at `sessionId`. Returns and clears
   * pending messages. Intended for the Stop hook.
   */
  async drain(
    sessionId: string,
    options: { sessionsDir?: string } = {},
  ): Promise<InboxMessage[]> {
    const session = await readSessionFile(sessionId, options.sessionsDir);
    if (!session) return [];
    const result = await withOlaneClient(async (use) => {
      return await use(session.address, {
        method: 'drain_inbox',
        params: {},
      });
    });
    const data = (result as any)?.result?.data || { count: 0, messages: [] };
    return (data.messages as InboxMessage[]) || [];
  }

  /**
   * Send a message to another agent address. If `fromSessionId` is
   * provided AND that session has a registered daemon, the message
   * envelope's `from` is set to the daemon's address. Otherwise sends
   * as `o://cli`.
   */
  async send(options: SendOptions): Promise<SendResult> {
    const parts: MessagePart[] = [];
    if (options.text !== undefined) {
      parts.push({ kind: 'text', text: options.text });
    }
    if (options.data !== undefined) {
      parts.push({ kind: 'data', data: options.data });
    }
    if (parts.length === 0) {
      throw new Error('AgentBroker.send: provide `text` or `data`.');
    }

    let sender: string | null = null;
    if (options.fromSessionId) {
      const session = await readSessionFile(options.fromSessionId);
      if (session) sender = session.address;
    }

    const result = await withOlaneClient(async (use) => {
      if (sender) {
        return await use(sender, {
          method: 'send',
          params: {
            to: options.to,
            parts,
            task_id: options.taskId,
            task_state: options.taskState,
            correlation_id: options.correlationId,
          },
        });
      }
      // Anonymous send — fabricate envelope, hit the recipient's
      // canonical address with method=receive. Sub-path resolution
      // doesn't fire across processes; we encode the method as a
      // JSON-RPC param.
      const envelope = {
        id: `msg_${uuidv4()}`,
        from: 'o://cli',
        to: options.to,
        sentAt: new Date().toISOString(),
        parts,
        task: options.taskId
          ? { id: options.taskId, state: options.taskState || 'submitted' }
          : undefined,
        correlationId: options.correlationId,
      };
      return await use(options.to, {
        method: 'receive',
        params: { message: envelope },
      });
    });

    const data = (result as any)?.result;
    if (data?.success === false) {
      return { delivered: false, error: data?.error };
    }
    const inner = data?.data || {};
    return {
      delivered: true,
      messageId: inner.messageId,
      sentAt: inner.sentAt,
    };
  }

  /**
   * Write Claude Code SessionStart / Stop / SessionEnd hooks into the
   * caller's hooks dir. Returns the list of paths written.
   */
  async installHooks(options: InstallHooksOptions = {}): Promise<string[]> {
    const hooksDir =
      options.hooksDir || path.join(os.homedir(), '.claude', 'hooks');
    const cliBin = options.cliBin || 'copass';
    await fsp.mkdir(hooksDir, { recursive: true });

    const sessionStart = `#!/usr/bin/env bash
# Auto-generated by @copass/olane-agents. Spawns a per-session daemon
# registered with the local Olane OS broker. Safe no-op if Olane OS is
# not running.
set -e
SESSION_ID="\${CLAUDE_SESSION_ID:-\${CLAUDE_CODE_SESSION_ID:-unknown}}"
${cliBin} olane register --kind claude-code --session "$SESSION_ID" >/dev/null 2>&1 || true
`;

    const stop = `#!/usr/bin/env bash
# Auto-generated by @copass/olane-agents. Drains the agent's inbox
# between turns and emits the messages as additionalContext.
set -e
SESSION_ID="\${CLAUDE_SESSION_ID:-\${CLAUDE_CODE_SESSION_ID:-unknown}}"
DRAINED=$(${cliBin} olane drain --session "$SESSION_ID" --json 2>/dev/null || echo '{"messages":[]}')
COUNT=$(echo "$DRAINED" | jq -r '.count // 0' 2>/dev/null || echo 0)
if [ "$COUNT" -gt 0 ]; then
  echo "$DRAINED" | jq -r '.messages[] | "[olane:" + .from + "] " + (.parts[]? | select(.kind=="text") | .text)'
fi
`;

    const sessionEnd = `#!/usr/bin/env bash
# Auto-generated by @copass/olane-agents. Kills the per-session daemon
# and removes its registry entry.
set -e
SESSION_ID="\${CLAUDE_SESSION_ID:-\${CLAUDE_CODE_SESSION_ID:-unknown}}"
${cliBin} olane deregister --session "$SESSION_ID" >/dev/null 2>&1 || true
`;

    const targets = [
      { name: 'SessionStart.sh', body: sessionStart },
      { name: 'Stop.sh', body: stop },
      { name: 'SessionEnd.sh', body: sessionEnd },
    ];

    const written: string[] = [];
    for (const t of targets) {
      const filePath = path.join(hooksDir, t.name);
      await fsp.writeFile(filePath, t.body, 'utf8');
      fs.chmodSync(filePath, 0o755);
      written.push(filePath);
    }
    return written;
  }
}
