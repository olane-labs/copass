import { BaseResource } from './base.js';
import type { CanonicalEntity, EntityPerspective } from '../types/entities.js';

/**
 * Entities resource — query canonical entities in the knowledge graph.
 *
 * Extraction provenance is no longer exposed here. To inspect the sources
 * that produced an entity, list ingestion jobs or data sources via the
 * copass-id storage layer (`client.ingest` / `client.sources`).
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

  async search(
    q: string,
    options?: {
      limit?: number;
      recordType?: string;
      minSimilarity?: number;
      canonicalId?: string;
    },
  ): Promise<CanonicalEntity[]> {
    const response = await this.get<{ entities: CanonicalEntity[] }>(
      '/api/v1/users/me/entities/search',
      {
        query: {
          q,
          limit: options?.limit?.toString(),
          record_type: options?.recordType,
          min_similarity: options?.minSimilarity?.toString(),
          canonical_id: options?.canonicalId,
        },
      },
    );
    return response.entities;
  }
}
