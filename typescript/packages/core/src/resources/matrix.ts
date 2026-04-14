import { BaseResource } from './base.js';
import type { MatrixQueryRequest, MatrixQueryResponse } from '../types/matrix.js';

/**
 * Matrix resource — natural language search across the knowledge graph.
 */
export class MatrixResource extends BaseResource {
  async query(request: MatrixQueryRequest): Promise<MatrixQueryResponse> {
    const headers: Record<string, string> = {};
    if (request.preset) headers['X-Search-Matrix'] = request.preset;
    if (request.detail_instruction) headers['X-Detail-Instruction'] = request.detail_instruction;
    if (request.trace_id) headers['X-Trace-Id'] = request.trace_id;

    return this.get<MatrixQueryResponse>('/api/v1/matrix/query', {
      query: {
        query: request.query,
        project_id: request.project_id,
        reference_date: request.reference_date,
        detail_level: request.detail_level,
        max_tokens: request.max_tokens?.toString(),
      },
      headers,
    });
  }
}
