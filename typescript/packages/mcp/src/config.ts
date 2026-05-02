import type { ChatMessage, SearchPreset } from '@copass/core';

export interface ServerConfig {
  api_url: string;
  /**
   * Required when the standalone `copass-mcp` bin builds its own
   * `CopassClient` from this config (`bin.ts`). Optional for embedded
   * use — when a host process (e.g. another MCP server) constructs the
   * `CopassClient` itself and passes it into `buildServer({ client })`,
   * the tool handlers never read this field.
   */
  api_key?: string;
  sandbox_id: string;
  project_id?: string;
  preset: SearchPreset;
  /** Default data_source_id for `ingest` when the caller doesn't pass one. */
  ingest_data_source_id?: string;
  /**
   * If set, the server attaches to this Context Window on startup and makes
   * it the active window. Use when another process (e.g. a Hono server)
   * already created the window and you're launching the MCP server as a
   * subprocess that should share it.
   */
  context_window_id?: string;
  /**
   * Optional pre-existing turns to seed the Context Window's buffer on
   * startup. Makes retrieval immediately window-aware on the first tool
   * call — without these, the first `discover` / `interpret` / `search`
   * after a subprocess spawn sees an empty history.
   *
   * Required when `context_window_id` refers to a thread that has prior
   * turns and the server should dedupe retrieval against them.
   */
  context_window_initial_turns?: ChatMessage[];
}

const VALID_PRESETS: readonly SearchPreset[] = [
  'copass/1.0',
  'copass/2.0',
  // `:thinking` variants are /search-only. Setting one of these as the
  // MCP subprocess default makes `interpret` fail (decomposition isn't
  // valid on /interpret) — fine when the subprocess is only used for
  // `search`, otherwise override per-call via the `preset` tool arg.
  'copass/1.0:thinking',
  'copass/2.0:thinking',
] as const;

/**
 * Read config from `process.env`.
 *
 * - `COPASS_API_KEY` (required)
 * - `COPASS_SANDBOX_ID` (required)
 * - `COPASS_API_URL` (default: https://ai.copass.id)
 * - `COPASS_PROJECT_ID` (optional — default for retrieval/ingest)
 * - `COPASS_PRESET` (default: `copass/1.0`). Accepts any `SearchPreset`,
 *   but `:thinking` variants only work on `/search` — setting one as the
 *   subprocess default breaks `interpret`. Leave at `copass/1.0` unless
 *   the subprocess is search-only, and override per-call via the
 *   `preset` tool arg.
 *
 * Throws a descriptive error for missing/invalid values so the MCP client
 * sees an immediate startup failure with actionable text.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const missing: string[] = [];
  const api_key = env.COPASS_API_KEY ?? '';
  const sandbox_id = env.COPASS_SANDBOX_ID ?? '';

  if (!api_key) missing.push('COPASS_API_KEY');
  if (!sandbox_id) missing.push('COPASS_SANDBOX_ID');

  if (missing.length > 0) {
    throw new Error(
      `@copass/mcp: missing required env var(s): ${missing.join(', ')}. ` +
        `Set them before launching the server.`,
    );
  }

  const api_url = env.COPASS_API_URL?.trim() || 'https://ai.copass.id';
  const project_id = env.COPASS_PROJECT_ID?.trim() || undefined;
  const rawPreset = env.COPASS_PRESET?.trim() || 'copass/1.0';

  if (!VALID_PRESETS.includes(rawPreset as SearchPreset)) {
    throw new Error(
      `@copass/mcp: COPASS_PRESET must be one of ${VALID_PRESETS.join(', ')}; got "${rawPreset}"`,
    );
  }

  const ingest_data_source_id = env.COPASS_INGEST_DATA_SOURCE_ID?.trim() || undefined;
  const context_window_id = env.COPASS_CONTEXT_WINDOW_ID?.trim() || undefined;
  const context_window_initial_turns = parseInitialTurns(
    env.COPASS_CONTEXT_WINDOW_INITIAL_TURNS,
  );

  return {
    api_url,
    api_key,
    sandbox_id,
    project_id,
    preset: rawPreset as SearchPreset,
    ingest_data_source_id,
    context_window_id,
    context_window_initial_turns,
  };
}

function parseInitialTurns(raw: string | undefined): ChatMessage[] | undefined {
  if (!raw || !raw.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `@copass/mcp: COPASS_CONTEXT_WINDOW_INITIAL_TURNS is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      '@copass/mcp: COPASS_CONTEXT_WINDOW_INITIAL_TURNS must be a JSON array of {role, content} objects',
    );
  }
  const turns: ChatMessage[] = [];
  for (const [i, entry] of parsed.entries()) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as { role?: unknown }).role !== 'string' ||
      typeof (entry as { content?: unknown }).content !== 'string'
    ) {
      throw new Error(
        `@copass/mcp: COPASS_CONTEXT_WINDOW_INITIAL_TURNS[${i}] must be {role: string, content: string}`,
      );
    }
    const { role, content } = entry as { role: string; content: string };
    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
      throw new Error(
        `@copass/mcp: COPASS_CONTEXT_WINDOW_INITIAL_TURNS[${i}].role must be "user" | "assistant" | "system"; got "${role}"`,
      );
    }
    turns.push({ role, content });
  }
  return turns;
}
