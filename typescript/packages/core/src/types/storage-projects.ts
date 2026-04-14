export type StorageProjectStatus = 'active' | 'archived' | string;

export interface StorageProject {
  project_id: string;
  user_id: string;
  sandbox_id: string;
  name: string;
  description?: string;
  status: StorageProjectStatus;
  data_source_ids: string[];
  metadata: Record<string, unknown>;
  created_at?: string;
}

export interface CreateStorageProjectRequest {
  name: string;
  description?: string;
  data_source_ids?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateStorageProjectRequest {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ListStorageProjectsOptions {
  status?: StorageProjectStatus;
}

export interface StorageProjectListResponse {
  projects: StorageProject[];
  count: number;
}
