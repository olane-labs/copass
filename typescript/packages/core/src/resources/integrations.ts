import { BaseResource } from './base.js';
import type {
  AppCatalogResponse,
  CatalogOptions,
  ConnectionsListResponse,
  ConnectRequest,
  ConnectResponse,
  IntegrationAccountListResponse,
  ListAccountsOptions,
  ListConnectionsOptions,
  ReconcileRequest,
  ReconcileResponse,
} from '../types/integrations.js';

const base = (sandboxId: string) =>
  `/api/v1/storage/sandboxes/${sandboxId}/sources/integrations`;

/**
 * Integrations resource — provider-neutral OAuth → DataSource flow.
 *
 * Browse available apps via {@link catalog}, start an OAuth flow
 * via {@link connect} (returns a hosted URL to hand to the user's
 * browser), and manage active connections via {@link list} /
 * {@link disconnect}.
 *
 * The backing integration provider is a server-side config; clients
 * see a single unified surface. OAuth tokens are held by the provider
 * — Copass never persists them.
 */
export class IntegrationsResource extends BaseResource {
  /**
   * List or search the app catalog for a sandbox.
   *
   * Every catalog entry has `supported: true`. Use
   * `has_ingestion_defaults` to tell which slugs get curated firehose
   * pull defaults after OAuth (vs agent-tools-only until a custom
   * `pull_tool_calls` spec is added).
   */
  async catalog(
    sandboxId: string,
    options: CatalogOptions = {},
  ): Promise<AppCatalogResponse> {
    const params = new URLSearchParams();
    if (options.q) params.set('q', options.q);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.cursor) params.set('cursor', options.cursor);
    const qs = params.toString();
    const path = qs ? `${base(sandboxId)}/catalog?${qs}` : `${base(sandboxId)}/catalog`;
    return this.get<AppCatalogResponse>(path);
  }

  /** Mint a provider Connect URL for the given app + scope. The
   * returned `connect_url` is a provider-hosted page the user must
   * visit in a browser to complete OAuth. The provider calls
   * Copass's webhook on completion, creating a DataSource asynchronously. */
  async connect(
    sandboxId: string,
    app: string,
    request: ConnectRequest,
  ): Promise<ConnectResponse> {
    return this.post<ConnectResponse>(`${base(sandboxId)}/${app}/connect`, request);
  }

  /** List the user's raw upstream OAuth accounts.
   *
   * Distinct from {@link list}: connections are local DataSource rows
   * the connect webhook materialises; accounts are the raw grants on
   * the upstream provider. Backs the `list_connected_accounts`
   * management tool. Server-side at
   * `GET /sources/integrations/accounts`. */
  async listAccounts(
    sandboxId: string,
    options: ListAccountsOptions = {},
  ): Promise<IntegrationAccountListResponse> {
    const params = new URLSearchParams();
    if (options.app_slug) params.set('app_slug', options.app_slug);
    const qs = params.toString();
    const path = qs
      ? `${base(sandboxId)}/accounts?${qs}`
      : `${base(sandboxId)}/accounts`;
    return this.get<IntegrationAccountListResponse>(path);
  }

  /** List the sandbox's active integration-sourced connections.
   * Optionally filter by `app` slug. */
  async list(
    sandboxId: string,
    options: ListConnectionsOptions = {},
  ): Promise<ConnectionsListResponse> {
    const params = new URLSearchParams();
    if (options.app) params.set('app', options.app);
    const qs = params.toString();
    const path = qs
      ? `${base(sandboxId)}/connections?${qs}`
      : `${base(sandboxId)}/connections`;
    return this.get<ConnectionsListResponse>(path);
  }

  /** Revoke the provider account (best-effort) and archive the
   * DataSource locally. Idempotent in both directions. */
  async disconnect(sandboxId: string, sourceId: string): Promise<void> {
    await this.delete(`${base(sandboxId)}/connections/${sourceId}`);
  }

  /** Query the provider for the caller's connected accounts and
   * idempotently backfill missing DataSources. Safety net for dropped
   * webhook deliveries — call during a poll loop after
   * {@link connect} so a missed CONNECTION_SUCCESS doesn't leave the
   * user stuck. Always returns the post-reconcile state. */
  async reconcile(
    sandboxId: string,
    request: ReconcileRequest = {},
  ): Promise<ReconcileResponse> {
    return this.post<ReconcileResponse>(`${base(sandboxId)}/reconcile`, request);
  }
}
