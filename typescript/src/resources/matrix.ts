import type { MatrixQueryRequest, MatrixQueryResponse } from '../types/matrix.js';

/**
 * Matrix resource — natural language search across the knowledge graph.
 *
 * Endpoint: GET /matrix/query
 */
export interface MatrixResource {
  /** Execute a natural language query. */
  query(request: MatrixQueryRequest): Promise<MatrixQueryResponse>;
}
