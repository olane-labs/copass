import { BaseResource } from './base.js';
import type { CanonicalEntity } from '../types/entities.js';

export interface EntitySearchOptions {
  limit?: number;
  minSimilarity?: number;
  canonicalId?: string;
  /** Optional storage project id to narrow the search within the sandbox. */
  projectId?: string;
}

/**
 * Entities resource — sandbox-scoped entity name search.
 *
 * Used to resolve a free-text entity name (e.g. "Stripe") to a canonical
 * id before passing it into a retrieval call. The full ontology surface
 * (per-canonical perspective trees, behavior listings, raw containment)
 * is intentionally not exposed through the public SDK.
 */
export class EntitiesResource extends BaseResource {
  /**
   * Sandbox-scoped entity search.
   *
   * Hits `GET /api/v1/storage/sandboxes/{sandboxId}/entities/search`, which
   * filters vector results to canonical **entities** (record_type `entity`)
   * ingested under that sandbox. Pass `projectId` to narrow further.
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
