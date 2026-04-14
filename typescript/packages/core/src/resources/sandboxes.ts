import { BaseResource } from './base.js';
import type {
  Sandbox,
  CreateSandboxRequest,
  UpdateSandboxRequest,
  ListSandboxesOptions,
  SandboxListResponse,
  StatusResponse,
} from '../types/sandboxes.js';

const BASE = '/api/v1/storage/sandboxes';

/**
 * Sandboxes resource — the top-level tenancy unit in the copass-id storage layer.
 *
 * A sandbox owns its data sources, projects, vault, and ingestion jobs.
 */
export class SandboxesResource extends BaseResource {
  async create(request: CreateSandboxRequest): Promise<Sandbox> {
    return this.post<Sandbox>(BASE, request);
  }

  async list(options: ListSandboxesOptions = {}): Promise<SandboxListResponse> {
    return this.get<SandboxListResponse>(BASE, {
      query: { status: options.status, owner_id: options.owner_id },
    });
  }

  async retrieve(sandboxId: string): Promise<Sandbox> {
    return this.get<Sandbox>(`${BASE}/${sandboxId}`);
  }

  async update(sandboxId: string, updates: UpdateSandboxRequest): Promise<Sandbox> {
    return this.patch<Sandbox>(`${BASE}/${sandboxId}`, updates);
  }

  async suspend(sandboxId: string): Promise<StatusResponse> {
    return this.post<StatusResponse>(`${BASE}/${sandboxId}/suspend`);
  }

  async reactivate(sandboxId: string): Promise<StatusResponse> {
    return this.post<StatusResponse>(`${BASE}/${sandboxId}/reactivate`);
  }

  async archive(sandboxId: string): Promise<StatusResponse> {
    return this.post<StatusResponse>(`${BASE}/${sandboxId}/archive`);
  }

  async destroy(sandboxId: string): Promise<StatusResponse> {
    return this.delete<StatusResponse>(`${BASE}/${sandboxId}`);
  }
}
