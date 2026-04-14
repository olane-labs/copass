/**
 * Incremental indexing — plan and execute file reconciliation.
 */

import type { CopassClient, ProjectConfig } from '@copass/core';
import { defaultProjectConfig } from '@copass/core';
import type { DiffResult } from '../types.js';
import { scanProjectFiles, diffFiles } from '../scan/files.js';
import { readWatchState } from './state.js';
import { ProjectWatchRuntime } from './runtime.js';
import type { WatchRunSummary } from './runtime.js';

export interface IncrementalIndexPlan {
  diff: DiffResult;
  totalChanges: number;
  capped: boolean;
}

/**
 * Plan an incremental index without executing it.
 * Returns the diff and whether it was capped by maxFiles.
 */
export async function planIncrementalIndex(
  projectPath: string,
  config?: ProjectConfig,
  maxFiles?: number,
): Promise<IncrementalIndexPlan> {
  const resolvedConfig = config ?? defaultProjectConfig();
  const state = await readWatchState(projectPath);
  const currentFiles = await scanProjectFiles(projectPath, {
    previousState: state,
    config: resolvedConfig,
  });
  const diff = diffFiles(state.files, currentFiles);

  const totalChanges = diff.upserts.length + diff.deletes.length + diff.renames.length;
  let capped = false;

  if (maxFiles && diff.upserts.length > maxFiles) {
    diff.upserts = diff.upserts.slice(0, maxFiles);
    capped = true;
  }

  return { diff, totalChanges, capped };
}

/**
 * Execute an incremental index — scan, diff, and ingest changes.
 */
export async function runIncrementalIndex(
  client: CopassClient,
  projectPath: string,
  sandboxId: string,
  options: { config?: ProjectConfig; maxFiles?: number; projectId?: string } = {},
): Promise<WatchRunSummary> {
  const runtime = new ProjectWatchRuntime(client, {
    projectPath,
    config: options.config,
    maxFiles: options.maxFiles,
    sandboxId,
    projectId: options.projectId,
  });
  return runtime.reconcile();
}
