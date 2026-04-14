/**
 * Retry with configurable backoff strategy.
 */

import type { RetryConfig } from '../types/common.js';
import { CopassNetworkError } from './errors.js';

const RETRYABLE_PATTERN = /5\d{2}|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch failed/i;
const NETWORK_ERROR_PATTERN = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/i;

function computeDelay(attempt: number, strategy: NonNullable<RetryConfig['backoffStrategy']>, baseMs: number): number {
  switch (strategy) {
    case 'exponential':
      return Math.pow(2, attempt) * baseMs;
    case 'linear':
      return (attempt + 1) * baseMs;
    case 'fixed':
      return baseMs;
  }
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config?: RetryConfig,
): Promise<T> {
  const maxAttempts = config?.maxAttempts ?? 3;
  const baseMs = config?.backoffBaseMs ?? 1000;
  const strategy = config?.backoffStrategy ?? 'exponential';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isRetryable = RETRYABLE_PATTERN.test(message);

      if (!isRetryable || attempt === maxAttempts - 1) {
        if (NETWORK_ERROR_PATTERN.test(message)) {
          throw new CopassNetworkError(
            'Network request failed — check your internet connection and try again',
            error instanceof Error ? error : undefined,
          );
        }
        throw error;
      }

      const delayMs = computeDelay(attempt, strategy, baseMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error('Unreachable');
}
