import { BaseResource } from './base.js';
import type {
  DataSource,
  CreateDataSourceRequest,
  UpdateDataSourceRequest,
  ListDataSourcesOptions,
  DataSourceListResponse,
} from '../types/sources.js';
import type { StatusResponse } from '../types/sandboxes.js';

const base = (sandboxId: string) => `/api/v1/storage/sandboxes/${sandboxId}/sources`;

/**
 * Data sources resource — external providers that feed data into a sandbox.
 *
 * All operations are sandbox-scoped.
 */
export class SourcesResource extends BaseResource {
  async register(sandboxId: string, request: CreateDataSourceRequest): Promise<DataSource> {
    return this.post<DataSource>(base(sandboxId), request);
  }

  async list(sandboxId: string, options: ListDataSourcesOptions = {}): Promise<DataSourceListResponse> {
    return this.get<DataSourceListResponse>(base(sandboxId), {
      query: { provider: options.provider, status: options.status },
    });
  }

  async retrieve(sandboxId: string, sourceId: string): Promise<DataSource> {
    return this.get<DataSource>(`${base(sandboxId)}/${sourceId}`);
  }

  async update(
    sandboxId: string,
    sourceId: string,
    updates: UpdateDataSourceRequest,
  ): Promise<DataSource> {
    return this.patch<DataSource>(`${base(sandboxId)}/${sourceId}`, updates);
  }

  async pause(sandboxId: string, sourceId: string): Promise<StatusResponse> {
    return this.post<StatusResponse>(`${base(sandboxId)}/${sourceId}/pause`);
  }

  async resume(sandboxId: string, sourceId: string): Promise<StatusResponse> {
    return this.post<StatusResponse>(`${base(sandboxId)}/${sourceId}/resume`);
  }

  async disconnect(sandboxId: string, sourceId: string): Promise<StatusResponse> {
    return this.post<StatusResponse>(`${base(sandboxId)}/${sourceId}/disconnect`);
  }

  async del(sandboxId: string, sourceId: string): Promise<StatusResponse> {
    return this.delete<StatusResponse>(`${base(sandboxId)}/${sourceId}`);
  }
}
