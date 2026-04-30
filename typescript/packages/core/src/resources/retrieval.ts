/**
 * Retrieval resource — the agent-native three-step knowledge-graph surface
 * mounted at `/api/v1/query`:
 *
 * - `discover(sandboxId, …)`  → typed menu of relevant context candidates.
 * - `interpret(sandboxId, …)` → 1–2 paragraph brief for one candidate.
 * - `search(sandboxId, …)`    → deep matrix retrieval with a synthesized answer.
 *
 * All three accept either a `window` (a {@link WindowLike} — typically a
 * {@link ContextWindow} from `client.contextWindow.create()`) or a raw
 * `history` array of recent chat turns. When both are set `window` wins.
 * Server caps at 20 turns.
 */

import { BaseResource } from './base.js';
import type { WindowLike } from '../context-window/types.js';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface DiscoveryItem {
  id: string;
  score: number;
  summary: string;
  /**
   * Full tuple of canonical IDs for the hierarchical path this item
   * represents. Pass as one tuple to `/interpret` to pin retrieval
   * to this slice of the graph.
   */
  canonical_ids: string[];
}

export interface DiscoverRequest {
  query: string;
  /**
   * Preferred: a {@link WindowLike} (e.g. a {@link ContextWindow}). The
   * resource reads turns via `window.getTurns()` at call time and passes
   * them to the server as `history`.
   */
  window?: WindowLike;
  /** Raw chat turns. Used only when `window` is not supplied. */
  history?: ChatMessage[];
  project_id?: string;
  reference_date?: string;
}

export interface DiscoverResponse {
  /** Markdown title + description orienting the caller on the response shape and how to use it. */
  header: string;
  items: DiscoveryItem[];
  count: number;
  sandbox_id: string;
  project_id?: string;
  query: string;
  /** Short actionable pointer for what to do after picking items. */
  next_steps: string;
}

export interface InterpretRequest {
  query: string;
  /**
   * One or more tuples of canonical IDs to pin interpretation to.
   * Feed the `canonical_ids` list from each DiscoveryItem you want
   * to include.
   */
  items: string[][];
  /** Preferred: a {@link WindowLike}. Wins over `history` when both set. */
  window?: WindowLike;
  /** Raw chat turns. Used only when `window` is not supplied. */
  history?: ChatMessage[];
  project_id?: string;
  reference_date?: string;
  preset?: SearchPreset;
  /** Cap on brief length. Accepts 100–16000; omit for the server default. */
  max_tokens?: number;
}

export interface InterpretCitation {
  canonical_id: string;
  name: string;
  relevance: number;
}

export interface InterpretResponse {
  brief: string;
  citations: InterpretCitation[];
  /** Echo of the `items` tuples the caller sent, for correlation. */
  items: string[][];
  sandbox_id: string;
  project_id?: string;
  query: string;
}

/**
 * `/search` retrieval modes accepted by the Copass API.
 *
 * Base presets trade off latency for depth:
 *   - `fast`     — low-latency agent-oriented
 *   - `auto`     — balanced quality (default server-side)
 *   - `discover` — returns raw data-chunk menu instead of a narrative answer
 *   - `sql`      — direct text-to-SQL over the ontology event store
 *   - `max`      — reserved, returns 403 for public callers
 *
 * `<base>-decompose` variants run an LLM pre-pass that breaks the question
 * into an ordered list of sub-questions, then execute `<base>` on each
 * before a single combined synthesis step. Only valid on `/search`;
 * `/interpret` does not accept decompose presets.
 */
export type SearchPreset =
  | 'fast'
  | 'auto'
  | 'discover'
  | 'sql'
  | 'max'
  | 'fast-decompose'
  | 'auto-decompose'
  | 'discover-decompose'
  | 'sql-decompose';

export interface SearchRequest {
  query: string;
  /** Preferred: a {@link WindowLike}. Wins over `history` when both set. */
  window?: WindowLike;
  /** Raw chat turns. Used only when `window` is not supplied. */
  history?: ChatMessage[];
  project_id?: string;
  reference_date?: string;
  preset?: SearchPreset;
  detail_level?: 'concise' | 'detailed';
  max_tokens?: number;
}

export interface SearchResponse {
  answer: string;
  preset: SearchPreset;
  execution_time_ms: number;
  warnings?: string[];
  sandbox_id: string;
  project_id?: string;
  query: string;
}

/**
 * Extract `history` from a request: `window.getTurns()` takes precedence,
 * then the explicit `history` array, then an empty array. Strips `window`
 * from the body so it doesn't get serialized.
 */
function resolveBody<T extends { window?: WindowLike; history?: ChatMessage[] }>(
  request: T,
): Omit<T, 'window'> & { history: ChatMessage[] } {
  const { window, history, ...rest } = request;
  const resolved = window ? window.getTurns() : history ?? [];
  return { ...rest, history: resolved } as Omit<T, 'window'> & { history: ChatMessage[] };
}

export class RetrievalResource extends BaseResource {
  discover(sandboxId: string, request: DiscoverRequest): Promise<DiscoverResponse> {
    return this.post<DiscoverResponse>(
      `/api/v1/query/sandboxes/${encodeURIComponent(sandboxId)}/discover`,
      resolveBody(request),
    );
  }

  interpret(sandboxId: string, request: InterpretRequest): Promise<InterpretResponse> {
    return this.post<InterpretResponse>(
      `/api/v1/query/sandboxes/${encodeURIComponent(sandboxId)}/interpret`,
      resolveBody(request),
    );
  }

  search(sandboxId: string, request: SearchRequest): Promise<SearchResponse> {
    return this.post<SearchResponse>(
      `/api/v1/query/sandboxes/${encodeURIComponent(sandboxId)}/search`,
      resolveBody(request),
    );
  }
}
