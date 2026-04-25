import { BaseResource } from './base.js';
import type {
  DataSource,
  CreateDataSourceRequest,
  UpdateDataSourceRequest,
  ListDataSourcesOptions,
  DataSourceListResponse,
} from '../types/sources.js';
import type { StatusResponse } from '../types/sandboxes.js';
import type { IngestTextRequest, IngestJobResponse } from '../types/ingest.js';

const base = (sandboxId: string) => `/api/v1/storage/sandboxes/${sandboxId}/sources`;
const ingestBase = (sandboxId: string) =>
  `/api/v1/storage/sandboxes/${sandboxId}/ingest`;

/**
 * Data sources resource — the unit of attribution for everything ingested
 * into a sandbox. Register the source once, then push every byte through it.
 *
 * The harness is **data-source driven**: ingestion is not a standalone action
 * but something a source does. `client.sources.ingest(sandboxId, sourceId, …)`
 * is the primary path; the bare `client.ingest.text(…)` shorthand exists only
 * for quick starts and untagged experiments.
 *
 * ## Ingestion modes
 *
 * Each data source declares an `ingestion_mode` describing who drives the
 * push:
 *
 * - `manual` — your backend pushes bytes via
 *   {@link SourcesResource.ingest}. Copass never reaches out to the provider;
 *   the source record carries provenance, config, and lifecycle state.
 * - `polling` — same push semantics, but your workers (or a future Copass
 *   scheduler) call `ingest` on `poll_interval_seconds` cadence.
 * - `realtime` — same push semantics, driven by provider webhooks handled in
 *   your backend.
 *
 * Note: `last_sync_at` is maintained server-side (set by the service layer
 * on successful ingest) and exposed as a read-only field on `DataSource`.
 * It cannot be written via `update()` and there is no public endpoint to
 * force-stamp it from the client.
 *
 * In every mode the server-side path is identical — a data source handle
 * feeding bytes into `/api/v1/storage/sandboxes/{sid}/ingest`. The mode is
 * metadata that tells Copass (and your operators) how the source is expected
 * to be driven.
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

  /**
   * Push bytes into the sandbox's ingestion pipeline attributed to this
   * data source. This is the primary ingestion path — every event you send
   * should come through a registered source so origin, lifecycle, and
   * provenance stay coherent.
   *
   * Equivalent to calling
   * `client.ingest.textInSandbox(sandboxId, { ...request, data_source_id: sourceId })`.
   */
  async ingest(
    sandboxId: string,
    sourceId: string,
    request: Omit<IngestTextRequest, 'data_source_id'>,
  ): Promise<IngestJobResponse> {
    return this.post<IngestJobResponse>(ingestBase(sandboxId), {
      ...request,
      data_source_id: sourceId,
    });
  }

  /**
   * Mint a fresh webhook signing secret for a `realtime` data source whose
   * provider has a registered ingestor (Pipedream today). The plaintext
   * `webhook_signing_secret` is returned ONCE on the response — paste it
   * into your provider's HTTP step as `Authorization: Bearer <secret>`.
   * After this call the server only stores the sha256 hash; lose the
   * plaintext and you must rotate again.
   *
   * The previous active webhook flips to `rotating` so in-flight events
   * keep authenticating during the grace window; new events use the new
   * secret.
   */
  async rotateWebhookSecret(sandboxId: string, sourceId: string): Promise<DataSource> {
    return this.post<DataSource>(
      `${base(sandboxId)}/${sourceId}/rotate-webhook-secret`,
    );
  }
}
