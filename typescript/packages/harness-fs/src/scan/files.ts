/**
 * Project file scanning, fingerprinting, and diffing.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isIndexableCodePath } from '@copass/core';
import type { ProjectConfig, IndexingConfig } from '@copass/core';
import type { DiffResult, UpsertOperation, WatchFileState, WatchState } from '../types.js';
import { GitignoreFilter } from './gitignore.js';
import {
  ALWAYS_IGNORED_DIRS,
  DEFAULT_EXCLUDED_PATTERNS,
  buildExcludedDirs,
} from './ignore-rules.js';

// -- Path utilities --

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesPattern(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = normalizeRelativePath(pattern.trim());
    if (!normalized) return false;
    return globToRegExp(normalized).test(relativePath);
  });
}

// -- Ignore logic --

/**
 * Check if a relative path should be ignored during scanning.
 */
export function shouldIgnorePath(
  relativePath: string,
  excludedPatterns: string[] = [],
  options: { isDirectory?: boolean; indexingConfig?: IndexingConfig } = {},
): boolean {
  if (!relativePath || relativePath.startsWith('..')) return true;

  const normalized = normalizeRelativePath(relativePath);
  const parts = normalized.split('/');
  const excludedDirs = buildExcludedDirs(options.indexingConfig?.extra_ignored_dirs);

  if (parts.some((part) => ALWAYS_IGNORED_DIRS.has(part) || excludedDirs.has(part))) return true;

  if (!options.isDirectory && !isIndexableCodePath(normalized, options.indexingConfig?.extra_languages)) {
    return true;
  }

  const patterns = [...DEFAULT_EXCLUDED_PATTERNS, ...excludedPatterns];
  return matchesPattern(normalized, patterns) || matchesPattern(path.basename(normalized), patterns);
}

/**
 * Create a path matcher function for use with chokidar's `ignored` option.
 */
export function createWatchPathMatcher(
  projectPath: string,
  excludedPatterns: string[] = [],
  gitignoreFilter?: GitignoreFilter | null,
): (candidatePath: string, isDirectory?: boolean) => boolean {
  return (candidatePath: string, isDirectory = false) => {
    const relativePath = normalizeRelativePath(path.relative(projectPath, candidatePath));
    if (gitignoreFilter?.isIgnored(relativePath, isDirectory)) return true;
    return shouldIgnorePath(relativePath, excludedPatterns, { isDirectory });
  };
}

// -- Fingerprinting --

async function hashFile(filePath: string): Promise<string> {
  const contents = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(contents).digest('hex');
}

async function fingerprintFile(
  filePath: string,
  previous?: WatchFileState,
): Promise<WatchFileState> {
  const stat = await fs.stat(filePath);

  // Optimization: if mtime and size unchanged, reuse previous hash
  if (previous && previous.mtimeMs === stat.mtimeMs && previous.size === stat.size) {
    return { ...previous, mtimeMs: stat.mtimeMs, size: stat.size };
  }

  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    sha256: await hashFile(filePath),
    lastIndexedAt: previous?.lastIndexedAt ?? null,
  };
}

// -- Eligibility --

async function isEligiblePath(
  projectPath: string,
  filePath: string,
  config: ProjectConfig,
): Promise<boolean> {
  const relativePath = normalizeRelativePath(path.relative(projectPath, filePath));
  if (shouldIgnorePath(relativePath, config.indexing.excluded_patterns, {
    indexingConfig: config.indexing,
  })) {
    return false;
  }

  try {
    const stat = await fs.stat(filePath);
    return stat.size <= config.indexing.max_file_size_kb * 1024;
  } catch {
    return false;
  }
}

// -- Directory walk --

async function walkDirectory(
  rootPath: string,
  currentPath: string,
  config: ProjectConfig,
  previousFiles: Record<string, WatchFileState>,
  output: Record<string, WatchFileState>,
  gitignoreFilter: GitignoreFilter | null,
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  const excludedDirs = buildExcludedDirs(config.indexing.extra_ignored_dirs);

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = normalizeRelativePath(path.relative(rootPath, absolutePath));
    if (!relativePath || relativePath.startsWith('..')) continue;

    if (entry.isDirectory()) {
      if (ALWAYS_IGNORED_DIRS.has(entry.name) || excludedDirs.has(entry.name)) continue;
      if (gitignoreFilter?.isIgnored(relativePath, true)) continue;

      // Discover nested .gitignore before recursing
      try {
        const content = await fs.readFile(path.join(absolutePath, '.gitignore'), 'utf-8');
        gitignoreFilter?.addNestedGitignore(relativePath, content);
      } catch {
        // no nested .gitignore
      }

      await walkDirectory(rootPath, absolutePath, config, previousFiles, output, gitignoreFilter);
      continue;
    }

    if (!entry.isFile()) continue;
    if (gitignoreFilter?.isIgnored(relativePath, false)) continue;
    if (!(await isEligiblePath(rootPath, absolutePath, config))) continue;

    output[relativePath] = await fingerprintFile(absolutePath, previousFiles[relativePath]);
  }
}

