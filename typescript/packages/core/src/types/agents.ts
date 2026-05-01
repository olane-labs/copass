/**
 * Reactive Agents — type definitions for the persisted-agent surface.
 *
 * Backs the `/api/v1/storage/sandboxes/{sandbox_id}/agents/*` endpoints.
 *
 * NB: API JSON uses `model_settings` for the runtime config knobs —
 * Pydantic v2 reserves `model_config` as a ClassVar, so the API
 * boundary swapped names. The DB column is still `model_config`.
 */

export type AgentBackend = 'anthropic' | 'google';
export type AgentStatus = 'active' | 'archived';

export interface AgentModelSettings {
  /** Which shared agent runtime services this agent. */
  backend: AgentBackend;
  /** Backend-specific model id (e.g. "claude-sonnet-4-6"). */
  model: string;
  temperature?: number;
  max_tokens?: number;
  max_turns?: number;
  timeout_s?: number;
}

export interface Agent {
  agent_id: string;
  user_id: string;
  sandbox_id: string;
  /** [a-z0-9-]+, unique per (user_id, sandbox_id). */
  slug: string;
  name: string;
  description?: string | null;
  /** User-authored agent instructions. Server scans for secrets on write. */
  system_prompt: string;
  /** Tool keys the agent may call. */
  tool_allowlist: string[];
  model_settings: AgentModelSettings;
  status: AgentStatus;
  /** Monotonic — bumps on every mutating PATCH. */
  version: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAgentRequest {
  slug: string;
  name: string;
  description?: string;
  system_prompt: string;
  tool_allowlist?: string[];
  model_settings: AgentModelSettings;
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  system_prompt?: string;
  tool_allowlist?: string[];
  model_settings?: AgentModelSettings;
  status?: AgentStatus;
}

export interface AgentListResponse {
  agents: Agent[];
  count: number;
}

export interface ListAgentsOptions {
  /** Filter to only active or only archived. Default: returns all. */
  status?: AgentStatus;
}

/** One entry in the dynamic-per-sandbox tool catalog. */
export interface AgentToolDescriptor {
  /** Tool key e.g. "pd_slack_slack-post-message". */
  name: string;
  /** Originating provider app_slug. */
  app_slug: string;
  description: string;
}

export interface AgentToolCatalogResponse {
  tools: AgentToolDescriptor[];
  count: number;
}

/**
 * One trigger component the user can deploy.
 *
 * Returned by `GET /agents/triggers/components`. The `component_id` is
 * the slug to pass back as `adapter_config.pipedream_trigger.component_id`
 * when calling `client.sources.register(...)` — the `pipedream_trigger`
 * adapter-config key is the literal backend field name and is part of
 * the API contract today. `configurable_props` is the JSON-schema-like
 * array the upstream provider publishes — each entry's
 * `name`/`type`/`label` tells UI wizards what to ask the user.
 */
export interface TriggerComponent {
  component_id: string;
  name: string;
  description?: string | null;
  version?: string | null;
  /**
   * The provider's prop schema. Each entry has at minimum `name` and
   * `type` (e.g. 'app', 'string', 'integer'). Required for the
   * Concierge / wizard layer to interview the user before issuing
   * a deploy.
   */
  configurable_props: Array<Record<string, unknown>>;
}

export interface TriggerComponentListResponse {
  components: TriggerComponent[];
  count: number;
}

export interface ListTriggerComponentsOptions {
  /** App slug to filter by, e.g. 'slack', 'gmail'. */
  app?: string;
  /** Free-text search (forwarded as the upstream `q` parameter). */
  q?: string;
  /** Page size — server clamps to [1, 100]. Default 50. */
  limit?: number;
}

/**
 * POST body for `/agents/{slug}/test`.
 *
 * `event_payload` is JSON-dumped into the agent's user-turn input —
 * matches the shape a real trigger would deliver.
 */
export interface TestFireRequest {
  event_payload?: Record<string, unknown>;
}

// ─── Run log ────────────────────────────────────────────────────────────

export type RunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timeout';

export interface AgentRun {
  run_id: string;
  user_id: string;
  sandbox_id: string;
  agent_id: string;
  agent_version: number;
  /** Set for trigger-dispatched runs; null for test-fire / manual. */
  trigger_id?: string | null;
  status: RunStatus;
  input_event?: Record<string, unknown> | null;
  output_text?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  /** Phase 1 test-fire bypasses credit gate, so this is null for test-fire runs. */
  cost_microcents?: number | null;
  duration_ms?: number | null;
  error_message?: string | null;
  started_at?: string;
  finished_at?: string | null;
}

export interface AgentRunListResponse {
  runs: AgentRun[];
  count: number;
}

/**
 * Detail view of one run — adds the `tool_resolution_trace` audit JSON
 * (Phase 4) on top of the list-shape fields. Returned by
 * `client.agents.getRun(...)`.
 *
 * The trace is the answer to "why did this run see the tools it saw?"
 * — `sources_resolved` / `sources_skipped` / `tool_names_advertised`
 * / `allowlist_filtered_out` / `allowlist_missing_entries`. NULL on
 * pre-Phase-4 runs and ad-hoc invocations that bypass the persisted
 * runtime.
 */
export interface AgentRunDetail {
  run_id: string;
  agent_id: string;
  status: string;
  started_at?: string | null;
  finished_at?: string | null;
  error_message?: string | null;
  tool_resolution_trace?: Record<string, unknown> | null;
}

export interface ListAgentRunsOptions {
  /** Page size, clamped server-side to [1, 100]. */
  limit?: number;
  /** run_id cursor — return runs older than this row. */
  before?: string;
}

// ─── Triggers ───────────────────────────────────────────────────────────

export type TriggerStatus = 'active' | 'paused' | 'disabled';

export interface AgentTrigger {
  trigger_id: string;
  user_id: string;
  sandbox_id: string;
  agent_id: string;
  data_source_id: string;
  /** Dotted namespace e.g. "slack.message.new", or "*" for wildcard. */
  event_type_filter: string;
  /** Flat {key: scalar} match against DataSourceEvent.normalized_fields. */
  filter_config?: Record<string, unknown> | null;
  status: TriggerStatus;
  rate_limit_per_hour?: number | null;
  last_fired_at?: string | null;
  fire_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateTriggerRequest {
  data_source_id: string;
  event_type_filter: string;
  filter_config?: Record<string, unknown>;
  rate_limit_per_hour?: number;
}

export interface UpdateTriggerRequest {
  event_type_filter?: string;
  filter_config?: Record<string, unknown>;
  /** Set true to explicitly clear filter_config (distinguishes don't-touch from set-null). */
  clear_filter_config?: boolean;
  rate_limit_per_hour?: number;
  /** Set true to explicitly clear rate_limit_per_hour. */
  clear_rate_limit?: boolean;
  status?: TriggerStatus;
}

export interface TriggerListResponse {
  triggers: AgentTrigger[];
  count: number;
}

export interface ListTriggersOptions {
  status?: TriggerStatus;
}

/**
 * Body for ``PATCH /agents/{slug}/tool-sources``.
 *
 * The field is required so the absent-vs-null distinction is
 * structural (FastAPI 422s a missing body, vs silently no-op'ing on
 * the partial-update path). ``null`` reverts to the caller default,
 * ``[]`` makes the agent tool-less, a list sets the list verbatim.
 */
export interface UpdateAgentToolSourcesRequest {
  tool_sources: string[] | null;
}

/**
 * Body for ``POST /agents/{slug}/wire-integration``.
 *
 * The server resolves ``app_slug`` against the user's connected
 * integration providers and unions the matching source(s) into the
 * agent's ``tool_sources`` + rebuilds ``tool_allowlist`` atomically.
 */
export interface WireIntegrationRequest {
  /** Integration app slug, e.g. 'slack', 'gmail', 'linear'. */
  app_slug: string;
}

/**
 * Discriminator for the wire-integration result. Branch on
 * (``wired``, ``mode``):
 *
 * - `"explicit"`        — one or more providers wired, tools added.
 * - `"allow_all"`       — wired, allowlist set to allow-all (reserved).
 * - `"ingestion_only"`  — app exposes no callable tools (e.g. linear).
 * - `"not_connected"`   — no provider has this app connected.
 * - `"unknown_provider"`— provider present but not registered for
 *                          agent wiring (defensive; logged at ERROR).
 */
export type WireIntegrationMode =
  | 'explicit'
  | 'allow_all'
  | 'ingestion_only'
  | 'not_connected'
  | 'unknown_provider';

/**
 * Public envelope returned by ``AgentsResource.wireIntegration``.
 *
 * Mirrors the backend ``WireIntegrationResponse`` Pydantic model and
 * the ADR 0006 ``WireIntegrationResult`` dataclass. Idempotent: a
 * re-fire on an already-wired ``(slug, app_slug)`` pair returns
 * ``sources_added: []`` with the current ``tool_count``.
 */
export interface WireIntegrationResult {
  wired: boolean;
  agent_slug: string;
  app_slug: string;
  /** Provider keys (not source-ids) that were newly unioned in. */
  sources_added: string[];
  /** Total callable tools across the resulting source set. */
  tool_count: number;
  mode: WireIntegrationMode;
  /** Human-readable summary suitable for surfacing verbatim. */
  message: string;
}
