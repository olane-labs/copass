import { BaseResource } from './base.js';
import type {
  ExtractTextRequest,
  ExtractCodeRequest,
  ExtractResponse,
  ExtractJobStatus,
  ListJobsOptions,
} from '../types/extraction.js';

/**
 * Extraction resource — ingest text, code, and files into the knowledge graph.
 */
export class ExtractionResource extends BaseResource {
  async extractText(request: ExtractTextRequest): Promise<ExtractResponse> {
    return this.post<ExtractResponse>('/api/v1/extract', request);
  }

  async extractCode(request: ExtractCodeRequest): Promise<ExtractResponse> {
    return this.post<ExtractResponse>('/api/v1/extract/code', request);
  }

  async uploadFile(
    file: Blob,
    options?: { fileName?: string; sourceType?: string },
  ): Promise<ExtractResponse> {
    const fields: Record<string, string> = {};
    if (options?.sourceType) fields['source_type'] = options.sourceType;
    return this.http.uploadFile(
      '/api/v1/extract/file',
      file,
      fields,
      options?.fileName,
    ) as Promise<ExtractResponse>;
  }

  async getJob(jobId: string): Promise<ExtractJobStatus> {
    return this.get<ExtractJobStatus>(`/api/v1/extract/jobs/${jobId}`);
  }

  async listJobs(options?: ListJobsOptions): Promise<ExtractJobStatus[]> {
    return this.get<ExtractJobStatus[]>('/api/v1/extract/jobs', {
      query: {
        limit: options?.limit?.toString(),
        offset: options?.offset?.toString(),
        status: options?.status,
      },
    });
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.post('/api/v1/extract/jobs/cancel', { job_id: jobId });
  }

  async retryJob(jobId: string): Promise<void> {
    await this.post('/api/v1/extract/jobs/retry', { job_id: jobId });
  }
}
