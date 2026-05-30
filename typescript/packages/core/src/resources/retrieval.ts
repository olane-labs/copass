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

/**
 * Per-call cost telemetry attached to retrieval responses.
 *
 * `microcents` is the authoritative integer cost reported by the server.
 * `usd` is a display-only convenience (`microcents / 1_000_000`, rounded
 * to 6 decimals) — clients summing across responses MUST sum `microcents`
 * and divide once at display to avoid float-rounding drift.
 *
 * The field is optional on each response envelope: populated when the
 * server is configured to surface cost (`gate_mode` of `shadow` or
 * `enforce`) and absent / `null` when `gate_mode` is `off`.
 *
 * `gate_mode` indicates whether the server is enforcing credit balances
 * (`enforce`), reporting cost without enforcement (`shadow`), or not
 * tracking cost at all (`off`). Use it to detect "shadow mode is on —
 * cost is approximate" without inferring from a null `deduction_id`.
 */
export interface CostInfo {
  /**
   * Authoritative integer cost in USD microcents (1e-6 USD). Sum this
   * field — not `usd` — to aggregate cost across calls.
   */
  microcents: number;
  /**
   * Display-only USD convenience: `microcents / 1_000_000`, rounded to
   * 6 decimals. Float; do not sum for accounting.
   */
  usd?: number;
  /**
   * Opaque ledger identifier returned by the server; use it to join
   * against billing records you fetch from the server. May be `null`
   * (e.g. shadow mode where no ledger row was written, or paths that
   * skip settlement).
   */
  deduction_id?: string | null;
  /**
   * Server cost-tracking mode for this request. `off` means cost is
   * not tracked, `shadow` means cost is reported without enforcement,
   * `enforce` means credit balances are enforced.
   */
  gate_mode: 'off' | 'shadow' | 'enforce';
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /**
   * Optional named participant for this turn. When set, adapters that
   * push a chat message through to ingestion forward this as the
   * envelope's `speaker` field, retiring the legacy `[author=…]`
   * content-prefix convention. Caller-decides the literal value
   * (`'Alice'`, `'support-bot'`, an email address, …); when absent,
   * adapters typically fall back to capitalizing `role`.
   */
  name?: string;
}

export interface DiscoveryItem {
  id: string;
  score: number;
  /**
   * One-sentence summary. Populated by `copass/copass_1.0` (path string);
   * empty under `copass/copass_2.0` — use `subgraph` instead.
   */
  summary: string;
  /**
   * Tuple of canonical IDs to pin /interpret retrieval to this item.
   *
   * - Under `copass/copass_1.0` this is the full hierarchical path
   *   (root → leaf).
   * - Under `copass/copass_2.0` this is the matched canonical plus
   *   every sub-graph node the query graph identified inside it.
   */
  canonical_ids: string[];
  /**
   * Pre-rendered ASCII tree of the matched canonical's sub-graph,
   * with matched nodes highlighted (⭐) and event timestamps inline.
   * Only populated by the `copass/copass_2.0` preset; absent under
   * `copass/copass_1.0` (which puts a path breadcrumb in `summary`).
   */
  subgraph?: string | null;
  /**
   * Names of the entities in the user's question that this item
   * satisfies. Helps the agent reason about which parts of the
   * question each item answers. Only populated by the
   * `copass/copass_2.0` preset.
   */
  matched_query_nodes?: string[] | null;
  /**
   * Distinct source file paths this item's canonicals were extracted
   * from, ordered by extraction frequency descending. Populated server-
   * side from `metadata_discovered(file_path=…)` events the ingestion
   * pipeline stamps onto each canonical when the source chunk carried
   * a `[File: …]` header (code ingest).
   *
   * Eliminates the `discover → get_origin` round-trip when the agent
   * only needs to know which files to open: read this field first;
   * fall back to {@link RetrievalResource.getOrigin} only when this
   * list is empty.
   *
   * Empty for legacy sandboxes that predate file-path stamping,
   * conversation-only ingests with no file markers, or items where
   * every backing canonical was deduped from a previously-unstamped
   * extraction.
   */
  file_paths?: string[];
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
  /**
   * Retrieval preset selecting the discovery shape. Defaults to
   * `copass/copass_1.0` server-side when omitted. Under
   * `copass/copass_2.0` items carry an additional `subgraph` field
   * with a pre-rendered ASCII tree of the matched canonical, plus a
   * `matched_query_nodes` list of the question entities that resolved
   * to it. The `:thinking` suffix is NOT accepted on `/discover`.
   */
  preset?: SearchPreset;
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
  /**
   * Optional per-call cost telemetry. Populated by the server when
   * retrieval has a billable cost (`gate_mode` of `shadow` or
   * `enforce`); absent / `null` when `gate_mode` is `off` or when the
   * server omits the field. See {@link CostInfo} for field semantics.
   */
  cost?: CostInfo | null;
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
  /**
   * Optional per-call cost telemetry. Populated by the server when
   * retrieval has a billable cost (`gate_mode` of `shadow` or
   * `enforce`); absent / `null` when `gate_mode` is `off` or when the
   * server omits the field. See {@link CostInfo} for field semantics.
   */
  cost?: CostInfo | null;
}

