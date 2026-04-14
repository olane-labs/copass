import { BaseResource } from './base.js';
import type {
  IngestTextRequest,
  IngestJobResponse,
  IngestJobStatus,
} from '../types/ingest.js';

const SHORTHAND = '/api/v1/storage/ingest';
const explicitBase = (sandboxId: string) =>
  `/api/v1/storage/sandboxes/${sandboxId}/ingest`;

/**
 * Ingest resource — submit data for chunking and downstream ontology ingestion.
 *
 * This replaces the deprecated `/api/v1/extract/*` endpoints. All ingestion
 * now flows through the copass-id storage layer, which resolves a sandbox,
 * dispatches a chunking job, and passes the DEK through the queue ephemerally
 * when encryption is active.
 *
 * Two entry points:
 *  - {@link text}: shorthand that auto-resolves the caller's primary sandbox
 *    and default project. Preferred for single-sandbox users.
 *  - {@link textInSandbox}: explicit sandbox_id for callers managing multiple
 *    sandboxes.
 */
export class IngestResource extends BaseResource {
  /**
   * Submit text to the caller's primary sandbox.
   *
   * Returns 202 with a `job_id`; poll with {@link getJob}.
   */
  async text(request: IngestTextRequest): Promise<IngestJobResponse> {
    return this.post<IngestJobResponse>(SHORTHAND, request);
  }

  /** Poll job status for a shorthand-submitted ingestion. */
  async getJob(jobId: string): Promise<IngestJobStatus> {
    return this.get<IngestJobStatus>(`${SHORTHAND}/${jobId}`);
  }

  /**
   * Submit text to a specific sandbox. Use when the caller manages multiple
   * sandboxes; otherwise prefer {@link text}.
   */
  async textInSandbox(
    sandboxId: string,
    request: IngestTextRequest,
  ): Promise<IngestJobResponse> {
    return this.post<IngestJobResponse>(explicitBase(sandboxId), request);
  }

  /** Poll job status for an explicit-sandbox ingestion. */
  async getSandboxJob(sandboxId: string, jobId: string): Promise<IngestJobStatus> {
    return this.get<IngestJobStatus>(`${explicitBase(sandboxId)}/${jobId}`);
  }
}
