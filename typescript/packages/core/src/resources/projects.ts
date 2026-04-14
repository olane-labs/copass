import { BaseResource } from './base.js';
import type {
  StorageProject,
  CreateStorageProjectRequest,
  UpdateStorageProjectRequest,
  ListStorageProjectsOptions,
  StorageProjectListResponse,
} from '../types/storage-projects.js';
import type { StatusResponse } from '../types/sandboxes.js';

const base = (sandboxId: string) => `/api/v1/storage/sandboxes/${sandboxId}/projects`;

/**
 * Projects resource — sandbox-scoped project grouping for data sources and
 * downstream ingestion. Replaces the deprecated `/api/v1/projects/*` indexing
 * API; all projects now live inside a sandbox in the copass-id storage layer.
 */
export class ProjectsResource extends BaseResource {
  async create(sandboxId: string, request: CreateStorageProjectRequest): Promise<StorageProject> {
    return this.post<StorageProject>(base(sandboxId), request);
  }

  async list(
    sandboxId: string,
    options: ListStorageProjectsOptions = {},
  ): Promise<StorageProjectListResponse> {
    return this.get<StorageProjectListResponse>(base(sandboxId), {
      query: { status: options.status },
    });
  }

  async retrieve(sandboxId: string, projectId: string): Promise<StorageProject> {
    return this.get<StorageProject>(`${base(sandboxId)}/${projectId}`);
  }

  async update(
    sandboxId: string,
    projectId: string,
    updates: UpdateStorageProjectRequest,
  ): Promise<StorageProject> {
    return this.patch<StorageProject>(`${base(sandboxId)}/${projectId}`, updates);
  }

  async archive(sandboxId: string, projectId: string): Promise<StatusResponse> {
    return this.post<StatusResponse>(`${base(sandboxId)}/${projectId}/archive`);
  }

  async del(sandboxId: string, projectId: string): Promise<StatusResponse> {
    return this.delete<StatusResponse>(`${base(sandboxId)}/${projectId}`);
  }

  async linkSource(
    sandboxId: string,
    projectId: string,
    sourceId: string,
  ): Promise<StatusResponse> {
    return this.post<StatusResponse>(`${base(sandboxId)}/${projectId}/sources/${sourceId}`);
  }

  async unlinkSource(
    sandboxId: string,
    projectId: string,
    sourceId: string,
  ): Promise<StatusResponse> {
    return this.delete<StatusResponse>(`${base(sandboxId)}/${projectId}/sources/${sourceId}`);
  }
}
