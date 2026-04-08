import type { UsageResponse, UsageBalance } from '../types/usage.js';

/**
 * Usage resource — token consumption and credit tracking.
 *
 * Endpoints: GET /usage, GET /usage/balance
 */
export interface UsageResource {
  /** Get token consumption and cost breakdown. */
  get(): Promise<UsageResponse>;

  /** Get token credit balance. */
  getBalance(): Promise<UsageBalance>;
}
