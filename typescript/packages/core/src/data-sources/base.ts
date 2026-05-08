import type { CopassClient } from '../client.js';
import type {
  CreateDataSourceRequest,
  DataSource,
  DataSourceProvider,
} from '../types/sources.js';
import type {
  IngestJobResponse,
  IngestJobStatus,
  IngestSourceType,
} from '../types/ingest.js';
import type { StatusResponse } from '../types/sandboxes.js';

export interface BaseDataSourceOptions {
  /** Copass client instance used for every call this source makes. */
  client: CopassClient;
  /** Sandbox this source lives in. */
  sandboxId: string;
  /** Data source id returned by `client.sources.register(...)`. */
  dataSourceId: string;
  /** Optional default project id to attribute ingestions to. */
  projectId?: string;
}

export interface PushOptions {
  sourceType?: IngestSourceType;
  /** If true, chunk + store without running ontology ingestion. */
  storageOnly?: boolean;
  /** Override the default project id for this one push. */
  projectId?: string;
  /** ISO 8601 timestamp anchoring this payload to a real-world moment. */
  occurredAt?: string;
  /**
   * Optional named participant who uttered this payload. Useful on
   * conversation-shaped sources (chat history, support tickets);
   * forwarded as the envelope's `speaker` field.
   */
  speaker?: string;
  /**
   * Optional roster of participants present in this payload's
   * artifact. Per-message — pass the snapshot at the time of
   * utterance. Useful for second-person pronoun resolution on
   * conversation-shaped sources.
   */
  participants?: string[];
}

/**
 * Abstract base class for data source drivers.
 *
 * A driver binds a registered `DataSource` record to the code that actually
 * pushes bytes through it. Every ingested event routes through
 * {@link BaseDataSource.push}, which calls
 * `client.sources.ingest(sandboxId, dataSourceId, …)` — so every byte is
 * attributed to the source in the copass-id storage layer.
 *
 * Subclasses implement provider-specific scan / watch / pull logic and call
 * `push()` whenever they have content. The base handles lifecycle
 * pass-throughs (pause / resume / disconnect) so subclasses do not need to
 * re-wire them.
 *
 * @example
 * ```ts
 * class FileSystemDataSource extends BaseDataSource {
 *   async indexOnce(path: string) {
 *     const content = await readFile(path, 'utf8');
 *     return this.push(content, { sourceType: 'code' });
 *   }
 * }
 * ```
 */
export abstract class BaseDataSource {
  protected readonly client: CopassClient;
  readonly sandboxId: string;
  readonly dataSourceId: string;
  readonly projectId?: string;

  constructor(options: BaseDataSourceOptions) {
    if (!options.sandboxId) {
      throw new Error('BaseDataSource: `sandboxId` is required');
    }
    if (!options.dataSourceId) {
      throw new Error('BaseDataSource: `dataSourceId` is required');
    }
    this.client = options.client;
    this.sandboxId = options.sandboxId;
    this.dataSourceId = options.dataSourceId;
    this.projectId = options.projectId;
  }

  /**
   * Push bytes through this data source. All ingestion in subclasses should
   * flow through here so attribution stays coherent.
   */
  protected push(text: string, options: PushOptions = {}): Promise<IngestJobResponse> {
    return this.client.sources.ingest(this.sandboxId, this.dataSourceId, {
      text,
      source_type: options.sourceType,
      storage_only: options.storageOnly,
      project_id: options.projectId ?? this.projectId,
      occurred_at: options.occurredAt,
      speaker: options.speaker,
      participants: options.participants,
    });
  }

  /** Poll an ingestion job status in this sandbox. */
  protected getJob(jobId: string): Promise<IngestJobStatus> {
    return this.client.ingest.getSandboxJob(this.sandboxId, jobId);
  }

  /** Fetch the underlying `DataSource` record (useful for reading `last_sync_at`, `status`, etc.). */
  describe(): Promise<DataSource> {
    return this.client.sources.retrieve(this.sandboxId, this.dataSourceId);
  }

  /** Pause this source. No further ingestion should run until {@link resume}. */
  pause(): Promise<StatusResponse> {
    return this.client.sources.pause(this.sandboxId, this.dataSourceId);
  }

  /** Resume a paused source. */
  resume(): Promise<StatusResponse> {
    return this.client.sources.resume(this.sandboxId, this.dataSourceId);
  }

  /** Mark the source as disconnected (soft terminate — record is kept). */
  disconnect(): Promise<StatusResponse> {
    return this.client.sources.disconnect(this.sandboxId, this.dataSourceId);
  }

  /**
   * Start this source's driver. Subclasses that run continuously (watchers,
   * pollers) should override. Default is a no-op.
   */
  async start(): Promise<void> {}

  /** Stop this source's driver. Subclasses that hold resources should override. */
  async stop(): Promise<void> {}
}

export interface EnsureDataSourceOptions extends CreateDataSourceRequest {
  /**
   * If a source with this provider + name already exists in the sandbox,
   * reuse it. Otherwise register a new one. Defaults to `true`.
   */
  reuseExisting?: boolean;
}

/**
 * Idempotent registration helper: returns an existing `DataSource` in the
 * sandbox that matches `provider` + `name`, or registers a new one.
 *
 * Useful in subclass factories so callers can instantiate a driver with one
 * call instead of manually registering a source up front.
 */
export async function ensureDataSource(
  client: CopassClient,
  sandboxId: string,
  request: EnsureDataSourceOptions,
): Promise<DataSource> {
  const { reuseExisting = true, provider, name, ...rest } = request;

  if (reuseExisting) {
    const existing = await client.sources.list(sandboxId, {
      provider: provider as DataSourceProvider,
    });
    const match = existing.sources.find((s) => s.name === name);
    if (match) return match;
  }

  return client.sources.register(sandboxId, { provider, name, ...rest });
}
