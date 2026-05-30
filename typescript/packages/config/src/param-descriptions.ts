/**
 * Parameter descriptions for the Copass retrieval tools.
 *
 * These are what the LLM sees next to each tool's argument. Kept as
 * separate constants because the three tools ask for "query" with
 * slightly different framing (broad menu vs. pointed brief vs. direct
 * answer) — unifying them would lose signal.
 */

/** `query` param — discover. */
export const DISCOVER_QUERY_PARAM =
  'Natural-language query to surface relevant context for.';

/** `query` param — interpret. */
export const INTERPRET_QUERY_PARAM = 'The question the brief should answer.';

/** `query` param — search. */
export const SEARCH_QUERY_PARAM = 'The question to answer.';

/** `items` param — interpret. */
export const INTERPRET_ITEMS_PARAM = [
  'List of canonical_ids tuples — each tuple is the `canonical_ids` field',
  'from one discover item. Pass several to synthesize across items.',
].join(' ');

/** `project_id` param — used by all three retrieval tools. */
export const PROJECT_ID_PARAM = 'Override the server default project_id.';

/** `preset` param — interpret and search. */
export const PRESET_PARAM = 'Override the server default preset.';

/** `canonical_ids` param — get_origin. */
export const ORIGIN_CANONICAL_IDS_PARAM = [
  'Canonical IDs to look up source files for. Typically the',
  '`canonical_ids` arrays from items the caller picked out of `discover`.',
  'At least one is required; up to 100 per call.',
].join(' ');

/** `limit_per_canonical` param — get_origin. */
export const ORIGIN_LIMIT_PARAM = [
  'Per-canonical cap on returned files (1–50). Files are ordered by how',
  'many extractions of the canonical came from each, descending.',
  'Defaults to 10 when omitted.',
].join(' ');
