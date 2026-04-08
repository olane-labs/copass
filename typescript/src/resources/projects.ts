import type {
  RegisterProjectRequest,
  ProjectRecord,
  ProjectStatusResponse,
} from '../types/projects.js';

/**
 * Projects resource — project registration and lifecycle.
 *
 * Endpoints: POST /projects/register, GET /projects/status, PATCH /projects/{id}/complete
 */
export interface ProjectsResource {
  /** Register or upsert a project. */
  register(request: RegisterProjectRequest): Promise<ProjectRecord>;

  /** Get project indexing status. */
  getStatus(projectPath: string): Promise<ProjectStatusResponse>;

  /** Mark project indexing as complete. */
  complete(projectId: string): Promise<void>;
}
