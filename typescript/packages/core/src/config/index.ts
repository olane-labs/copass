/**
 * Project configuration schemas.
 *
 * Zod-based validation for .olane/config.json project configuration.
 * These schemas define the structure but do NOT perform filesystem access —
 * loading config from disk is the caller's responsibility.
 */

import { z } from 'zod';

// -- Copass scoring --

export const CopassModelRoutingSchema = z.object({
  high_confidence: z.string().default('opus'),
  medium_confidence: z.string().default('opus'),
  low_confidence: z.string().default('opus'),
});

export const ScoreThresholdSchema = z.object({
  min: z.number().min(0).max(1),
  label: z.string(),
});

export const ScoreThresholdsSchema = z.object({
  safe: ScoreThresholdSchema.default({ min: 0.85, label: 'safe' }),
  review: ScoreThresholdSchema.default({ min: 0.6, label: 'review' }),
  caution: ScoreThresholdSchema.default({ min: 0.3, label: 'caution' }),
  critical: ScoreThresholdSchema.default({ min: 0, label: 'critical' }),
});

export const CopassConfigSchema = z.object({
  silent_threshold: z.number().min(0).max(1).default(0.85),
  ask_threshold: z.number().min(0).max(1).default(0.6),
  block_threshold: z.number().min(0).max(1).default(0.3),
  model_routing: CopassModelRoutingSchema.default({}),
  score_thresholds: ScoreThresholdsSchema.optional(),
});

// -- Indexing --

export const IndexingConfigSchema = z.object({
  auto_incremental: z.boolean().default(true),
  full_reindex_schedule: z.enum(['daily', 'weekly', 'monthly', 'manual']).default('weekly'),
  max_file_size_kb: z.number().positive().default(100),
  excluded_patterns: z
    .array(z.string())
    .default(['node_modules', '.git', '__pycache__', 'dist', 'build']),
  concurrency: z.number().int().positive().max(100).default(25),
  extra_languages: z.record(z.string(), z.string()).optional(),
  extra_ignored_dirs: z.array(z.string()).optional(),
});

// -- Watch --

export const WatchConfigSchema = z.object({
  enabled: z.boolean().default(true),
  debounce_ms: z.number().positive().default(1500),
  poll_interval_ms: z.number().positive().default(2000),
  use_polling_fallback: z.boolean().default(true),
  service_id: z.string().optional(),
  service_platform: z.string().nullable().optional(),
});

// -- Retry --

export const RetryConfigSchema = z.object({
  max_attempts: z.number().int().min(1).max(10).default(3),
  backoff_base_ms: z.number().positive().default(1000),
  backoff_strategy: z.enum(['exponential', 'linear', 'fixed']).default('exponential'),
});

// -- Ingestion Pipeline --

export const IngestionTransformSchema = z.object({
  type: z.enum(['strip_comments', 'truncate', 'prepend_context', 'custom_header']),
  options: z.record(z.unknown()).optional(),
});

export const PipelineMatchSchema = z.object({
  extensions: z.array(z.string()).optional(),
  directories: z.array(z.string()).optional(),
  glob: z.string().optional(),
});

export const IngestionPipelineSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  match: PipelineMatchSchema,
  source_type: z.string().optional(),
  language_override: z.string().optional(),
  entity_hints: z.array(z.string()).optional(),
  additional_context: z.string().optional(),
  materialize: z.boolean().default(false),
  transforms: z.array(IngestionTransformSchema).optional(),
  max_file_size_kb: z.number().positive().optional(),
  enabled: z.boolean().default(true),
});

// -- Retrieval Profiles --

export const RetrievalProfileSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  query_type: z.enum(['question', 'context', 'score']).default('context'),
  response_format: z.enum(['natural_language', 'structured', 'raw']).default('natural_language'),
  max_results: z.number().int().positive().optional(),
  max_tokens: z.number().int().min(100).max(16000).optional(),
  detail_level: z.enum(['concise', 'summary', 'detailed', 'full']).optional(),
  thinking: z.boolean().default(false),
  skip_cache: z.boolean().default(false),
  query_all_projects: z.boolean().default(false),
});

// -- Defaults --

export const DefaultsConfigSchema = z.object({
  response_format: z.enum(['natural_language', 'structured', 'raw']).default('natural_language'),
  materialize: z.boolean().default(false),
  api_url: z.string().url().optional(),
});

// -- Root Project Config --

export const ProjectConfigSchema = z.object({
  version: z.string().default('2.0'),
  project_id: z.string().optional(),

  copass: CopassConfigSchema.default({}),
  indexing: IndexingConfigSchema.default({}),
  watch: WatchConfigSchema.default({}),
  retry: RetryConfigSchema.default({}),

  pipelines: z.array(IngestionPipelineSchema).default([]),
  profiles: z.array(RetrievalProfileSchema).default([]),

  defaults: DefaultsConfigSchema.default({}),
});

// -- Inferred Types --

export type CopassModelRouting = z.infer<typeof CopassModelRoutingSchema>;
export type ScoreThreshold = z.infer<typeof ScoreThresholdSchema>;
export type ScoreThresholds = z.infer<typeof ScoreThresholdsSchema>;
export type CopassConfig = z.infer<typeof CopassConfigSchema>;
export type IndexingConfig = z.infer<typeof IndexingConfigSchema>;
export type WatchConfig = z.infer<typeof WatchConfigSchema>;
export type ProjectRetryConfig = z.infer<typeof RetryConfigSchema>;
export type IngestionTransform = z.infer<typeof IngestionTransformSchema>;
export type PipelineMatch = z.infer<typeof PipelineMatchSchema>;
export type IngestionPipeline = z.infer<typeof IngestionPipelineSchema>;
export type RetrievalProfile = z.infer<typeof RetrievalProfileSchema>;
export type DefaultsConfig = z.infer<typeof DefaultsConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// -- Functions --

/** Get a default ProjectConfig with all defaults applied. */
export function defaultProjectConfig(): ProjectConfig {
  return ProjectConfigSchema.parse({});
}

/**
 * Parse and normalize a raw config object, applying defaults for missing fields.
 * Backward-compatible: v1.0 configs pass through with new fields getting defaults.
 */
export function normalizeProjectConfig(value: Record<string, unknown> = {}): ProjectConfig {
  const result = ProjectConfigSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  return defaultProjectConfig();
}

/**
 * Deep-merge two config objects (source into target).
 * Arrays are replaced, not concatenated.
 */
export function mergeConfigs(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (
      sourceVal &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = mergeConfigs(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}
