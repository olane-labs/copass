export type IngestSourceType = 'text' | 'conversation' | 'markdown' | 'code' | 'json' | string;

export type IngestJobState =
  | 'queued'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | string;

export interface IngestTextRequest {
  text: string;
  source_type?: IngestSourceType;
  /** If true, chunk and store but do not run downstream ontology ingestion. */
  storage_only?: boolean;
  /** Optional project override (defaults to user's default project for the resolved sandbox). */
  project_id?: string;
  /** Optional data source association. */
  data_source_id?: string;
}

export interface IngestJobResponse {
  job_id: string;
  status: IngestJobState;
  encrypted: boolean;
  sandbox_id: string;
  project_id?: string;
  status_url: string;
}

export interface IngestJobChildren {
  total: number;
  queued?: number;
  processing?: number;
  completed?: number;
  failed?: number;
  [key: string]: number | undefined;
}

export interface IngestJobStatus {
  job_id: string;
  status: IngestJobState;
  job_type: string;
  encrypted: boolean;
  result?: Record<string, unknown>;
  error_message?: string;
  retry_count: number;
  parent_job_id?: string;
  chunk_index?: number;
  children?: IngestJobChildren;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
}