// -- Public API --

export interface ScanOptions {
  previousState?: WatchState;
  config?: ProjectConfig;
}

/**
 * Scan a project directory and return fingerprints for all eligible files.
 * Respects .gitignore, default ignore rules, and project config exclusions.
 */
export async function scanProjectFiles(
  projectPath: string,
  options: ScanOptions = {},
): Promise<Record<string, WatchFileState>> {
  const output: Record<string, WatchFileState> = {};

  // Import dynamically to avoid requiring @copass/core at module load
  const { defaultProjectConfig } = await import('@copass/core');
  const config = options.config ?? defaultProjectConfig();
  const gitignoreFilter = GitignoreFilter.create(projectPath);

  await walkDirectory(
    projectPath,
    projectPath,
    config,
    options.previousState?.files ?? {},
    output,
    gitignoreFilter,
  );

  return output;
}

/**
 * Fingerprint a single file within a project.
 * Returns null if the file is not eligible for indexing.
 */
export async function fingerprintProjectFile(
  projectPath: string,
  relativePath: string,
  previous?: WatchFileState,
  config?: ProjectConfig,
): Promise<WatchFileState | null> {
  const { defaultProjectConfig } = await import('@copass/core');
  const resolvedConfig = config ?? defaultProjectConfig();
  const absolutePath = path.join(projectPath, relativePath);

  if (!(await isEligiblePath(projectPath, absolutePath, resolvedConfig))) return null;

  try {
    return await fingerprintFile(absolutePath, previous);
  } catch {
    return null;
  }
}

// -- Diffing --

function takeRenameMatch(
  adds: UpsertOperation[],
  deletes: DiffResult['deletes'],
  add: UpsertOperation,
): string | null {
  const matchIndex = deletes.findIndex(
    (d) => d.fingerprint && d.fingerprint.sha256 === add.fingerprint.sha256 && d.fingerprint.size === add.fingerprint.size,
  );
  if (matchIndex === -1) return null;

  const [matched] = deletes.splice(matchIndex, 1);
  const addIndex = adds.findIndex((a) => a.path === add.path);
  if (addIndex !== -1) adds.splice(addIndex, 1);
  return matched.path;
}

/**
 * Diff two file state snapshots to detect adds, changes, deletes, and renames.
 * Renames are detected by matching SHA256 + size between adds and deletes.
 */
export function diffFiles(
  previousFiles: Record<string, WatchFileState>,
  currentFiles: Record<string, WatchFileState>,
): DiffResult {
  const result: DiffResult = { upserts: [], deletes: [], renames: [], unchanged: [] };

  for (const [filePath, current] of Object.entries(currentFiles)) {
    const previous = previousFiles[filePath];
    if (!previous) {
      result.upserts.push({ type: 'upsert', path: filePath, reason: 'added', fingerprint: current });
      continue;
    }
    if (previous.sha256 === current.sha256 && previous.size === current.size && previous.mtimeMs === current.mtimeMs) {
      result.unchanged.push(filePath);
      continue;
    }
    result.upserts.push({ type: 'upsert', path: filePath, reason: 'changed', fingerprint: current });
  }

  for (const [filePath, fingerprint] of Object.entries(previousFiles)) {
    if (!currentFiles[filePath]) {
      result.deletes.push({ type: 'delete', path: filePath, fingerprint });
    }
  }

  // Detect renames: match adds against deletes by SHA256 + size
  const addedCandidates = result.upserts.filter((op) => op.reason === 'added');
  for (const add of addedCandidates) {
    const oldPath = takeRenameMatch(result.upserts, result.deletes, add);
    if (oldPath) {
      result.renames.push({ type: 'rename', oldPath, path: add.path, fingerprint: add.fingerprint });
    }
  }

  result.upserts.sort((a, b) => a.path.localeCompare(b.path));
  result.deletes.sort((a, b) => a.path.localeCompare(b.path));
  result.renames.sort((a, b) => a.path.localeCompare(b.path));
  result.unchanged.sort();

  return result;
}

/**
 * Create an empty watch state for a project path.
 */
export function createEmptyWatchState(projectPath: string): WatchState {
  return {
    version: 1,
    projectPath,
    files: {},
    lastEventAt: null,
    lastSuccessAt: null,
    lastError: null,
  };
}
