/**
 * LocalNetworkShellTool — minimal in-daemon shell tool for the `local`
 * NetworkInstance backend (ADR 0027 P1, user-confirmed Path B).
 *
 * Mounted at `o://shell-<short-id>` per-network when a `local`-backend
 * network is started. Lives inside the daemon's olane runtime — no
 * separate process. The shell's per-call `child_process.spawn(cwd, …)`
 * binds to the network's user-specified working directory, so callers
 * can run commands "in" the user's project folder without paying for
 * a separate broker process.
 *
 * Contract mirrors `o-private-network/nodes/compute-sandbox/src/shell.tool.ts`:
 *   - `_tool_exec({cmd, timeout_s, stdin?, cwd?})` runs a single command
 *     via `child_process.spawn`.
 *   - Same input shape; same `ExecResult`-shaped return; same timeout
 *     semantics (manual `setTimeout(kill, timeout_s*1000)` → exit_code=124).
 *   - Same input-shape unwrap pattern (the framework passes
 *     `{...request.toJSON(), stream}`; we accept either bare input or
 *     `{params: input}`).
 *
 * What this tool does NOT do (intentional, MVP):
 *   - No sandboxing — the shell tool runs commands AS the daemon user.
 *     This is the explicit MVP threat model: single-tenant, single-user,
 *     loopback only. The whole point of the `local` backend is to give
 *     the user code execution in their own filesystem.
 *   - No env injection beyond what's inherited from the daemon — Phase 2
 *     can add per-network env overrides.
 *   - No streaming output — the full result is returned at end.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { oAddress } from '@olane/o-core';
import { oLaneTool } from '@olane/o-lane';
import type { oNodeConfig } from '@olane/o-node';

/** Coreutils `timeout(1)` exit code — same convention as the compute-sandbox shell. */
export const LOCAL_SHELL_TIMEOUT_EXIT_CODE = 124;
/** Fallback exit code when child_process reports `null` (signal-killed). */
export const LOCAL_SHELL_NULL_EXIT_FALLBACK = 1;
/** Per-stream output cap (bytes). 5 MB each → 10 MB combined ceiling. */
export const LOCAL_SHELL_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

export interface LocalShellExecInput {
  /** argv-style command split. cmd[0] is the program. */
  cmd: string[];
  /** Wall-clock timeout in seconds; must be > 0. */
  timeout_s: number;
  /** Optional UTF-8 string written to the child's stdin. */
  stdin?: string;
  /** Per-call cwd override. Defaults to the tool's instance-scoped cwd. */
  cwd?: string;
}

export interface LocalShellExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  elapsed_ms: number;
  truncated: boolean;
}

export interface LocalNetworkShellToolConfig extends oNodeConfig {
  /** Working directory for spawned children. Defaults to the daemon's
   *  cwd — but the network broker SHOULD always set this explicitly to
   *  the user's chosen folder. */
  cwd?: string;
}

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

function appendCapped(
  current: string,
  chunk: Buffer | string,
  cap: number,
  alreadyTruncated: boolean,
): { next: string; truncated: boolean } {
  if (alreadyTruncated) return { next: current, truncated: true };
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  const remaining = cap - current.length;
  if (remaining <= 0) return { next: current, truncated: true };
  if (text.length <= remaining) return { next: current + text, truncated: false };
  return { next: current + text.slice(0, remaining), truncated: true };
}

export class LocalNetworkShellTool extends oLaneTool {
  private readonly defaultCwd: string;

  constructor(config: LocalNetworkShellToolConfig) {
    super({
      ...config,
      address: config.address || new oAddress('o://local-network-shell'),
      description:
        'Local network-instance shell tool — runs commands on the host ' +
        'as the daemon user, with cwd bound to the network instance\'s ' +
        'user-specified working directory.',
      methods: {
        exec: {
          name: 'exec',
          description: 'Run a single command and return stdout/stderr/exit_code.',
          parameters: [
            { name: 'cmd', type: 'array', description: 'argv-style', required: true },
            { name: 'timeout_s', type: 'number', description: 'Wall-clock timeout', required: true },
            { name: 'stdin', type: 'string', description: 'Optional stdin', required: false },
            { name: 'cwd', type: 'string', description: 'Per-call cwd override', required: false },
          ],
          dependencies: [],
        },
      },
    });
    this.defaultCwd = config.cwd || process.cwd();
  }

  /** Test seam: subclasses (or sinon spies) replace this to mock spawn. */
  protected spawnChild(
    cmd: string,
    args: string[],
    opts: SpawnOptions,
  ): ChildProcess {
    return spawn(cmd, args, opts);
  }

  async _tool_exec(
    arg: LocalShellExecInput | { params: LocalShellExecInput },
  ): Promise<LocalShellExecResult> {
    const input = unwrapParams(arg);
    if (!input || !Array.isArray(input.cmd) || input.cmd.length < 1) {
      throw new Error(
        'LocalNetworkShellTool._tool_exec: `cmd` must be a non-empty argv-style array',
      );
    }
    if (typeof input.timeout_s !== 'number' || input.timeout_s <= 0) {
      throw new Error(
        'LocalNetworkShellTool._tool_exec: `timeout_s` must be a positive number',
      );
    }

    const cwd = input.cwd || this.defaultCwd;
    const startedAt = Date.now();
    const child = this.spawnChild(input.cmd[0], input.cmd.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    });

    if (child.stdin) {
      if (typeof input.stdin === 'string') {
        child.stdin.write(input.stdin);
      }
      child.stdin.end();
    }

    let stdout = '';
    let stderr = '';
    let truncated = false;
    child.stdout?.on('data', (chunk) => {
      const r = appendCapped(stdout, chunk, LOCAL_SHELL_MAX_OUTPUT_BYTES, truncated);
      stdout = r.next;
      if (r.truncated) truncated = true;
    });
    child.stderr?.on('data', (chunk) => {
      const r = appendCapped(stderr, chunk, LOCAL_SHELL_MAX_OUTPUT_BYTES, truncated);
      stderr = r.next;
      if (r.truncated) truncated = true;
    });

    let timedOut = false;
    const timer: NodeJS.Timeout = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* best-effort */
      }
    }, input.timeout_s * 1000);

    const exitCode: number = await new Promise<number>((resolve) => {
      child.once('exit', (code) => {
        resolve(typeof code === 'number' ? code : LOCAL_SHELL_NULL_EXIT_FALLBACK);
      });
      child.once('error', () => {
        resolve(LOCAL_SHELL_NULL_EXIT_FALLBACK);
      });
    });
    clearTimeout(timer);

    return {
      stdout,
      stderr,
      exit_code: timedOut ? LOCAL_SHELL_TIMEOUT_EXIT_CODE : exitCode,
      elapsed_ms: Date.now() - startedAt,
      truncated,
    };
  }
}
