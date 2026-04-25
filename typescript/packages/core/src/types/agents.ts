/**
 * Reactive Agents — type definitions for the persisted-agent surface.
 *
 * Backs the `/api/v1/storage/sandboxes/{sandbox_id}/agents/*` endpoints
 * (server-side: `frame_graph/copass_id/api/agents_crud.py`).
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
  /** Originating Pipedream app_slug. */
  app_slug: string;
  description: string;
}

export interface AgentToolCatalogResponse {
  tools: AgentToolDescriptor[];
  count: number;
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
