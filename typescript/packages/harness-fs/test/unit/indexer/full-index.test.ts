import { describe, it, expect } from 'vitest';
import type { FullIndexOptions, FullIndexSummary } from '../../../src/types.js';

// Basic type tests — full integration tests require a mock CopassClient + temp project
describe('FullIndexOptions', () => {
  it('type is structurally correct', () => {
    const options: FullIndexOptions = {
      projectPath: '/tmp/test',
      maxFiles: 100,
      dryRun: true,
      onProgress: (msg) => console.log(msg),
    };
    expect(options.projectPath).toBe('/tmp/test');
    expect(options.dryRun).toBe(true);
  });
});

describe('FullIndexSummary', () => {
  it('type is structurally correct', () => {
    const summary: FullIndexSummary = {
      file_count: 100,
      indexed_count: 95,
      error_count: 5,
      skipped_count: 0,
      duration_ms: 1234,
      errors: [{ file: 'bad.ts', error: 'parse error' }],
    };
    expect(summary.indexed_count).toBe(95);
  });
});
