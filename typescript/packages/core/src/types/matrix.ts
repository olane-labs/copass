import type { SearchPreset } from './common.js';

/** Detail level for matrix query responses. */
export type MatrixDetailLevel = 'concise' | 'detailed';

/** Request for a matrix (natural language) query. */
export interface MatrixQueryRequest {
  query: string;
  project_id?: string;
  reference_date?: string;
  detail_level?: MatrixDetailLevel;
  max_tokens?: number;
  /** Search matrix preset. Sent as X-Search-Matrix header. */
  preset?: SearchPreset;
  /** Custom LLM instruction. Sent as X-Detail-Instruction header. */
  detail_instruction?: string;
  /** Trace ID for correlation. Sent as X-Trace-Id header. */
  trace_id?: string;
}

/** Response from a matrix query. */
export interface MatrixQueryResponse {
  /** The original query that was submitted. */
  query: string;
  /** LLM-generated answer derived from the knowledge graph context. */
  answer: string;
  /** The search matrix preset that was used. */
  preset: string;
  /** Total wall time in milliseconds (scoping + search + interpretation). */
  execution_time_ms: number;
  /** System warnings (e.g., 'no_context', 'interpretation_failed'). */
  warnings?: string[];
}
