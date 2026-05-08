export type DataSourceProvider =
  | 'slack'
  | 'github'
  | 'linear'
  | 'gmail'
  | 'jira'
  | 'notion'
  | 'custom'
  | 'pipedream'
  | 'user_mcp'
  | 'bigquery'
  | string;

export type DataSourceIngestionMode = 'realtime' | 'polling' | 'batch' | 'manual';
export type DataSourceStatus =
  | 'active'
  | 'paused'
  | 'disconnected'
  | 'error'
  | 'archived'
  | string;

/**
 * Lifecycle category for a data source.
 *
 * - `durable` (default) — lives until explicitly deleted.
 * - `ephemeral` — auto-archived after a period of inactivity. Data (chunks
 *   + graph events) is preserved on archive; only the source record flips
 *   to inactive. Used by the SDK's Context Window primitive.
 */
export type DataSourceKind = 'durable' | 'ephemeral';

export interface DataSource {
  data_source_id: string;
  user_id: string;
  sandbox_id: string;
  provider: DataSourceProvider;
  name: string;
  ingestion_mode: DataSourceIngestionMode;
  status: DataSourceStatus;
  kind?: DataSourceKind;
  external_account_id?: string;
  adapter_config: Record<string, unknown>;
  poll_interval_seconds?: number;
  webhook_url?: string;
  /**
   * TRANSIENT — populated ONLY in the response from `register()` (when
   * the source's provider has a registered ingestor and `ingestion_mode`
   * is `'realtime'`) and from `rotateWebhookSecret()`. NEVER present on
   * `retrieve()` or `list()` responses. Plaintext signing secret the
   * caller pastes into their provider's HTTP step's
   * `Authorization: Bearer <secret>` header. After the response the
   * server only stores the sha256 hash — losing the plaintext means
   * rotating.
   */
  webhook_signing_secret?: string | null;
  last_sync_at?: string;
  created_at?: string;
}

export interface CreateDataSourceRequest {
  provider: DataSourceProvider;
  name: string;
  ingestion_mode?: DataSourceIngestionMode;
  /**
   * Lifecycle category. Defaults to `durable` when omitted. Set to
   * `ephemeral` for time-bound sources like agent conversation threads.
   */
  kind?: DataSourceKind;
  external_account_id?: string;
  adapter_config?: Record<string, unknown>;
  /** Minimum 60 seconds enforced server-side. Only meaningful for `polling` mode. */
  poll_interval_seconds?: number;
}

export interface UpdateDataSourceRequest {
  name?: string;
  ingestion_mode?: DataSourceIngestionMode;
  external_account_id?: string;
  adapter_config?: Record<string, unknown>;
  /** Minimum 60 seconds enforced server-side. */
  poll_interval_seconds?: number;
}

export interface ListDataSourcesOptions {
  provider?: DataSourceProvider;
  status?: DataSourceStatus;
}

export interface DataSourceListResponse {
  sources: DataSource[];
  count: number;
}

/** Body for ``POST /sources/{source_id}/pull`` (adapter-driven ingestion). */
export interface PullDataSourceRequest {
  /** ISO 8601 datetime — incremental cursor; semantics are adapter-defined. */
  since?: string;
  /**
   * When true, rows go to vault only and no `ontology_ingestion` jobs
   * are dispatched.
   */
  vault_only?: boolean;
}

/** Response from ``POST /sources/{source_id}/pull`` (HTTP 202). */
export interface PullDataSourceResponse {
  job_id: string;
  job_type: string;
  status: string;
}

/**
 * Body for ``POST /sources/linear``.
 *
 * Tool-shape kept narrow per ADR 0007 §B (no generalisation to
 * `register_polling_source` until N>1 polling integrations exist).
 * The ``api_key`` is stored in the managed secret store before the
 * row write and never echoed back.
 */
export interface ConnectLinearRequest {
  /** Linear API key (`lin_api_*`). Stored in the managed secret store. */
  api_key: string;
  /** Source name. Defaults to 'Linear'. */
  name?: string;
  /** Subset of Linear entities to ingest. Defaults to all five. */
  include?: Array<'teams' | 'users' | 'projects' | 'issues' | 'cycles'>;
  /** Per-source tool-call rate cap. 1-600. Default 60. */
  rate_cap_per_minute?: number;
  /** Polling cadence in seconds. Min 60. Default 900. */
  poll_interval_seconds?: number;
}

/**
 * Outcome shape for ``POST /sources/linear``.
 *
 * On success ``data_source_id`` and ``status='active'`` are populated;
 * on health-check failure ``status='error'`` and ``health_error`` carry
 * a short reason. Validation failures surface at the HTTP layer (400)
 * before reaching this shape.
 */
export interface ConnectLinearResponse {
  data_source_id?: string;
  status?: string;
  name?: string;
  ingestion_mode?: string;
  entities?: string[];
  health_error?: string;
  error?: string;
  detail?: string;
}

/**
 * Tenant-supplied MCP server registration payload.
 *
 * Backed by `POST /api/v1/storage/sandboxes/{sandboxId}/sources/user-mcp`.
 * The `token` is vault-put server-side under `user_mcp/<id>/auth`; only
 * the vault key reference lives on the row.
 */
export interface CreateUserMcpSourceRequest {
  name: string;
  /** User's MCP server URL. https only — http rejected except localhost. */
  base_url: string;
  /** `bearer` | `header_token` | `none`. */
  auth_kind: 'bearer' | 'header_token' | 'none';
  /** Required iff `auth_kind != 'none'`. Stored in vault, never echoed. */
  token?: string;
  /** Required iff `auth_kind === 'header_token'`. */
  auth_header?: string;
  /** Tool-name prefix (≤64 chars). Defaults to `data_source_id`. */
  app_namespace?: string;
  /** Per-source allowlist on top of the agent-level one. */
  allowed_tools?: string[];
  /** Tool calls to run on every pull. Empty = live-tools-only. */
  ingest_tool_calls?: Array<Record<string, unknown>>;
  /** Per-source tool-call rate cap. Default 60, max 600. */
  rate_cap_per_minute?: number;
  /** Per-source webhook firehose rate cap. Default 600, max 6000. */
  webhook_rate_cap_per_minute?: number;
}

/**
 * Result of a user_mcp lifecycle call.
 *
 * On success, `data_source_id` and `status` are populated. On
 * health-check failure, `status === 'error'` and `health_error` carries
 * a short reason. On validation failure (400), `error` and optional
 * `detail` are populated and the HTTP layer raises before reaching
 * here.
 */
export interface UserMcpSourceResult {
  data_source_id?: string;
  status?: DataSourceStatus;
  name?: string;
  ingestion_mode?: DataSourceIngestionMode;
  health_error?: string;
  error?: string;
  detail?: string;
}

/** Body for `POST /sources/{id}/purge`. */
export interface PurgeDataSourceRequest {
  /**
   * When true, delete the data source registration after purging knowledge
   * (same as `DELETE /sources/{id}`).
   */
  delete_source?: boolean;
}

/** Response from `POST /sources/{id}/purge`. */
export interface DataSourcePurgeResponse {
  success?: boolean;
  delete_source_applied: boolean;
  events_deleted: number;
  extractions_deleted: number;
  canonical_index_rows_deleted: number;
  entity_vectors_deleted: number;
  triggers_deleted: number;
  webhooks_deleted: number;
  event_seen_deleted: number;
  project_links_deleted: number;
  strategy_artifacts_deleted: number;
  pull_artifacts_deleted: number;
  user_strategies_deleted: number;
  /** Binary storage objects removed for this source (field name from the API). */
  vault_objects_deleted: number;
}
