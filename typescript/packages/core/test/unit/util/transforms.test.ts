import { describe, it, expect } from 'vitest';
import { applyTransforms } from '../../../src/util/transforms.js';

describe('applyTransforms', () => {
  it('strip_comments removes full-line C-style comments', () => {
    const result = applyTransforms('// this is a comment\nconst y = 2;', [
      { type: 'strip_comments' },
    ]);
    expect(result).not.toContain('// this is a comment');
    expect(result).toContain('const y = 2;');
  });

  it('strip_comments removes block comments', () => {
    const result = applyTransforms('/* block */\ncode();', [{ type: 'strip_comments' }]);
    expect(result).not.toContain('block');
    expect(result).toContain('code()');
  });

  it('strip_comments removes Python docstrings', () => {
    const result = applyTransforms('"""docstring"""\ndef foo(): pass', [
      { type: 'strip_comments' },
    ]);
    expect(result).not.toContain('docstring');
    expect(result).toContain('def foo()');
  });

  it('strip_comments removes shell comments', () => {
    const result = applyTransforms('# comment\necho hi', [{ type: 'strip_comments' }]);
    expect(result).not.toContain('# comment');
    expect(result).toContain('echo hi');
  });

  it('truncate by max_lines', () => {
    const input = 'line1\nline2\nline3\nline4\nline5';
    const result = applyTransforms(input, [
      { type: 'truncate', options: { max_lines: 3 } },
    ]);
    expect(result.split('\n')).toHaveLength(3);
  });

  it('truncate by max_chars', () => {
    const result = applyTransforms('abcdefghij', [
      { type: 'truncate', options: { max_chars: 5 } },
    ]);
    expect(result).toBe('abcde');
  });

  it('prepend_context adds context before content', () => {
    const result = applyTransforms('body', [
      { type: 'prepend_context', options: { context: 'CONTEXT' } },
    ]);
    expect(result).toBe('CONTEXT\n\nbody');
  });

  it('custom_header adds header line', () => {
    const result = applyTransforms('body', [
      { type: 'custom_header', options: { header: '--- HEADER ---' } },
    ]);
    expect(result).toBe('--- HEADER ---\nbody');
  });

  it('applies transforms in sequence', () => {
    const input = '// comment\nline1\nline2\nline3';
    const result = applyTransforms(input, [
      { type: 'strip_comments' },
      { type: 'truncate', options: { max_lines: 2 } },
      { type: 'custom_header', options: { header: '# processed' } },
    ]);
    expect(result.startsWith('# processed')).toBe(true);
    expect(result).not.toContain('// comment');
  });

  it('skips unknown transforms', () => {
    const result = applyTransforms('hello', [
      { type: 'nonexistent' as 'strip_comments' },
    ]);
    expect(result).toBe('hello');
  });
});
