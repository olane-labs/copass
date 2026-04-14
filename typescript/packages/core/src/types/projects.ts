/** Request to register a project. */
export interface RegisterProjectRequest {
  project_path: string;
  project_name: string;
  indexing_mode?: 'full' | 'incremental';
}

/** A registered project record. */
export interface ProjectRecord {
  project_id: string;
  user_id: string;
  project_path: string;
  project_name: string;
  status: string;
  indexing_mode: string | null;
  file_count: number;
  entity_count: number;
  error_count: number;
  last_indexed_at: string | null;
  indexing_duration_ms: number | null;
  created_at: string;
  updated_at: string;
}

/** Project indexing status response. */
export interface ProjectStatusResponse {
  indexed: boolean;
  last_indexed?: string;
  freshness?: string;
  recommendations?: string[];
}
