import type { ScoreTier, QueryMetadata } from './common.js';

/** Request for knowledge confidence scoring. */
export interface CosyncScoreRequest {
  canonical_ids?: string[];
  text?: string;
  project_id?: string;
  metadata?: QueryMetadata;
}

/** Dimension detail in a cosync score. */
export interface DimensionDetail {
  name: string;
  score: number;
  weight: number;
  signals: Record<string, unknown>;
  saturation_pct: Record<string, number>;
}

/** Per-entity score in a cosync response. */
export interface EntityScore {
  entity_name: string;
  canonical_id: string | null;
  score: number;
  dimensions: Record<string, DimensionDetail>;
  dominant_deficit: string;
  deficit_gap: number;
}

/** Learning priority recommendation. */
export interface LearningPriority {
  entity_name: string;
  canonical_id: string | null;
  deficit_dimension: string;
  deficit_gap: number;
  score: number;
}

/** Response from cosync scoring. */
export interface CosyncScoreResponse {
  aggregate_score: number;
  tier: ScoreTier;
  tier_label: string;
  tier_action: string;
  model_recommendation: string;
  entities: EntityScore[];
  weakest_entity: string | null;
  recommendation: string;
  learning_priorities: LearningPriority[];
  is_cold_start: boolean;
  computation_time_ms: number;
  computed_at: string;
}
