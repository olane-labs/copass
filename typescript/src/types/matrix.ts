import type { DetailLevel, SearchPreset } from './common.js';

/** Request for a matrix (natural language) query. */
export interface MatrixQueryRequest {
  query: string;
  project_id?: string;
  reference_date?: string;
  detail_level?: DetailLevel;
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
  answer: string;
  context: string;
  execution_time_ms: number;
}