/**
 * Retrieval presets accepted by the Copass API.
 *
 * Canonical names (preferred):
 *   - `copass/copass_1.0` — path-discovery (low-latency default)
 *   - `copass/copass_2.0` — hierarchical-fused per-node embeddings
 *
 * Short aliases `copass/1.0` and `copass/2.0` are also accepted by the
 * server and resolve to the same SearchMatrix; new code should prefer
 * the canonical names.
 *
 * Append `:thinking` to any base preset (e.g. `copass/copass_2.0:thinking`)
 * to run an LLM pre-pass that decomposes the question into sub-questions,
 * executes the base preset on each, and synthesizes one combined answer.
 * The `:thinking` suffix is `/search`-only — `/interpret` and `/discover`
 * reject it.
 */
export type SearchPreset =
  // Canonical names
  | 'copass/copass_1.0'
  | 'copass/copass_2.0'
  | 'copass/copass_1.0:thinking'
  | 'copass/copass_2.0:thinking'
  // Short aliases (kept for backward-compat)
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
  /**
   * Optional per-call cost telemetry. Populated by the server when
   * retrieval has a billable cost (`gate_mode` of `shadow` or
   * `enforce`); absent / `null` when `gate_mode` is `off` or when the
   * server omits the field. See {@link CostInfo} for field semantics.
   */
  cost?: CostInfo | null;
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

/**
 * Request body for `client.retrieval.getOrigin(sandboxId, …)` — entity →
 * source file lookup. Pair with `discover`: after the caller picks items
 * from the menu, `getOrigin` returns the files those canonicals were
 * extracted from so an agent can localize its next action.
 */
export interface OriginsRequest {
  /**
   * Canonical IDs to look up. Typically the `canonical_ids` arrays from
   * `DiscoveryItem`s the caller chose. Capped at 100 per request server-side.
   */
  canonical_ids: string[];
  /**
   * Per-canonical cap on returned files (1–50). Files are sorted by how
   * many extractions of the canonical came from each, descending.
   * Defaults to 10 server-side when omitted.
   */
  limit_per_canonical?: number;
}

/** One source file recorded against a canonical. */
export interface OriginFile {
  /**
   * Source file path as stamped at ingest time. Typically a repo-relative
   * POSIX path (e.g. `src/foo/bar.py`). The literal value the ingestion
   * pipeline recorded — caller decides how to resolve it.
   */
  file_path: string;
  /**
   * Number of independent extractions of this canonical that came from
   * this file. Higher = the canonical's center-of-mass is here.
   */
  extraction_count: number;
}

/** Per-canonical roll-up of source files. */
export interface OriginEntry {
  /** Echo of the canonical_id the caller supplied. */
  canonical_id: string;
  /**
   * Distinct files the canonical was extracted from, ordered by
   * `extraction_count` descending. Empty when the canonical has no
   * recorded file-path metadata (e.g. sandboxes ingested before
   * file-path stamping shipped).
   */
  files: OriginFile[];
}

export interface OriginsResponse {
  sandbox_id: string;
  /**
   * One entry per requested `canonical_id`, in the same order. Entries
   * for canonicals with no recorded files come back with `files=[]`, so
   * the response stays positionally aligned with the input list.
   */
  origins: OriginEntry[];
  /**
   * Optional per-call cost telemetry — populated under the same
   * `gate_mode` rules as the other retrieval responses. See {@link CostInfo}.
   */
  cost?: CostInfo | null;
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

  /**
   * Look up source files for one or more canonical entities. Use this
   * after `discover` to localize the agent's next action — e.g. open
   * the file with a native read tool. Cheaper than `search`: no LLM
   * legs, no synthesis, just an indexed DB lookup.
   */
  getOrigin(sandboxId: string, request: OriginsRequest): Promise<OriginsResponse> {
    return this.post<OriginsResponse>(
      `/api/v1/query/sandboxes/${encodeURIComponent(sandboxId)}/origins`,
      request,
    );
  }
}
