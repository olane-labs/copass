import { BaseResource } from './base.js';
import type { HttpClient } from '../http/http-client.js';
import type {
  Agent,
  AgentListResponse,
  AgentRun,
  AgentRunDetail,
  AgentRunListResponse,
  AgentToolCatalogResponse,
  AgentTrigger,
  CreateAgentRequest,
  CreateTriggerRequest,
  ListAgentRunsOptions,
  ListAgentsOptions,
  ListTriggerComponentsOptions,
  ListTriggersOptions,
  TestFireRequest,
  TriggerComponentListResponse,
  TriggerListResponse,
  UpdateAgentRequest,
  UpdateAgentToolSourcesRequest,
  UpdateTriggerRequest,
  WireIntegrationRequest,
  WireIntegrationResult,
} from '../types/agents.js';

const BASE = '/api/v1/storage/sandboxes';

function agentsBase(sandboxId: string): string {
  return `${BASE}/${sandboxId}/agents`;
}

/**
 * Triggers sub-resource — accessed via `client.agents.triggers`.
 *
 * Mounted under each agent slug:
 *   POST   /agents/{slug}/triggers
 *   GET    /agents/{slug}/triggers
 *   GET    /agents/{slug}/triggers/{trigger_id}
 *   PATCH  /agents/{slug}/triggers/{trigger_id}
 *   DELETE /agents/{slug}/triggers/{trigger_id}
 */
export class AgentTriggersResource extends BaseResource {
  async create(
    sandboxId: string,
    slug: string,
    request: CreateTriggerRequest,
  ): Promise<AgentTrigger> {
    return this.post<AgentTrigger>(
      `${agentsBase(sandboxId)}/${slug}/triggers`,
      request,
    );
  }

  async list(
    sandboxId: string,
    slug: string,
    options: ListTriggersOptions = {},
  ): Promise<TriggerListResponse> {
    return this.get<TriggerListResponse>(
      `${agentsBase(sandboxId)}/${slug}/triggers`,
      { query: { status: options.status } },
    );
  }

  async retrieve(
    sandboxId: string,
    slug: string,
    triggerId: string,
  ): Promise<AgentTrigger> {
    return this.get<AgentTrigger>(
      `${agentsBase(sandboxId)}/${slug}/triggers/${triggerId}`,
    );
  }

  async update(
    sandboxId: string,
    slug: string,
    triggerId: string,
    patch: UpdateTriggerRequest,
  ): Promise<AgentTrigger> {
    return this.patch<AgentTrigger>(
      `${agentsBase(sandboxId)}/${slug}/triggers/${triggerId}`,
      patch,
    );
  }

  /** Hard delete. Idempotent — always returns void. */
  async destroy(
    sandboxId: string,
    slug: string,
    triggerId: string,
  ): Promise<void> {
    await this.delete<void>(
      `${agentsBase(sandboxId)}/${slug}/triggers/${triggerId}`,
    );
  }
}

/**
 * Reactive Agents resource — persisted agent CRUD + test-fire + run log.
 *
 * `client.agents.triggers` for trigger CRUD nested under each agent.
 *
 * @example
 * ```typescript
 * const agent = await client.agents.create(sandboxId, {
 *   slug: 'gmail-triage',
 *   name: 'Gmail triage',
 *   system_prompt: 'You react to incoming emails...',
 *   tool_allowlist: [],
 *   model_settings: { backend: 'anthropic', model: 'claude-sonnet-4-6' },
 * });
 *
 * await client.agents.triggers.create(sandboxId, agent.slug, {
 *   data_source_id: '...',
 *   event_type_filter: 'gmail.message.received',
 * });
 * ```
 */
export class AgentsResource extends BaseResource {
  /** Trigger CRUD nested under each agent slug. */
  readonly triggers: AgentTriggersResource;

  constructor(http: HttpClient) {
    super(http);
    this.triggers = new AgentTriggersResource(http);
  }

  // ─── Agent CRUD ─────────────────────────────────────────────────────

  async create(
    sandboxId: string,
    request: CreateAgentRequest,
  ): Promise<Agent> {
    return this.post<Agent>(agentsBase(sandboxId), request);
  }

  async list(
    sandboxId: string,
    options: ListAgentsOptions = {},
  ): Promise<AgentListResponse> {
    return this.get<AgentListResponse>(agentsBase(sandboxId), {
      query: { status: options.status },
    });
  }

  async retrieve(sandboxId: string, slug: string): Promise<Agent> {
    return this.get<Agent>(`${agentsBase(sandboxId)}/${slug}`);
  }

  async update(
    sandboxId: string,
    slug: string,
    patch: UpdateAgentRequest,
  ): Promise<Agent> {
    return this.patch<Agent>(`${agentsBase(sandboxId)}/${slug}`, patch);
  }

  /** Soft-archive (status → 'archived'). Idempotent. */
  async archive(sandboxId: string, slug: string): Promise<void> {
    await this.delete<void>(`${agentsBase(sandboxId)}/${slug}`);
  }

