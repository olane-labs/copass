import type { ScoreTier, QueryMetadata } from './common.js';
import type { EntityScore, LearningPriority } from './cosync.js';

/** Request for plan-level knowledge scoring (v2). */
export interface PlanScoreRequest {
  plan_text: string;
  entities?: Array<{ name: string; hop_distance: number }>;
  project_id?: string;
  metadata?: QueryMetadata;
}

/** Response from plan-level knowledge scoring. */
export interface PlanScoreResponse {
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
