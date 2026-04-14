import { describe, it, expect } from 'vitest';
import { shouldIgnorePath, diffFiles, createEmptyWatchState } from '../../../src/scan/files.js';
import type { WatchFileState } from '../../../src/types.js';

describe('shouldIgnorePath', () => {
  it('ignores .git directory', () => {
    expect(shouldIgnorePath('.git/config')).toBe(true);
  });

  it('ignores node_modules', () => {
    expect(shouldIgnorePath('node_modules/foo/index.js')).toBe(true);
  });

  it('ignores .olane directory', () => {
    expect(shouldIgnorePath('.olane/config.json')).toBe(true);
  });

  it('ignores default excluded dirs', () => {
    expect(shouldIgnorePath('dist/bundle.js')).toBe(true);
    expect(shouldIgnorePath('__pycache__/module.pyc')).toBe(true);
  });

  it('ignores binary files', () => {
    expect(shouldIgnorePath('image.png')).toBe(true);
    expect(shouldIgnorePath('archive.zip')).toBe(true);
  });

  it('ignores lock files', () => {
    expect(shouldIgnorePath('package-lock.json')).toBe(true);
    expect(shouldIgnorePath('yarn.lock')).toBe(true);
  });

  it('allows TypeScript files', () => {
    expect(shouldIgnorePath('src/index.ts')).toBe(false);
  });

  it('allows Python files', () => {
    expect(shouldIgnorePath('main.py')).toBe(false);
  });

  it('ignores files with unknown extensions', () => {
    expect(shouldIgnorePath('data.xyz')).toBe(true);
  });

  it('respects extra excluded patterns', () => {
    expect(shouldIgnorePath('src/generated.ts', ['*generated*'])).toBe(true);
  });

  it('ignores empty path', () => {
    expect(shouldIgnorePath('')).toBe(true);
  });

  it('ignores parent traversal', () => {
    expect(shouldIgnorePath('../etc/passwd')).toBe(true);
  });
});

describe('diffFiles', () => {
  const fileA: WatchFileState = { mtimeMs: 1000, size: 100, sha256: 'aaa', lastIndexedAt: null };
  const fileB: WatchFileState = { mtimeMs: 2000, size: 200, sha256: 'bbb', lastIndexedAt: null };
  const fileAChanged: WatchFileState = { mtimeMs: 3000, size: 100, sha256: 'aaa2', lastIndexedAt: null };

  it('detects added files', () => {
    const diff = diffFiles({}, { 'new.ts': fileA });
    expect(diff.upserts).toHaveLength(1);
    expect(diff.upserts[0].reason).toBe('added');
    expect(diff.upserts[0].path).toBe('new.ts');
  });

  it('detects changed files', () => {
    const diff = diffFiles({ 'a.ts': fileA }, { 'a.ts': fileAChanged });
    expect(diff.upserts).toHaveLength(1);
    expect(diff.upserts[0].reason).toBe('changed');
  });

  it('detects deleted files', () => {
    const diff = diffFiles({ 'old.ts': fileA }, {});
    expect(diff.deletes).toHaveLength(1);
    expect(diff.deletes[0].path).toBe('old.ts');
  });

  it('detects unchanged files', () => {
    const diff = diffFiles({ 'a.ts': fileA }, { 'a.ts': fileA });
    expect(diff.unchanged).toContain('a.ts');
    expect(diff.upserts).toHaveLength(0);
  });

  it('detects renames via SHA256 matching', () => {
    const diff = diffFiles(
      { 'old.ts': fileA },
      { 'new.ts': { ...fileA, mtimeMs: 5000 } },
    );
    expect(diff.renames).toHaveLength(1);
    expect(diff.renames[0].oldPath).toBe('old.ts');
    expect(diff.renames[0].path).toBe('new.ts');
  });

  it('handles empty states', () => {
    const diff = diffFiles({}, {});
    expect(diff.upserts).toHaveLength(0);
    expect(diff.deletes).toHaveLength(0);
    expect(diff.renames).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });
});

describe('createEmptyWatchState', () => {
  it('creates state with correct structure', () => {
    const state = createEmptyWatchState('/test/project');
    expect(state.version).toBe(1);
    expect(state.projectPath).toBe('/test/project');
    expect(state.files).toEqual({});
    expect(state.lastEventAt).toBeNull();
  });
});
