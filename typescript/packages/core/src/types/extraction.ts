import type { QueryMetadata } from './common.js';

/** Request to extract entities from text. */
export interface ExtractTextRequest {
  text: string;
  source_type?: string;
  source_id?: string;
  explicit_root_id?: string;
  canonical_id?: string;
  external_ids?: Record<string, string>;
  entity_hints?: string[];
  conversation_history?: Array<{ role: string; content: string }>;
  enable_conversation_adaptation?: boolean;
  materialize?: boolean;
  skip_cache?: boolean;
  project_id?: string;
  metadata?: QueryMetadata;
}

/** Request to extract entities from code. */
export interface ExtractCodeRequest {
  code: string;
  language: string;
  file_path?: string;
  additional_context?: string;
  project_id?: string;
  metadata?: QueryMetadata;
}

/** Response from extraction endpoints. */
export interface ExtractResponse {
  extraction_id: string;
  canonical_ids: string[];
  event_count: number;
  statistics?: Record<string, unknown>;
}

/** Extraction job status. */
export interface ExtractJobStatus {
  job_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at?: string;
  completed_at?: string;
  error?: string;
}

/** Options for listing extraction jobs. */
export interface ListJobsOptions {
  limit?: number;
  offset?: number;
  status?: ExtractJobStatus['status'];
}
