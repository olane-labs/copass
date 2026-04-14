/**
 * Gitignore-aware path filtering.
 *
 * Parses root and nested .gitignore files to determine which paths
 * should be excluded from scanning.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { ALWAYS_IGNORED_DIRS } from './ignore-rules.js';

export class GitignoreFilter {
  private readonly rootIgnore: Ignore;
  private readonly nested = new Map<string, Ignore>();

  private constructor(rootContent: string) {
    this.rootIgnore = ignore().add(rootContent);
  }

  /**
   * Create a GitignoreFilter from a project root.
   * Returns null if the project has no .gitignore.
   */
  static create(rootPath: string): GitignoreFilter | null {
    const gitignorePath = path.join(rootPath, '.gitignore');
    try {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      return new GitignoreFilter(content);
    } catch {
      return null;
    }
  }

  /** Register a nested .gitignore discovered during directory walk. */
  addNestedGitignore(relativeDir: string, content: string): void {
    this.nested.set(relativeDir, ignore().add(content));
  }

  /**
   * Test whether a relative path should be ignored.
   * Checks root .gitignore first, then any nested .gitignore in parent directories.
   */
  isIgnored(relativePath: string, isDirectory: boolean): boolean {
    const testPath = isDirectory ? `${relativePath}/` : relativePath;

    if (this.rootIgnore.ignores(testPath)) {
      return true;
    }

    for (const [dir, ig] of this.nested) {
      if (relativePath.startsWith(`${dir}/`)) {
        const relative = relativePath.slice(dir.length + 1);
        const relativeTest = isDirectory ? `${relative}/` : relative;
        if (ig.ignores(relativeTest)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Pre-scan the project tree to discover all nested .gitignore files.
   */
  async loadAllNested(rootPath: string): Promise<void> {
    const walk = async (currentPath: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (ALWAYS_IGNORED_DIRS.has(entry.name)) continue;

        const absDir = path.join(currentPath, entry.name);
        const relDir = path.relative(rootPath, absDir).split(path.sep).join('/');

        if (this.isIgnored(relDir, true)) continue;

        const nestedPath = path.join(absDir, '.gitignore');
        try {
          const content = await fs.promises.readFile(nestedPath, 'utf-8');
          this.addNestedGitignore(relDir, content);
        } catch {
          // no .gitignore in this directory
        }

        await walk(absDir);
      }
    };

    await walk(rootPath);
  }
}
