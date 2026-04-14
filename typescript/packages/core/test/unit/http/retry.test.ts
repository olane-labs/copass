import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff } from '../../../src/http/retry.js';
import { CopassNetworkError } from '../../../src/http/errors.js';

describe('retryWithBackoff', () => {
  it('returns on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('500 Internal Server Error'))
      .mockResolvedValue('recovered');

    const result = await retryWithBackoff(fn, { maxAttempts: 3, backoffBaseMs: 1 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('503 Service Unavailable'));

    await expect(retryWithBackoff(fn, { maxAttempts: 2, backoffBaseMs: 1 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('400 Bad Request'));

    await expect(retryWithBackoff(fn, { maxAttempts: 3, backoffBaseMs: 1 })).rejects.toThrow(
      '400 Bad Request',
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('wraps network errors in CopassNetworkError', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fetch failed'));

    await expect(retryWithBackoff(fn, { maxAttempts: 2, backoffBaseMs: 1 })).rejects.toThrow(
      CopassNetworkError,
    );
  });

  it('respects fixed backoff strategy', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, {
      maxAttempts: 3,
      backoffBaseMs: 1,
      backoffStrategy: 'fixed',
    });
    expect(result).toBe('ok');
  });
});
