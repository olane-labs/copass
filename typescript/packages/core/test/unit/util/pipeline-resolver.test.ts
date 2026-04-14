import { describe, it, expect } from 'vitest';
import { matchPipeline } from '../../../src/util/pipeline-resolver.js';
import type { IngestionPipeline } from '../../../src/config/index.js';

function makePipeline(overrides: Partial<IngestionPipeline> & { name: string; match: IngestionPipeline['match'] }): IngestionPipeline {
  return {
    enabled: true,
    materialize: false,
    ...overrides,
  };
}

describe('matchPipeline', () => {
  const pipelines: IngestionPipeline[] = [
    makePipeline({ name: 'docs', match: { extensions: ['.md', '.rst'] }, source_type: 'documentation' }),
    makePipeline({ name: 'tests', match: { directories: ['test', 'tests'] } }),
    makePipeline({ name: 'configs', match: { glob: '**/*.config.*' } }),
    makePipeline({ name: 'disabled', match: { extensions: ['.ts'] }, enabled: false }),
  ];

  it('matches by extension', () => {
    const result = matchPipeline('docs/readme.md', pipelines);
    expect(result?.name).toBe('docs');
  });

  it('matches by extension without leading dot', () => {
    const docsWithoutDot = [makePipeline({ name: 'docs', match: { extensions: ['md'] } })];
    const result = matchPipeline('readme.md', docsWithoutDot);
    expect(result?.name).toBe('docs');
  });

  it('matches by directory', () => {
    const result = matchPipeline('test/unit/foo.ts', pipelines);
    expect(result?.name).toBe('tests');
  });

  it('matches by glob', () => {
    const result = matchPipeline('src/vite.config.ts', pipelines);
    expect(result?.name).toBe('configs');
  });

  it('returns null for no match', () => {
    const result = matchPipeline('src/main.go', pipelines);
    expect(result).toBeNull();
  });

  it('skips disabled pipelines', () => {
    const result = matchPipeline('src/index.ts', pipelines);
    expect(result).toBeNull(); // the .ts pipeline is disabled
  });

  it('returns first match (order matters)', () => {
    const result = matchPipeline('docs/guide.rst', pipelines);
    expect(result?.name).toBe('docs');
  });
});
