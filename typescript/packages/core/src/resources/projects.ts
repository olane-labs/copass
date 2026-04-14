import { BaseResource } from './base.js';
import type {
  RegisterProjectRequest,
  ProjectRecord,
  ProjectStatusResponse,
} from '../types/projects.js';

/**
 * Projects resource — project registration and lifecycle.
 */
export class ProjectsResource extends BaseResource {
  async register(request: RegisterProjectRequest): Promise<ProjectRecord> {
    return this.post<ProjectRecord>('/api/v1/projects/register', request);
  }

  async getStatus(projectPath: string): Promise<ProjectStatusResponse> {
    return this.get<ProjectStatusResponse>('/api/v1/projects/status', {
      query: { project_path: projectPath },
    });
  }

  async complete(projectId: string): Promise<void> {
    await this.patch(`/api/v1/projects/${projectId}/complete`);
  }
}
