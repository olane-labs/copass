import type { PlanScoreRequest, PlanScoreResponse } from '../types/plans.js';

/**
 * Plans resource — plan-level knowledge scoring (v2).
 *
 * Endpoint: POST /plans/cosync
 */
export interface PlansResource {
  /** Score a coding plan's knowledge confidence. */
  score(request: PlanScoreRequest): Promise<PlanScoreResponse>;
}
