/**
 * Retrieval resource — the agent-native three-step knowledge-graph surface
 * mounted at `/api/v1/query`:
 *
 * - `discover(sandboxId, …)`  → typed menu of relevant context candidates.
 * - `interpret(sandboxId, …)` → 1–2 paragraph brief for one candidate.
 * - `search(sandboxId, …)`    → deep matrix retrieval with a synthesized answer.
 *
 * All three accept `{ query, history }` where `history` is the caller-supplied
 * recent chat turns. Server caps at 20 turns.
 */

import { BaseResource } from './base.js';

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
  history?: ChatMessage[];
  project_id?: string;
  reference_date?: string;
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

export type SearchPreset = 'fast' | 'auto' | 'discover' | 'max';

export interface SearchRequest {
  query: string;
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

export class RetrievalResource extends BaseResource {
  discover(sandboxId: string, request: DiscoverRequest): Promise<DiscoverResponse> {
    return this.post<DiscoverResponse>(
      `/api/v1/query/sandboxes/${encodeURIComponent(sandboxId)}/discover`,
      { history: [], ...request },
    );
  }

  interpret(sandboxId: string, request: InterpretRequest): Promise<InterpretResponse> {
    return this.post<InterpretResponse>(
      `/api/v1/query/sandboxes/${encodeURIComponent(sandboxId)}/interpret`,
      { history: [], ...request },
    );
  }

  search(sandboxId: string, request: SearchRequest): Promise<SearchResponse> {
    return this.post<SearchResponse>(
      `/api/v1/query/sandboxes/${encodeURIComponent(sandboxId)}/search`,
      { history: [], ...request },
    );
  }
}
