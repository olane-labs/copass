import { describe, it, expect } from 'vitest';
import { GitignoreFilter } from '../../../src/scan/gitignore.js';

describe('GitignoreFilter', () => {
  it('returns null for nonexistent project', () => {
    const filter = GitignoreFilter.create('/nonexistent/path');
    expect(filter).toBeNull();
  });
});
