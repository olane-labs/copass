import { BaseResource } from './base.js';
import type { CanonicalEntity, EntityPerspective } from '../types/entities.js';

export interface EntitySearchOptions {
  limit?: number;
  minSimilarity?: number;
  canonicalId?: string;
  /** Optional storage project id to narrow the search within the sandbox. */
  projectId?: string;
}

/**
 * Entities resource — query canonical entities in the knowledge graph.
 *
 * Search is **sandbox-scoped**: every call to {@link search} is constrained to
 * the supplied `sandboxId`, and may optionally be further narrowed by
 * `projectId`. The legacy `/api/v1/users/me/entities/search` endpoint is not
 * used by this SDK.
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

  /**
   * Sandbox-scoped entity search.
   *
   * Hits `GET /api/v1/storage/sandboxes/{sandboxId}/entities/search`, which
   * filters vector results to canonical **entities** (record_type `entity`)
   * ingested under that sandbox — internal record types like `node_path`,
   * `extraction_chunk`, and `behavior` are not returned. Pass `projectId` to
   * narrow further.
   */
  async search(
    sandboxId: string,
    q: string,
    options: EntitySearchOptions = {},
  ): Promise<CanonicalEntity[]> {
    const response = await this.get<{ results?: CanonicalEntity[] }>(
      `/api/v1/storage/sandboxes/${sandboxId}/entities/search`,
      {
        query: {
          q,
          limit: options.limit?.toString(),
          min_similarity: options.minSimilarity?.toString(),
          canonical_id: options.canonicalId,
          project_id: options.projectId,
        },
      },
    );
    return response.results ?? [];
  }
}
