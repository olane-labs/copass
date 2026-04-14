/** A canonical entity in the knowledge graph. */
export interface CanonicalEntity {
  canonical_id: string;
  name: string;
  origin_priority?: number;
  semantic_tags?: string[];
  node_count?: number;
  behavior_count?: number;
}

/** Full perspective of a canonical entity. */
export interface EntityPerspective {
  canonical_id: string;
  name: string;
  behaviors: Behavior[];
  metadata?: Record<string, unknown>;
  portals?: Record<string, unknown>[];
  time_series?: Record<string, unknown>;
}

/** A behavior associated with a canonical entity. */
export interface Behavior {
  path_ids: string[];
  path_names: string[];
  depth: number;
  provenance?: ProvenanceMetadata;
}

/** Provenance tracking for extracted data. */
export interface ProvenanceMetadata {
  source_type?: string;
  confidence?: number;
  extraction_timestamp?: string;
  reasoning?: string;
  source_event_id?: string;
  extraction_batch_id?: string;
}

