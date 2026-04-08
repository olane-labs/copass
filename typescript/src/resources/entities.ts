import type {
  CanonicalEntity,
  EntityPerspective,
  ExtractionSource,
} from '../types/entities.js';

/**
 * Entities resource — manage canonical entities.
 *
 * Endpoints: GET /users/me/canonical-entities, /canonical-entities/{id}/perspective
 */
export interface EntitiesResource {
  /** List all canonical entities for the authenticated user. */
  list(): Promise<CanonicalEntity[]>;

  /** Get full perspective of a canonical entity. */
  getPerspective(canonicalId: string): Promise<EntityPerspective>;

  /** List extraction sources for a canonical entity. */
  getExtractionSources(canonicalId: string): Promise<ExtractionSource[]>;
}
