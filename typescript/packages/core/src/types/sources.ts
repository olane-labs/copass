export type DataSourceProvider =
  | 'slack'
  | 'github'
  | 'linear'
  | 'gmail'
  | 'gcal'
  | 'notion'
  | 'drive'
  | 'custom'
  | string;

export type DataSourceIngestionMode = 'realtime' | 'polling' | 'batch' | 'manual';
export type DataSourceStatus =
  | 'pending'
  | 'active'
  | 'paused'
  | 'disconnected'
  | 'error'
  | string;

export interface DataSource {
  data_source_id: string;
  user_id: string;
  sandbox_id: string;
  provider: DataSourceProvider;
  name: string;
  ingestion_mode: DataSourceIngestionMode;
  status: DataSourceStatus;
  external_account_id?: string;
  adapter_config: Record<string, unknown>;
  poll_interval_seconds?: number;
  webhook_url?: string;
  last_sync_at?: string;
  created_at?: string;
}

export interface CreateDataSourceRequest {
  provider: DataSourceProvider;
  name: string;
  ingestion_mode?: DataSourceIngestionMode;
  external_account_id?: string;
  adapter_config?: Record<string, unknown>;
  poll_interval_seconds?: number;
}

export interface UpdateDataSourceRequest {
  name?: string;
  ingestion_mode?: DataSourceIngestionMode;
  external_account_id?: string;
  adapter_config?: Record<string, unknown>;
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
