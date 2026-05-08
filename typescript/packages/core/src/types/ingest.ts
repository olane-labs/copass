/**
 * Hint describing the kind of payload being ingested. Treated as an
 * advisory string by the API — not a strict enum. Conventional values:
 *
 * **Content-shape tokens** (describe how the body is encoded):
 *   - `'text'` — free-form text (default).
 *   - `'markdown'` — markdown-formatted text.
 *   - `'code'` — source code; downstream extractors may apply
 *     code-aware handling.
 *   - `'json'` — JSON-encoded payload.
 *
 * **Artifact-kind tokens** (describe the underlying artifact):
 *   - `'conversation'` — chat / IM / dialogue between participants.
 *     Pairs naturally with `speaker` and `participants` on the
 *     envelope.
 *   - `'ticket'` — ticketing system entry (Jira, Linear, GitHub
 *     issue, etc.).
 *   - `'email'` — email message; pairs with `participants` for
 *     to/cc/from.
 *   - `'note'` — personal / shared note.
 *
 * Custom values are accepted; the API does not gate on this field.
 * Use whatever string best describes the payload to a downstream
 * reader.
 */
export type IngestSourceType =
  | 'text'
  | 'markdown'
  | 'code'
  | 'json'
  | 'conversation'
  | 'ticket'
  | 'email'
  | 'note'
  | string;

export type IngestJobState =
  | 'queued'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | string;

export interface IngestTextRequest {
  text: string;
  source_type?: IngestSourceType;
  /** If true, chunk and store but do not run downstream ontology ingestion. */
  storage_only?: boolean;
  /** Optional project override (defaults to user's default project for the resolved sandbox). */
  project_id?: string;
  /** Optional data source association. */
  data_source_id?: string;
  /**
   * Optional ISO 8601 timestamp anchoring this payload to a real-world
   * moment (e.g. the conversation date for a chat session). When set,
   * every ontology event composed from this ingestion that doesn't
   * carry its own LLM-extracted occurred_at falls back to this value.
   * Lets temporal reasoning work even when the upstream LLM extractor
   * doesn't pull dates out of the text body.
   */
  occurred_at?: string;
  /**
   * Optional name of the participant who uttered this payload. Caller
   * decides the literal value (`'User'`, `'Assistant'`, `'Alice'`, an
   * email address, etc.); the SDK does not auto-derive it from any
   * other field. Most useful on conversation-shaped sources where
   * downstream extraction benefits from knowing who is speaking.
   * Adapters that work in role-typed worlds (`user` / `assistant`)
   * should capitalize the role themselves before passing it here.
   */
  speaker?: string;
  /**
   * Optional roster of participants present in the conversation /
   * thread / artifact this payload belongs to. Per-message — pass the
   * roster snapshot at the time of utterance. Useful for pronoun
   * resolution (e.g. resolving "you" / "your" against the other
   * listed participants when `speaker` is set). For single-participant
   * sources (a personal note), supplying `[speaker]` is fine; for
   * sources without participant semantics (a doc file), omit.
   */
  participants?: string[];
}

export interface IngestJobResponse {
  job_id: string;
  status: IngestJobState;
  encrypted: boolean;
  sandbox_id: string;
  project_id?: string;
  status_url: string;
}

export interface IngestJobChildren {
  total: number;
  queued?: number;
  processing?: number;
  completed?: number;
  failed?: number;
  [key: string]: number | undefined;
}

export interface IngestJobStatus {
  job_id: string;
  status: IngestJobState;
  job_type: string;
  encrypted: boolean;
  result?: Record<string, unknown>;
  error_message?: string;
  retry_count: number;
  parent_job_id?: string;
  chunk_index?: number;
  children?: IngestJobChildren;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
}
