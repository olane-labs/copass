/**
 * `AgentRouter` — high-level Copass agent-routing SDK.
 *
 * Sits on top of `@copass/core` and hides:
 *   - SSE parsing for `POST /sandboxes/{id}/agents/run` (stateless run —
 *     ``provider: 'anthropic' | 'google'`` only)
 *   - Persisted-agent CRUD + test-fire (`router.agents.*`) — covers
 *     ``backend: 'hermes'`` (sandbox-bound runtimes) plus the
 *     anthropic/google backends. Hermes agents pair ``backend: 'hermes'``
 *     with a ``compute_provider`` (``'daytona' | 'e2b'``) at create time
 *     and are exercised via `router.agents.testFire(slug, ...)` rather
 *     than `router.run(...)`.
 *   - OAuth connect-flow (browser redirect + local listener + reconcile poll)
 *   - Per-sandbox defaults + typed event surface
 *
 * Usage:
 *   const router = new AgentRouter({ auth, sandboxId });
 *
 *   // OAuth a data source.
 *   const { connection } = await router.integrations.connect('github', {
 *     onConnectUrl: (url) => open(url),
 *   });
 *
 *   // Stateless run (anthropic/google).
 *   for await (const event of router.run({ provider: 'anthropic', model, system, message, endUserId })) { ... }
 *
 *   // Persisted Hermes-on-E2B agent.
 *   await router.agents.create(sandboxId, {
 *     slug: 'my-hermes-agent',
 *     name: 'My Hermes Agent',
 *     system_prompt: 'You are a helpful assistant.',
 *     model_settings: {
 *       backend: 'hermes',
 *       compute_provider: 'e2b',
 *       model: 'hermes/anthropic/claude-sonnet-4-5',
 *     },
 *   });
 *   const run = await router.agents.testFire(sandboxId, 'my-hermes-agent', {
 *     event_payload: { input: 'Say hello.' },
 *   });
 */

import {
  CopassClient,
  type AgentsResource,
  type AuthConfig,
  type ConnectionItem,
  type ConnectionsListResponse,
  type IntegrationScope,
  type ReconcileResponse,
} from '@copass/core';
import type { AgentEvent } from './events.js';
import { frameToAgentEvent, iterateSseFrames } from './sse.js';
import {
  runConnectFlow,
  type ConnectFlowOptions,
  type ConnectFlowResult,
} from './connect-flow.js';

export interface AgentRouterOptions {
  /** Authentication — passed through to the underlying `CopassClient`. */
  auth: AuthConfig;
  /** Default sandbox id. Required for `run()`; `integrations.*` also default to it. */
  sandboxId: string;
  /** Override the Copass API host. Default: `https://ai.copass.id`. */
  apiUrl?: string;
  /** Pre-built client (injectable for tests). */
  client?: CopassClient;
}

export interface RunAgentOptions {
  /**
   * Stateless-run providers: `'anthropic' | 'google'`. For Hermes agents
   * use the persisted-agent surface instead — see `router.agents.testFire`.
   */
  provider: 'anthropic' | 'google' | (string & {});
  /** Model id. E.g. `'claude-opus-4-7'`, `'gemini-3.1-pro-preview'`. */
  model: string;
  /** System prompt. */
  system: string;
  /** Either a single string or a list of `{role:'user',content}` messages. */
  message?: string;
  messages?: Array<{ role: 'user'; content: string }>;
  /** Opaque per-end-user identifier (≤128 URL-safe chars). */
  endUserId: string;
  /** Provider session id from a prior finish event, to continue a chat. */
  sessionId?: string;
  /** Required when `provider='google'`: the deployed reasoning engine. */
  reasoningEngineId?: string;
  /** GCP region override for google. */
  location?: string;
  /** AbortSignal to cancel mid-stream. */
  signal?: AbortSignal;
}

/** Facade over `client.integrations` with flow helpers. */
export class IntegrationsFacade {
  constructor(
    private readonly client: CopassClient,
    private readonly defaultSandboxId: string,
  ) {}

  private sb(sandboxId?: string): string {
    const id = sandboxId ?? this.defaultSandboxId;
    if (!id) throw new Error('sandboxId is required (no default set on AgentRouter).');
    return id;
  }

  /** Browse apps for the sandbox. */
  async catalog(options: { q?: string; limit?: number; cursor?: string; sandboxId?: string } = {}) {
    const { sandboxId, ...rest } = options;
    return this.client.integrations.catalog(this.sb(sandboxId), rest);
  }

