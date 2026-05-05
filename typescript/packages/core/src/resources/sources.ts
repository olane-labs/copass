import { BaseResource } from './base.js';
import type {
  ConnectLinearRequest,
  ConnectLinearResponse,
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

  /**
   * Patch a data source's mutable config.
   *
   * `options.mergeAdapterConfig` (default `false`) controls whether
   * `adapter_config` is replaced wholesale (default — backward-compat)
   * or **deep-merged** into the existing adapter_config server-side.
   * Top-level keys in the patch override; nested objects recurse.
   * Use the merge form when toggling one nested key (e.g.
   * `ingest_to_graph`) without serialising the rest of the config.
   */
  async update(
    sandboxId: string,
    sourceId: string,
    updates: UpdateDataSourceRequest,
    options: { mergeAdapterConfig?: boolean } = {},
  ): Promise<DataSource> {
    const query = options.mergeAdapterConfig
      ? { merge_adapter_config: 'true' }
      : undefined;
    return this.patch<DataSource>(
      `${base(sandboxId)}/${sourceId}`,
      updates,
      query ? { query } : undefined,
    );
  }

  /**
   * Connect a Linear workspace as a polling data source.
   *
   * Targets `POST /sources/linear` — the secret-aware lifecycle
   * (vault-put before row write, one-shot `tools/list` health check).
   * Distinct from {@link register} because the API key cannot be
   * passed plaintext on `adapter_config`. On health-check failure the
   * source lands with `status='error'`; retry with a fresh key.
   *
   * Tool-shape kept narrow per ADR 0007 §B — no generalisation to a
   * `register_polling_source` pattern until N>1 polling integrations
   * exist.
   */
  async connectLinear(
    sandboxId: string,
    request: ConnectLinearRequest,
  ): Promise<ConnectLinearResponse> {
    return this.post<ConnectLinearResponse>(
      `${base(sandboxId)}/linear`,
      request,
    );
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
   * Register a tenant-supplied MCP server as a `user_mcp` data source.
   *
   * Distinct from {@link register} because the secret-aware flow lives on
   * the server (vault-put before row write, health check, namespace
   * uniqueness, durability sequencing). Going through `register` with
   * `provider: "user_mcp"` directly would store the bearer token plaintext
   * on `adapter_config` — this method routes through
   * `POST /sources/user-mcp` so the server runs the secret-aware lifecycle.
   *
   * The `token` is vault-put under `user_mcp/<id>/auth`; only the vault
   * key reference lives on the row. A one-shot `tools/list` health check
   * runs before returning. On health failure the source lands with
   * `status: "error"` and the caller can retry via
   * {@link testUserMcp}. On success, status is `active`.
   */
  async registerUserMcp(
    sandboxId: string,
    request: import('../types/sources.js').CreateUserMcpSourceRequest,
  ): Promise<import('../types/sources.js').UserMcpSourceResult> {
    return this.post<import('../types/sources.js').UserMcpSourceResult>(
      `${base(sandboxId)}/user-mcp`,
      request,
    );
  }

  /**
   * Re-run the health check on a `user_mcp` source. Flips status to
   * `active` on success or `error` on failure. Use after fixing
   * whatever made `registerUserMcp` land in error state.
   */
  async testUserMcp(
    sandboxId: string,
    sourceId: string,
  ): Promise<import('../types/sources.js').UserMcpSourceResult> {
    return this.post<import('../types/sources.js').UserMcpSourceResult>(
      `${base(sandboxId)}/${sourceId}/user-mcp/test`,
    );
  }

  /**
   * Disconnect a `user_mcp` source: deletes vault-stored secrets, sets
   * status to `disconnected` (terminal), and evicts both the agent-side
   * tool-cap bucket and the receiver-side webhook-cap bucket so
   * revocation is observed within one request. Reversible only by
   * calling {@link registerUserMcp} again.
   */
  async revokeUserMcp(
    sandboxId: string,
    sourceId: string,
  ): Promise<import('../types/sources.js').UserMcpSourceResult> {
    return this.post<import('../types/sources.js').UserMcpSourceResult>(
      `${base(sandboxId)}/${sourceId}/user-mcp/revoke`,
    );
  }
}
