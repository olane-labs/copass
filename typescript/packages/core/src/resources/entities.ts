import { BaseResource } from './base.js';
import type { CanonicalEntity, EntityPerspective, ExtractionSource } from '../types/entities.js';

/**
 * Entities resource — manage canonical entities.
 */
export class EntitiesResource extends BaseResource {
  async list(): Promise<CanonicalEntity[]> {
    const response = await this.get<{ canonical_entities: CanonicalEntity[] }>(
      '/api/v1/users/me/canonical-entities',
    );
    return response.canonical_entities;
  }

  async getPerspective(canonicalId: string): Promise<EntityPerspective> {
    return this.get<EntityPerspective>(
      `/api/v1/users/me/canonical-entities/${canonicalId}/perspective`,
    );
  }

  async getExtractionSources(canonicalId: string): Promise<ExtractionSource[]> {
    return this.get<ExtractionSource[]>(
      `/api/v1/users/me/canonical-entities/${canonicalId}/extraction-sources`,
    );
  }
}
