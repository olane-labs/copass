import type { ChatMessage } from '../resources/retrieval.js';

export interface CreateContextWindowOptions {
  sandbox_id: string;
  /** Optional project to attribute turn ingestions to. */
  project_id?: string;
  /**
   * Name for the underlying data source. Defaults to `window-<timestamp>`.
   * Stable names let you find a window again via `sources.list()`.
   */
  name?: string;
  /**
   * Default participant roster for this conversation. Forwarded as the
   * envelope's `participants` field on every turn pushed via
   * `addTurn`, so the LLM can resolve second-person pronouns against
   * the other listed participants.
   */
  participants?: string[];
}

export interface AttachContextWindowOptions {
  sandbox_id: string;
  data_source_id: string;
  /** Optional project override for any further turn ingestions. */
  project_id?: string;
  /**
   * Turns already exchanged in this thread. Seeds the local buffer so the
   * very next retrieval call is window-aware without waiting on a fresh turn.
   */
  initialTurns?: ChatMessage[];
  /** Default participant roster — see {@link CreateContextWindowOptions.participants}. */
  participants?: string[];
}

/**
 * Structural contract the retrieval resource accepts in place of a raw
 * `history` array. {@link ContextWindow} satisfies this; anything with a
 * `getTurns()` method will too.
 */
export interface WindowLike {
  getTurns(): ChatMessage[];
}
