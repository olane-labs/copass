/**
 * Pipeline resolver — matches files to ingestion pipelines.
 *
 * Walks the pipelines array in declaration order (first match wins).
 * Returns null when no pipeline matches (default behavior applies).
 */

import * as path from 'node:path';
import type { IngestionPipeline } from '../config/index.js';

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

function matchesExtensions(relativePath: string, extensions: string[]): boolean {
  const ext = path.extname(relativePath).toLowerCase();
  return extensions.some((e) => {
    const normalized = e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`;
    return ext === normalized;
  });
}

function matchesDirectories(relativePath: string, directories: string[]): boolean {
  const normalized = normalizeRelativePath(relativePath);
  return directories.some((dir) => {
    const normalizedDir = normalizeRelativePath(dir.replace(/\/$/, ''));
    return normalized.startsWith(`${normalizedDir}/`) || normalized === normalizedDir;
  });
}

function matchesGlob(relativePath: string, glob: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  return globToRegExp(glob).test(normalized);
}

/**
 * Match a file path against the pipeline list. First match wins.
 * Returns null if no pipeline matches (use default ingestion behavior).
 */
export function matchPipeline(
  relativePath: string,
  pipelines: IngestionPipeline[],
): IngestionPipeline | null {
  for (const pipeline of pipelines) {
    if (!pipeline.enabled) continue;

    const { match } = pipeline;

    if (match.extensions && matchesExtensions(relativePath, match.extensions)) {
      return pipeline;
    }

    if (match.directories && matchesDirectories(relativePath, match.directories)) {
      return pipeline;
    }

    if (match.glob && matchesGlob(relativePath, match.glob)) {
      return pipeline;
    }
  }

  return null;
}