  /** Start the OAuth flow. Supply `onConnectUrl` — e.g. `(url) => open(url)`
   * on a CLI, or `(url) => window.open(url)` in a webapp. The promise
   * resolves once reconcile/webhook lands the DataSource. */
  async connect(
    app: string,
    options: Omit<ConnectFlowOptions, 'app'> & { sandboxId?: string },
  ): Promise<ConnectFlowResult> {
    const { sandboxId, ...rest } = options;
    return runConnectFlow(this.client, this.sb(sandboxId), { app, ...rest });
  }

  /** List active integration connections. */
  async list(options: { app?: string; sandboxId?: string } = {}): Promise<ConnectionsListResponse> {
    const { sandboxId, app } = options;
    return this.client.integrations.list(this.sb(sandboxId), { app });
  }

  /** Revoke + archive a connection. */
  async disconnect(sourceId: string, options: { sandboxId?: string } = {}): Promise<void> {
    await this.client.integrations.disconnect(this.sb(options.sandboxId), sourceId);
  }

  /** Force a reconcile against the provider (safety net for missed webhooks). */
  async reconcile(
    options: { app?: string; scope?: IntegrationScope; sandboxId?: string } = {},
  ): Promise<ReconcileResponse> {
    const { sandboxId, ...rest } = options;
    return this.client.integrations.reconcile(this.sb(sandboxId), rest);
  }
}

/** Top-level agent router SDK. */
export class AgentRouter {
  readonly client: CopassClient;
  readonly integrations: IntegrationsFacade;
  /**
   * Persisted-agent surface — CRUD + test-fire + run history for the
   * `/api/v1/storage/sandboxes/{id}/agents/*` endpoints. This is where
   * Hermes-backed agents live; Anthropic/Google agents can be persisted
   * here too (and run via `agents.testFire`) instead of using the
   * stateless `router.run(...)` path.
   *
   * Aliases `router.client.agents` for ergonomic parity with
   * `router.integrations`.
   */
  readonly agents: AgentsResource;
  private readonly defaultSandboxId: string;
  private readonly apiUrl: string;

  constructor(options: AgentRouterOptions) {
    this.client =
      options.client ?? new CopassClient({ auth: options.auth, apiUrl: options.apiUrl });
    this.apiUrl = options.apiUrl ?? 'https://ai.copass.id';
    this.defaultSandboxId = options.sandboxId;
    this.integrations = new IntegrationsFacade(this.client, options.sandboxId);
    this.agents = this.client.agents;
  }

  /** Run an agent turn and stream neutral `AgentEvent` values.
   *
   * Implemented as a direct `fetch` to the SSE endpoint instead of
   * piggybacking on `CopassClient.http` because the client's response
   * handling is JSON-shaped. Auth/headers are computed from the client's
   * auth provider so everything stays consistent. */
  async *run(options: RunAgentOptions, sandboxId?: string): AsyncIterableIterator<AgentEvent> {
    const sb = sandboxId ?? this.defaultSandboxId;
    if (!sb) throw new Error('sandboxId is required.');

    const messages =
      options.messages ?? (options.message ? [{ role: 'user' as const, content: options.message }] : []);
    if (messages.length === 0) {
      throw new Error('run(): either `message` or `messages` must be supplied.');
    }

    const body = {
      provider: options.provider,
      model: options.model,
      system_prompt: options.system,
      messages,
      end_user_id: options.endUserId,
      session_id: options.sessionId,
      reasoning_engine_id: options.reasoningEngineId,
      location: options.location,
    };

    // Resolve auth via the underlying client's auth provider so headers
    // are consistent with every other call we make.
    const session = await (this.client as unknown as {
      _authProvider?: { getSession(): Promise<{ accessToken?: string; sessionToken?: string }> };
    })._authProvider?.getSession();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    };
    if (session?.accessToken) headers['authorization'] = `Bearer ${session.accessToken}`;

    const url = `${this.apiUrl.replace(/\/$/, '')}/api/v1/storage/sandboxes/${sb}/agents/run`;
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`agents.run: HTTP ${resp.status} ${text.slice(0, 300)}`);
    }

    for await (const frame of iterateSseFrames(resp)) {
      const event = frameToAgentEvent(frame);
      if (event) yield event;
    }
  }
}
