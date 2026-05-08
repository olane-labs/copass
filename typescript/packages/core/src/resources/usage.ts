import { BaseResource } from './base.js';
import type { UsageResponse, UsageBalance } from '../types/usage.js';

/**
 * Usage resource — token consumption and credit tracking.
 */
export class UsageResource extends BaseResource {
  async getSummary(): Promise<UsageResponse> {
    return this.get<UsageResponse>('/api/v1/usage');
  }

  async getBalance(): Promise<UsageBalance> {
    return this.get<UsageBalance>('/api/v1/usage/balance');
  }
}
