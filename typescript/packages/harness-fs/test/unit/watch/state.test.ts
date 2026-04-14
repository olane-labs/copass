import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { readWatchState, writeWatchState } from '../../../src/watch/state.js';

describe('watch state persistence', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copass-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty state when no file exists', async () => {
    const state = await readWatchState(tmpDir);
    expect(state.version).toBe(1);
    expect(state.projectPath).toBe(tmpDir);
    expect(state.files).toEqual({});
  });

  it('roundtrips state through write/read', async () => {
    const original = {
      version: 1 as const,
      projectPath: tmpDir,
      files: {
        'src/index.ts': { mtimeMs: 1000, size: 500, sha256: 'abc123', lastIndexedAt: '2026-01-01T00:00:00Z' },
      },
      lastEventAt: '2026-01-01T00:00:00Z',
      lastSuccessAt: '2026-01-01T00:00:00Z',
      lastError: null,
    };

    await writeWatchState(tmpDir, original);
    const loaded = await readWatchState(tmpDir);

    expect(loaded.version).toBe(1);
    expect(loaded.files['src/index.ts'].sha256).toBe('abc123');
    expect(loaded.lastEventAt).toBe('2026-01-01T00:00:00Z');
  });

  it('handles corrupt state file gracefully', async () => {
    const statePath = path.join(tmpDir, '.olane', 'watch-state.json');
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, 'not json');

    const state = await readWatchState(tmpDir);
    expect(state.version).toBe(1);
    expect(state.files).toEqual({});
  });

  it('drops file entries with invalid shapes', async () => {
    const statePath = path.join(tmpDir, '.olane', 'watch-state.json');
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify({
      version: 1,
      projectPath: tmpDir,
      files: {
        'good.ts': { mtimeMs: 1, size: 2, sha256: 'abc', lastIndexedAt: null },
        'bad.ts': { mtimeMs: 'not a number', size: 2, sha256: 'abc' },
      },
    }));

    const state = await readWatchState(tmpDir);
    expect(Object.keys(state.files)).toEqual(['good.ts']);
  });
});
