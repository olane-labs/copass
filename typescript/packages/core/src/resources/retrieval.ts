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
 * Retrieval presets accepted by the Copass API.
 *
 * Base presets:
 *   - `copass/1.0` — path-discovery (low-latency default)
 *   - `copass/2.0` — hierarchical-fused per-node embeddings
 *
 * Append `:thinking` to either (e.g. `copass/2.0:thinking`) to run an
 * LLM pre-pass that decomposes the question into sub-questions, executes
 * the base preset on each, and synthesizes one combined answer.
 */
export type SearchPreset =
  | 'copass/1.0'
  | 'copass/2.0'
  | 'copass/1.0:thinking'
  | 'copass/2.0:thinking';

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
