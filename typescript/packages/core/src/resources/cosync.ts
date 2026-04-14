import { BaseResource } from './base.js';
import type { CosyncScoreRequest, CosyncScoreResponse } from '../types/cosync.js';

/**
 * Cosync resource — knowledge confidence scoring.
 */
export class CosyncResource extends BaseResource {
  async score(request: CosyncScoreRequest): Promise<CosyncScoreResponse> {
    return this.post<CosyncScoreResponse>('/api/v1/cosync', request);
  }
}
