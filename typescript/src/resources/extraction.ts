import type {
  ExtractTextRequest,
  ExtractCodeRequest,
  ExtractResponse,
  ExtractJobStatus,
  ListJobsOptions,
} from '../types/extraction.js';

/**
 * Extraction resource — ingest text, code, and files into the knowledge graph.
 *
 * Endpoints: POST /extract, /extract/code, /extract/file, /extract/jobs/*
 */
export interface ExtractionResource {
  /** Extract entities from text. */
  extractText(request: ExtractTextRequest): Promise<ExtractResponse>;

  /** Extract entities from code. */
  extractCode(request: ExtractCodeRequest): Promise<ExtractResponse>;

  /** Upload and extract from a file. */
  uploadFile(file: Blob, options?: { fileName?: string; sourceType?: string }): Promise<ExtractResponse>;

  /** Get extraction job status. */
  getJob(jobId: string): Promise<ExtractJobStatus>;

  /** List extraction jobs. */
  listJobs(options?: ListJobsOptions): Promise<ExtractJobStatus[]>;

  /** Cancel an extraction job. */
  cancelJob(jobId: string): Promise<void>;

  /** Retry failed extraction jobs. */
  retryJob(jobId: string): Promise<void>;
}
