/** Git repository metadata included with requests. */
export interface QueryMetadata {
  repo_name: string;
  project_path: string;
  branch: string;
}

/** Knowledge confidence tier classification. */
export type ScoreTier = 'safe' | 'review' | 'caution' | 'critical' | 'cold_start';

/** Retry configuration for transient failures. */
export interface RetryConfig {
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffStrategy?: 'exponential' | 'linear' | 'fixed';
}

/** Detail level for query responses. */
export type DetailLevel = 'concise' | 'summary' | 'detailed' | 'full';

/** Matrix search preset names. */
export type SearchPreset =
  | 'copass/1.0'
  | 'copass/2.0'
  | 'copass/1.0:thinking'
  | 'copass/2.0:thinking';
