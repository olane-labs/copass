/**
 * Full project indexing — end-to-end scan, register, ingest, complete.
 *
 * Accepts a CopassClient for all API communication.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CopassClient } from '@copass/core';
import {
  defaultProjectConfig,
  detectLanguage,
  matchPipeline,
  applyTransforms,
} from '@copass/core';
import type { FullIndexOptions, FullIndexSummary } from '../types.js';
import { scanProjectFiles } from '../scan/files.js';

/**
 * Run a full project index: scan files, register project, ingest all files,
 * mark project complete.
 */
export async function runFullIndex(
  client: CopassClient,
  options: FullIndexOptions,
): Promise<FullIndexSummary> {
  const start = Date.now();
  const config = options.config ?? defaultProjectConfig();
  const maxFiles = options.maxFiles ?? 10_000;
  const progress = options.onProgress ?? (() => {});

  // 1. Scan files
  progress('Scanning project files...');
  const allFiles = await scanProjectFiles(options.projectPath, { config });
  let filePaths = Object.keys(allFiles);

  if (filePaths.length > maxFiles) {
    progress(`Capping at ${maxFiles} files (found ${filePaths.length})`);
    filePaths = filePaths.slice(0, maxFiles);
  }

  progress(`Found ${filePaths.length} files to index`);

  if (options.dryRun) {
    return {
      file_count: filePaths.length,
      indexed_count: 0,
      error_count: 0,
      skipped_count: 0,
      duration_ms: Date.now() - start,
      errors: [],
    };
  }

  // 2. Resolve or create a storage project inside the caller's sandbox.
  // Caller must supply sandboxId; projectId optional (defaults to a new project).
  if (!options.sandboxId) {
    throw new Error(
      'runFullIndex requires `sandboxId`. Create one with client.sandboxes.create() or pass the caller\'s primary sandbox_id.',
    );
  }
  const sandboxId = options.sandboxId;

  let projectId = options.projectId;
  if (!projectId) {
    progress('Creating storage project...');
    const project = await client.projects.create(sandboxId, {
      name: path.basename(options.projectPath),
      metadata: { project_path: options.projectPath, indexing_mode: 'full' },
    });
    projectId = project.project_id;
  }

  // 3. Index files with concurrency control
  const concurrency = config.indexing.concurrency;
  let indexed = 0;
  let errorCount = 0;
  const skipped = 0;
  const errors: Array<{ file: string; error: string }> = [];

  const queue = [...filePaths];

  const processFile = async (relativePath: string): Promise<void> => {
    try {
      const absolutePath = path.join(options.projectPath, relativePath);
      const content = await fs.readFile(absolutePath, 'utf-8');

      // Check for pipeline match
      const pipeline = matchPipeline(relativePath, config.pipelines);
      const language = pipeline?.language_override ?? detectLanguage(relativePath, config.indexing.extra_languages);
      let processedContent = content;

      if (pipeline?.transforms) {
        processedContent = applyTransforms(content, pipeline.transforms);
      }

      await client.ingest.textInSandbox(sandboxId, {
        text: processedContent,
        source_type: pipeline?.source_type ?? 'code',
        project_id: projectId,
      });
      void language;

      indexed++;
    } catch (error) {
      errorCount++;
      const msg = error instanceof Error ? error.message : String(error);
      errors.push({ file: relativePath, error: msg });
    }
  };

  // Process with concurrency limit
  const workers: Promise<void>[] = [];
  const runWorker = async () => {
    while (queue.length > 0) {
      const file = queue.shift()!;
      await processFile(file);

      if ((indexed + errorCount) % 50 === 0) {
        progress(`Indexed ${indexed}/${filePaths.length} files (${errorCount} errors)`);
      }
    }
  };

  for (let i = 0; i < concurrency; i++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);

  const summary: FullIndexSummary = {
    file_count: filePaths.length,
    indexed_count: indexed,
    error_count: errorCount,
    skipped_count: skipped,
    duration_ms: Date.now() - start,
    errors,
  };

  progress(`Done: ${indexed} indexed, ${errorCount} errors, ${summary.duration_ms}ms`);
  return summary;
}
