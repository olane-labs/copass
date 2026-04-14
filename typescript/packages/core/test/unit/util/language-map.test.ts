import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  isIndexableCodePath,
  buildLanguageMap,
  DEFAULT_LANGUAGE_MAP,
} from '../../../src/util/language-map.js';

describe('detectLanguage', () => {
  it('detects TypeScript', () => {
    expect(detectLanguage('src/index.ts')).toBe('typescript');
    expect(detectLanguage('component.tsx')).toBe('typescript');
  });

  it('detects Python', () => {
    expect(detectLanguage('script.py')).toBe('python');
  });

  it('detects Rust', () => {
    expect(detectLanguage('lib.rs')).toBe('rust');
  });

  it('detects Dockerfile by basename', () => {
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
  });

  it('detects Makefile by basename', () => {
    expect(detectLanguage('Makefile')).toBe('makefile');
  });

  it('returns text for unknown extensions', () => {
    expect(detectLanguage('file.xyz')).toBe('text');
  });

  it('is case-insensitive on extension', () => {
    expect(detectLanguage('FILE.TS')).toBe('typescript');
    expect(detectLanguage('app.PY')).toBe('python');
  });

  it('merges extra languages', () => {
    expect(detectLanguage('file.custom', { '.custom': 'my-lang' })).toBe('my-lang');
  });

  it('extra languages override defaults', () => {
    expect(detectLanguage('file.ts', { '.ts': 'custom-ts' })).toBe('custom-ts');
  });
});

describe('isIndexableCodePath', () => {
  it('returns true for known code files', () => {
    expect(isIndexableCodePath('main.go')).toBe(true);
    expect(isIndexableCodePath('style.css')).toBe(true);
  });

  it('returns false for unknown files', () => {
    expect(isIndexableCodePath('image.png')).toBe(false);
    expect(isIndexableCodePath('data.bin')).toBe(false);
  });
});

describe('buildLanguageMap', () => {
  it('returns defaults when no extras', () => {
    expect(buildLanguageMap()).toBe(DEFAULT_LANGUAGE_MAP);
    expect(buildLanguageMap({})).toBe(DEFAULT_LANGUAGE_MAP);
  });

  it('merges extras into defaults', () => {
    const map = buildLanguageMap({ '.foo': 'foo-lang' });
    expect(map['.foo']).toBe('foo-lang');
    expect(map['.ts']).toBe('typescript');
  });
});
