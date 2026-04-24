/**
 * Types for the provider-neutral integrations surface
 * (`/api/v1/storage/sandboxes/{sandbox_id}/sources/integrations/*`).
 *
 * The Copass backend fronts one or more integration providers (today:
 * Pipedream Connect) behind a unified dev-facing API. These types
 * describe that API; the underlying provider is an implementation
 * detail the client doesn't see.
 *
 * See ADR 0001 in the backend repo for the full OAuth → DataSource
 * flow.
 */

/** One app in the catalog. `supported=true` iff Copass has curated
 * `pull_tool_calls` defaults for this slug. When `false`, `connect()`
 * will 400. */
export interface AppCatalogItem {
  slug: string;
  name: string;
  description: string;
  categories: string[];
  auth_type: string;
  icon_url?: string | null;
  supported: boolean;
}

export interface AppCatalogResponse {
  items: AppCatalogItem[];
  next_cursor?: string | null;
}

/** Options for listing the catalog. */
export interface CatalogOptions {
  /** Free-text filter over app name / description. */
  q?: string;
  /** Page size. 1-100. Default 50 server-side. */
  limit?: number;
  /** Opaque cursor from a prior response's `next_cursor`. */
  cursor?: string;
}

/** Scope at which the OAuth identity is partitioned on the provider. */
export type IntegrationScope = 'user' | 'sandbox' | 'project';

/** Body for POST /sources/integrations/{app}/connect. */
export interface ConnectRequest {
  /** Default: `'user'`. Determines the `external_user_id` prefix
   * used to key this connection on the provider side. */
  scope?: IntegrationScope;
  /** Pipedream redirects the browser here after successful OAuth. */
  success_redirect_uri: string;
  /** Pipedream redirects the browser here on denial / failure. */
  error_redirect_uri: string;
  /** Override sandbox-default project scoping. */
  project_id?: string;
}

/** Response of connect() — hand the browser to `connect_url`. */
export interface ConnectResponse {
  /** Provider-hosted OAuth URL. Open in a browser. */
  connect_url: string;
  /** Correlator the webhook will reference when the user completes. */
  session_id: string;
  /** ISO-8601 TTL on the connect token (typically ~4h). */
  expires_at?: string | null;
}

/** One active integration-sourced DataSource. */
export interface ConnectionItem {
  /** Underlying `DataSource.data_source_id`. */
  source_id: string;
  /** App slug (e.g. `slack`, `gmail`). */
  app: string;
  /** Provider's account id (Pipedream `apn_...`). May be null for
   * legacy rows where the webhook didn't capture it. */
  account_id?: string | null;
  /** Display name — usually the workspace/account name. */
  name: string;
  /** DataSource status. Typically `active`. */
  status: string;
  /** ISO-8601 creation timestamp. */
  connected_at?: string | null;
}

export interface ConnectionsListResponse {
  items: ConnectionItem[];
}

/** Options for listConnections. */
export interface ListConnectionsOptions {
  /** Filter by app slug. */
  app?: string;
}

/** Body for POST /sources/integrations/reconcile. Force a sync pass
 * against the underlying provider's accounts and backfill missing
 * DataSources. Safety net for dropped webhooks. */
export interface ReconcileRequest {
  /** Default `'user'`. Must match the scope the connect flow used. */
  scope?: IntegrationScope;
  /** Optional app slug filter. */
  app?: string;
  /** Project override. */
  project_id?: string;
}

export interface ReconcileReportItem {
  app: string;
  account_id: string;
  /** 'created' | 'already_existed' | 'unsupported_app' | 'tier_limit' */
  outcome: string;
  source_id?: string | null;
  error?: string | null;
}

export interface ReconcileResponse {
  /** Number of brand-new DataSources created this pass. Non-zero means
   * at least one provider account existed upstream but wasn't in Copass
   * — typically due to a missed webhook delivery. */
  created_count: number;
  /** Per-account detail for diagnostics. */
  items: ReconcileReportItem[];
  /** Post-reconcile state — same shape as `listConnections`. */
  connections: ConnectionItem[];
}
