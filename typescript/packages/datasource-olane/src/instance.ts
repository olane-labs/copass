import { openSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import portfinder from 'portfinder';
import {
  ConfigManager,
  OlaneOSSystemStatus,
  defaultOSInstanceConfig,
  listOS,
  startOS,
  statusOS,
  stopOS,
} from '@olane/os';
import { DEFAULT_CONFIG_PATH, setupGracefulShutdown } from '@olane/o-core';
import type {
  RunLocalOsOptions,
  StartLocalOsOptions,
  StartLocalOsResult,
} from './types.js';

/**
 * Rotate `logFile` to `logFile.1` when it exceeds `maxBytes`.
 * Best-effort; no error is raised if the rotation itself fails.
 */
export function rotateLogFile(logFile: string, maxBytes: number): void {
  try {
    const stats = statSync(logFile);
    if (stats.size > maxBytes) {
      const prev = logFile + '.1';
      try {
        unlinkSync(prev);
      } catch {
        /* no previous */
      }
      renameSync(logFile, prev);
    }
  } catch {
    /* file doesn't exist yet */
  }
}

/**
 * Start a detached Olane OS child process and wait briefly for it to respond.
 *
 * The child is spawned as `node <cliEntry> os _run [--port …] [--no-index]`
 * (or with `--import tsx` when the caller is running from `.ts` source). The
 * caller is responsible for having authenticated first — the child process
 * re-reads auth state from disk.
 */
export async function startLocalOsInstance(
  options: StartLocalOsOptions,
): Promise<StartLocalOsResult> {
  const {
    instanceName,
    port,
    noIndexNetwork = true,
    cliEntry = process.argv[1],
    logsDir = path.join(DEFAULT_CONFIG_PATH, 'logs'),
    logMaxBytes = 10 * 1024 * 1024,
    env = {},
    startupWaitMs = 2000,
  } = options;

  await mkdir(logsDir, { recursive: true });
  const logFile = path.join(logsDir, 'os.log');
  rotateLogFile(logFile, logMaxBytes);
  const out = openSync(logFile, 'a');

  const args = ['os', '_run'];
  if (port !== undefined) args.push('--port', String(port));
  if (noIndexNetwork) args.push('--no-index');

  const isTsSource = cliEntry.endsWith('.ts');
  const spawnArgs = isTsSource
    ? ['--import', 'tsx', cliEntry, ...args]
    : [cliEntry, ...args];

  const child = spawn(process.execPath, spawnArgs, {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, DEBUG: process.env.DEBUG || 'olane*', ...env },
    cwd: process.cwd(),
  });
  child.unref();

  await new Promise((resolve) => setTimeout(resolve, startupWaitMs));

  const status = await statusOS(instanceName);
  return {
    instanceName,
    pid: status?.config?.pid,
    port: status?.config?.port,
    peerId: status?.config?.peerId,
    logFile,
    alive: !!status?.alive,
  };
}

/**
 * Run an Olane OS instance in the foreground. Blocks forever (or until SIGTERM).
 *
 * Meant to be invoked by the detached child `startLocalOsInstance` spawned.
 * Callers running `olane os _run` wire this up.
 */
export async function runLocalOs(options: RunLocalOsOptions): Promise<void> {
  const { instanceName, port, noIndexNetwork = true, tokenManager } = options;

  const resolvedPort = port ?? (await portfinder.getPortPromise({ port: 4999 }));
  const config = defaultOSInstanceConfig(resolvedPort);
  config.noIndexNetwork = noIndexNetwork;

  const { os } = await startOS(instanceName, config);

  setupGracefulShutdown(
    async () => {
      try {
        if (tokenManager && typeof (tokenManager as { destroy?: () => Promise<void> }).destroy === 'function') {
          await (tokenManager as { destroy: () => Promise<void> }).destroy();
        }
        await os.stop();
        await ConfigManager.updateOSConfig({
          name: instanceName,
          version: config.network?.version || '0.0.1',
          description: config.network?.description || '',
          port: resolvedPort,
          status: OlaneOSSystemStatus.STOPPED,
          pid: undefined,
        });
      } catch {
        /* best-effort cleanup */
      }
    },
    { timeout: 30_000 },
  );

  await new Promise<void>(() => {});
}

/** Check if a named instance is alive. Returns whatever `statusOS` gives back. */
export async function statusLocalOsInstance(instanceName: string) {
  return statusOS(instanceName);
}

/** Stop a named instance. Returns `true` when something was stopped. */
export async function stopLocalOsInstance(instanceName: string): Promise<boolean> {
  return stopOS(instanceName);
}

/** List every known instance (running or stopped) on this machine. */
export async function listLocalOsInstances() {
  return listOS();
}
