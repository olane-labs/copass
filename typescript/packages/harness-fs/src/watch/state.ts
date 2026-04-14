/**
 * Watch state persistence.
 *
 * Reads/writes the .olane/watch-state.json file that tracks file fingerprints
 * and the .olane/logs/watch.log for diagnostic logging.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WatchFileState, WatchState } from '../types.js';
import { createEmptyWatchState, scanProjectFiles } from '../scan/files.js';

const WATCH_STATE_REL_PATH = path.join('.olane', 'watch-state.json');
const WATCH_LOG_REL_PATH = path.join('.olane', 'logs', 'watch.log');

export function resolveWatchStatePath(projectPath: string): string {
  return path.join(projectPath, WATCH_STATE_REL_PATH);
}

export function resolveWatchLogPath(projectPath: string): string {
  return path.join(projectPath, WATCH_LOG_REL_PATH);
}

/**
 * Load watch state from disk. Returns empty state if missing or corrupt.
 */
export async function readWatchState(projectPath: string): Promise<WatchState> {
  const statePath = resolveWatchStatePath(projectPath);

  try {
    const raw = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    if (!raw || typeof raw !== 'object' || raw.version !== 1) {
      return createEmptyWatchState(projectPath);
    }

    // Normalize file entries — drop any with invalid shapes
    const files: Record<string, WatchFileState> = {};
    if (raw.files && typeof raw.files === 'object') {
      for (const [key, value] of Object.entries(raw.files)) {
        const v = value as Record<string, unknown>;
        if (typeof v.mtimeMs === 'number' && typeof v.size === 'number' && typeof v.sha256 === 'string') {
          files[key] = {
            mtimeMs: v.mtimeMs as number,
            size: v.size as number,
            sha256: v.sha256 as string,
            lastIndexedAt: typeof v.lastIndexedAt === 'string' ? v.lastIndexedAt : null,
          };
        }
      }
    }

    return {
      version: 1,
      projectPath: typeof raw.projectPath === 'string' ? raw.projectPath : projectPath,
      files,
      lastEventAt: typeof raw.lastEventAt === 'string' ? raw.lastEventAt : null,
      lastSuccessAt: typeof raw.lastSuccessAt === 'string' ? raw.lastSuccessAt : null,
      lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    };
  } catch {
    return createEmptyWatchState(projectPath);
  }
}

/**
 * Persist watch state to disk.
 */
export async function writeWatchState(projectPath: string, state: WatchState): Promise<void> {
  const statePath = resolveWatchStatePath(projectPath);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}

/**
 * Rebuild watch state from a fresh scan. All files are marked as indexed now.
 */
export async function rebuildWatchState(projectPath: string): Promise<WatchState> {
  const files = await scanProjectFiles(projectPath);
  const now = new Date().toISOString();

  const indexedFiles: Record<string, WatchFileState> = {};
  for (const [filePath, fingerprint] of Object.entries(files)) {
    indexedFiles[filePath] = { ...fingerprint, lastIndexedAt: now };
  }

  const state: WatchState = {
    version: 1,
    projectPath,
    files: indexedFiles,
    lastEventAt: now,
    lastSuccessAt: now,
    lastError: null,
  };

  await writeWatchState(projectPath, state);
  return state;
}

/**
 * Append a log line to the watch log file.
 */
export async function appendWatchLog(
  projectPath: string,
  message: string,
): Promise<void> {
  const logPath = resolveWatchLogPath(projectPath);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const line = `${new Date().toISOString()} ${message}\n`;
  await fs.appendFile(logPath, line);
}