  /**
   * Replace an agent's `tool_sources` (the resolver list).
   *
   * Targets `PATCH /agents/{slug}/tool-sources`. Distinct from
   * {@link update} so the absent-vs-null distinction is structural:
   *
   * - `tool_sources: null` — sent as JSON `null`; reverts to the
   *   caller's default tool-sources set.
   * - `tool_sources: []`   — explicit "tool-less by choice".
   * - `tool_sources: [...]` — set the list verbatim.
   *
   * Distinct from `tool_allowlist` — this controls which RESOLVERS
   * run (which tools are AVAILABLE), not which tool NAMES are
   * CALLABLE.
   */
  async updateToolSources(
    sandboxId: string,
    slug: string,
    toolSources: string[] | null,
  ): Promise<Agent> {
    const body: UpdateAgentToolSourcesRequest = {
      tool_sources: toolSources === null ? null : [...toolSources],
    };
    return this.patch<Agent>(
      `${agentsBase(sandboxId)}/${slug}/tool-sources`,
      body,
    );
  }

  /**
   * Wire a third-party integration's tools into one agent atomically.
   *
   * Targets `POST /agents/{slug}/wire-integration`. Resolves
   * `appSlug` against the user's active OAuth-connected providers,
   * unions the matching source(s) into the agent's `tool_sources`,
   * and rebuilds `tool_allowlist` from the full resulting source set
   * in one `update_agent` call.
   *
   * Idempotent per ADR 0006: re-firing on an already-wired
   * `(slug, appSlug)` pair returns `sources_added: []` with the
   * current `tool_count`.
   */
  async wireIntegration(
    sandboxId: string,
    slug: string,
    appSlug: string,
  ): Promise<WireIntegrationResult> {
    const body: WireIntegrationRequest = { app_slug: appSlug };
    return this.post<WireIntegrationResult>(
      `${agentsBase(sandboxId)}/${slug}/wire-integration`,
      body,
    );
  }

  // ─── Invocation ─────────────────────────────────────────────────────

  /**
   * Synchronously test-fire an agent against a synthetic event payload.
   *
   * Phase 1 caveats (server-side):
   * - Anthropic-only — `model_settings.backend = "google"` writes a
   *   failed run with a clear error
   * - No third-party tools wired (empty registry); real trigger dispatch
   *   restores tool wiring
   * - No credit gate — iterate freely without burning balance
   */
  async testFire(
    sandboxId: string,
    slug: string,
    request: TestFireRequest = {},
  ): Promise<AgentRun> {
    return this.post<AgentRun>(
      `${agentsBase(sandboxId)}/${slug}/test`,
      request,
    );
  }

  /**
   * List recent runs for an agent. Most-recent-first, cursor-paginated
   * via `before` (a run_id from a prior page).
   */
  async listRuns(
    sandboxId: string,
    slug: string,
    options: ListAgentRunsOptions = {},
  ): Promise<AgentRunListResponse> {
    return this.get<AgentRunListResponse>(
      `${agentsBase(sandboxId)}/${slug}/runs`,
      {
        query: {
          limit: options.limit !== undefined ? String(options.limit) : undefined,
          before: options.before,
        },
      },
    );
  }

  /**
   * Fetch one run by id, including the `tool_resolution_trace` audit
   * JSON (Phase 4). Targets
   * `GET /api/v1/storage/sandboxes/{sandbox_id}/agents/runs/{run_id}`.
   *
   * The trace is NULL on pre-Phase-4 runs and on ad-hoc
   * `/agents/run` invocations that bypass the persisted-agent
   * runtime.
   */
  async getRun(
    sandboxId: string,
    runId: string,
  ): Promise<AgentRunDetail> {
    return this.get<AgentRunDetail>(
      `${agentsBase(sandboxId)}/runs/${runId}`,
    );
  }

  /**
   * Dynamic-per-sandbox tool catalog (resolved live from upstream
   * provider discovery on the user's connected sources). Server-side at
   * `GET /agents/tools`.
   */
  async listTools(sandboxId: string): Promise<AgentToolCatalogResponse> {
    return this.get<AgentToolCatalogResponse>(
      `${agentsBase(sandboxId)}/tools`,
    );
  }

  /**
   * Search the upstream trigger-component registry. Use BEFORE
   * `client.sources.register({ adapter_config: { pipedream_trigger:
   * { component_id, configured_props } } })` to discover the right
   * `component_id` and the `configurable_props` schema the user
   * needs to fill in. (Note: the `pipedream_trigger` adapter-config
   * key is the literal backend field name and is part of the API
   * contract today.) Server-side at
   * `GET /agents/triggers/components`.
   */
  async listTriggerComponents(
    sandboxId: string,
    options: ListTriggerComponentsOptions = {},
  ): Promise<TriggerComponentListResponse> {
    return this.get<TriggerComponentListResponse>(
      `${agentsBase(sandboxId)}/triggers/components`,
      {
        query: {
          app: options.app,
          q: options.q,
          limit: options.limit !== undefined ? String(options.limit) : undefined,
        },
      },
    );
  }
}
