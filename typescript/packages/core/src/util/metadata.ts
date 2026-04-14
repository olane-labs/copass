/**
 * Git repository metadata builder for API query context.
 */

import { execSync } from 'node:child_process';
import * as path from 'node:path';
import type { QueryMetadata } from '../types/common.js';

function execGit(args: string, cwd?: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Auto-detect git repo metadata from a directory.
 *
 * Extracts repo name (from git root basename), current branch,
 * and project path. Gracefully returns defaults if not in a git repo.
 */
export function buildQueryMetadata(projectPath?: string): QueryMetadata {
  const cwd = projectPath || process.cwd();
  const repoName = path.basename(execGit('rev-parse --show-toplevel', cwd) || cwd);
  const branch = execGit('rev-parse --abbrev-ref HEAD', cwd) || 'unknown';

  return {
    repo_name: repoName,
    project_path: cwd,
    branch,
  };
}
