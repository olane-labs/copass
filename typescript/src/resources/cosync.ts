import type { CosyncScoreRequest, CosyncScoreResponse } from '../types/cosync.js';

/**
 * Cosync resource — knowledge confidence scoring.
 *
 * Endpoint: POST /cosync
 */
export interface CosyncResource {
  /** Score entities by knowledge confidence. */
  score(request: CosyncScoreRequest): Promise<CosyncScoreResponse>;
}
