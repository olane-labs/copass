/**
 * Watch runtime — chokidar-based file watcher with debounced ingestion.
 *
 * Accepts a CopassClient for API communication instead of implicitly
 * creating its own auth context.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import type { CopassClient, ProjectConfig } from '@copass/core';
import { defaultProjectConfig, detectLanguage, buildQueryMetadata } from '@copass/core';
import type { WatchRuntimeOptions } from '../types.js';
import { scanProjectFiles, diffFiles, createWatchPathMatcher } from '../scan/files.js';
import { GitignoreFilter } from '../scan/gitignore.js';
import { readWatchState, writeWatchState, appendWatchLog } from './state.js';

export interface WatchRunSummary {
  upserts: number;
  deletes: number;
  renames: number;
  errors: number;
  durationMs: number;
}

export class ProjectWatchRuntime {
  private readonly client: CopassClient;
  private readonly projectPath: string;
  private readonly config: ProjectConfig;
  private readonly service: boolean;
  private readonly maxFiles?: number;
  private watcher: FSWatcher | null = null;
  private pendingUpserts = new Set<string>();
  private pendingDeletes = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(client: CopassClient, options: WatchRuntimeOptions) {
    this.client = client;
    this.projectPath = options.projectPath;
    this.config = options.config ?? defaultProjectConfig();
    this.service = options.service ?? false;
    this.maxFiles = options.maxFiles;
  }

  /**
   * Start the watcher. Performs an initial reconcile, then watches for changes.
   * If `once` was set in options, returns after initial reconcile without watching.
   */
  async start(options?: { once?: boolean }): Promise<WatchRunSummary> {
    const summary = await this.reconcile();

    if (options?.once) return summary;

    const gitignoreFilter = GitignoreFilter.create(this.projectPath);
    const ignoreMatcher = createWatchPathMatcher(
      this.projectPath,
      this.config.indexing.excluded_patterns,
      gitignoreFilter,
    );

    this.watcher = chokidarWatch(this.projectPath, {
      ignored: (filePath: string, stats?: { isDirectory(): boolean }) =>
        ignoreMatcher(filePath, stats?.isDirectory()),
      ignoreInitial: true,
      persistent: true,
      usePolling: this.config.watch.use_polling_fallback,
      interval: this.config.watch.poll_interval_ms,
      binaryInterval: this.config.watch.poll_interval_ms,
      awaitWriteFinish: {
        stabilityThreshold: this.config.watch.debounce_ms,
        pollInterval: Math.floor(this.config.watch.poll_interval_ms / 4),
      },
    });

    this.watcher
      .on('add', (filePath: string) => this.queueEvent('add', filePath))
      .on('change', (filePath: string) => this.queueEvent('change', filePath))
      .on('unlink', (filePath: string) => this.queueEvent('unlink', filePath))
      .on('error', (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        appendWatchLog(this.projectPath, `[error] watcher: ${msg}`).catch(() => {});
      });

    return summary;
  }

  /** Stop the watcher and release resources. */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /** One-time scan: diff current files against state and ingest changes. */
  async reconcile(): Promise<WatchRunSummary> {
    const start = Date.now();
    let errors = 0;

    const state = await readWatchState(this.projectPath);
    const currentFiles = await scanProjectFiles(this.projectPath, {
      previousState: state,
      config: this.config,
    });
    const diff = diffFiles(state.files, currentFiles);

    // Limit if maxFiles set
    let upserts = diff.upserts;
    if (this.maxFiles && upserts.length > this.maxFiles) {
      upserts = upserts.slice(0, this.maxFiles);
    }

    const metadata = buildQueryMetadata(this.projectPath);
    const now = new Date().toISOString();

    // Process upserts
    for (const op of upserts) {
      try {
        const absolutePath = path.join(this.projectPath, op.path);
        const content = await fs.readFile(absolutePath, 'utf-8');
        const language = detectLanguage(op.path, this.config.indexing.extra_languages);

        await this.client.extraction.extractCode({
          code: content,
          language,
          file_path: op.path,
          metadata,
        });

        state.files[op.path] = { ...op.fingerprint, lastIndexedAt: now };
      } catch (error) {
        errors++;
        const msg = error instanceof Error ? error.message : String(error);
        await appendWatchLog(this.projectPath, `[error] ${op.path}: ${msg}`).catch(() => {});
      }
    }

    // Process renames
    for (const op of diff.renames) {
      delete state.files[op.oldPath];
      state.files[op.path] = { ...op.fingerprint, lastIndexedAt: now };
    }

    // Process deletes
    for (const op of diff.deletes) {
      delete state.files[op.path];
    }

    // Update health
    state.lastEventAt = now;
    if (errors === 0) state.lastSuccessAt = now;

    await writeWatchState(this.projectPath, state);

    return {
      upserts: upserts.length,
      deletes: diff.deletes.length,
      renames: diff.renames.length,
      errors,
      durationMs: Date.now() - start,
    };
  }

  /** Queue a filesystem event for debounced processing. */
  queueEvent(event: string, filePath: string): void {
    const relativePath = path.relative(this.projectPath, filePath).split(path.sep).join('/');

    if (event === 'unlink') {
      this.pendingDeletes.add(relativePath);
      this.pendingUpserts.delete(relativePath);
    } else {
      this.pendingUpserts.add(relativePath);
      this.pendingDeletes.delete(relativePath);
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.flushPendingChanges().catch((err) => {
        appendWatchLog(this.projectPath, `[error] flush: ${err}`).catch(() => {});
      });
    }, this.config.watch.debounce_ms);
  }

  /** Process all queued events. */
  async flushPendingChanges(): Promise<WatchRunSummary> {
    const start = Date.now();
    const upsertPaths = [...this.pendingUpserts];
    const deletePaths = [...this.pendingDeletes];
    this.pendingUpserts.clear();
    this.pendingDeletes.clear();

    const state = await readWatchState(this.projectPath);
    const metadata = buildQueryMetadata(this.projectPath);
    const now = new Date().toISOString();
    let errors = 0;

    for (const relativePath of upsertPaths) {
      try {
        const absolutePath = path.join(this.projectPath, relativePath);
        const content = await fs.readFile(absolutePath, 'utf-8');
        const language = detectLanguage(relativePath, this.config.indexing.extra_languages);
        const stat = await fs.stat(absolutePath);

        await this.client.extraction.extractCode({
          code: content,
          language,
          file_path: relativePath,
          metadata,
        });

        const { createHash } = await import('node:crypto');
        state.files[relativePath] = {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          sha256: createHash('sha256').update(content).digest('hex'),
          lastIndexedAt: now,
        };
      } catch (error) {
        errors++;
        const msg = error instanceof Error ? error.message : String(error);
        await appendWatchLog(this.projectPath, `[error] ${relativePath}: ${msg}`).catch(() => {});
      }
    }

    for (const relativePath of deletePaths) {
      delete state.files[relativePath];
    }

    state.lastEventAt = now;
    if (errors === 0) state.lastSuccessAt = now;
    await writeWatchState(this.projectPath, state);

    return {
      upserts: upsertPaths.length,
      deletes: deletePaths.length,
      renames: 0,
      errors,
      durationMs: Date.now() - start,
    };
  }
}
