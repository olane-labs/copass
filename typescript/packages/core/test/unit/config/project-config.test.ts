import { describe, it, expect } from 'vitest';
import {
  ProjectConfigSchema,
  defaultProjectConfig,
  normalizeProjectConfig,
  mergeConfigs,
} from '../../../src/config/index.js';

describe('ProjectConfigSchema', () => {
  it('parses empty object with all defaults', () => {
    const config = ProjectConfigSchema.parse({});
    expect(config.version).toBe('2.0');
    expect(config.copass.silent_threshold).toBe(0.85);
    expect(config.copass.ask_threshold).toBe(0.6);
    expect(config.copass.block_threshold).toBe(0.3);
    expect(config.indexing.concurrency).toBe(25);
    expect(config.indexing.max_file_size_kb).toBe(100);
    expect(config.indexing.excluded_patterns).toContain('node_modules');
    expect(config.watch.enabled).toBe(true);
    expect(config.watch.debounce_ms).toBe(1500);
    expect(config.retry.max_attempts).toBe(3);
    expect(config.retry.backoff_strategy).toBe('exponential');
    expect(config.pipelines).toEqual([]);
    expect(config.profiles).toEqual([]);
    expect(config.defaults.response_format).toBe('natural_language');
  });

  it('parses a config with custom values', () => {
    const config = ProjectConfigSchema.parse({
      version: '2.1',
      project_id: 'proj-123',
      copass: { silent_threshold: 0.9 },
      indexing: { concurrency: 50 },
    });
    expect(config.version).toBe('2.1');
    expect(config.project_id).toBe('proj-123');
    expect(config.copass.silent_threshold).toBe(0.9);
    expect(config.copass.ask_threshold).toBe(0.6); // default preserved
    expect(config.indexing.concurrency).toBe(50);
  });

  it('parses pipelines', () => {
    const config = ProjectConfigSchema.parse({
      pipelines: [
        {
          name: 'docs',
          match: { extensions: ['.md', '.rst'] },
          source_type: 'documentation',
          transforms: [{ type: 'strip_comments' }],
        },
      ],
    });
    expect(config.pipelines).toHaveLength(1);
    expect(config.pipelines[0].name).toBe('docs');
    expect(config.pipelines[0].enabled).toBe(true); // default
  });

  it('parses profiles', () => {
    const config = ProjectConfigSchema.parse({
      profiles: [
        {
          name: 'quick',
          query_type: 'context',
          max_tokens: 4000,
          skip_cache: true,
        },
      ],
    });
    expect(config.profiles).toHaveLength(1);
    expect(config.profiles[0].query_type).toBe('context');
    expect(config.profiles[0].skip_cache).toBe(true);
  });

  it('rejects invalid thresholds', () => {
    const result = ProjectConfigSchema.safeParse({
      copass: { silent_threshold: 2.0 },
    });
    expect(result.success).toBe(false);
  });
});

describe('defaultProjectConfig', () => {
  it('returns valid config with all defaults', () => {
    const config = defaultProjectConfig();
    expect(config.version).toBe('2.0');
    expect(config.pipelines).toEqual([]);
  });
});

describe('normalizeProjectConfig', () => {
  it('returns defaults for empty input', () => {
    const config = normalizeProjectConfig({});
    expect(config.version).toBe('2.0');
  });

  it('returns defaults for invalid input', () => {
    const config = normalizeProjectConfig({ copass: { silent_threshold: 'not a number' } } as unknown as Record<string, unknown>);
    expect(config.version).toBe('2.0');
    expect(config.copass.silent_threshold).toBe(0.85);
  });

  it('preserves valid overrides', () => {
    const config = normalizeProjectConfig({ indexing: { concurrency: 10 } });
    expect(config.indexing.concurrency).toBe(10);
  });
});

describe('mergeConfigs', () => {
  it('deep merges nested objects', () => {
    const target = { copass: { silent_threshold: 0.85, ask_threshold: 0.6 } };
    const source = { copass: { silent_threshold: 0.9 } };
    const result = mergeConfigs(target, source);
    expect(result).toEqual({ copass: { silent_threshold: 0.9, ask_threshold: 0.6 } });
  });

  it('replaces arrays', () => {
    const target = { pipelines: [{ name: 'a' }] };
    const source = { pipelines: [{ name: 'b' }] };
    const result = mergeConfigs(target, source);
    expect(result).toEqual({ pipelines: [{ name: 'b' }] });
  });

  it('adds new keys', () => {
    const result = mergeConfigs({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });
});
