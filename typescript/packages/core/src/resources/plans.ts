import { BaseResource } from './base.js';
import type { PlanScoreRequest, PlanScoreResponse } from '../types/plans.js';

/**
 * Plans resource — plan-level knowledge scoring (v2).
 */
export class PlansResource extends BaseResource {
  async score(request: PlanScoreRequest): Promise<PlanScoreResponse> {
    return this.post<PlanScoreResponse>('/api/v2/plans/cosync', request);
  }
}
