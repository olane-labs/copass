import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  DISCOVER_DESCRIPTION,
  DISCOVER_QUERY_PARAM,
  GET_ORIGIN_DESCRIPTION,
  INTERPRET_DESCRIPTION,
  INTERPRET_ITEMS_PARAM,
  INTERPRET_QUERY_PARAM,
  ORIGIN_CANONICAL_IDS_PARAM,
  ORIGIN_LIMIT_PARAM,
  SEARCH_DESCRIPTION,
  SEARCH_QUERY_PARAM,
} from '@copass/config';
import type {
  CopassClient,
  OriginEntry,
  OriginFile,
  SearchPreset,
  WindowLike,
} from '@copass/core';

export interface CopassToolsOptions {
  /** An authenticated `@copass/core` client. */
  client: CopassClient;
  /** Sandbox all retrieval runs against. */
  sandbox_id: string;
  /** Optional project scoping for retrieval calls. */
  project_id?: string;
  /**
   * Optional conversation window — a {@link WindowLike} (typically a
   * `ContextWindow` from `client.contextWindow.create()`). When provided,
   * every retrieval call is automatically window-aware.
   */
  window?: WindowLike;
  /**
   * Preset for `discover`, `interpret`, and `search`. Defaults to
   * `"copass/copass_1.0"`. Under `"copass/copass_2.0"` discover items
   * carry `subgraph` (pre-rendered ASCII tree) and `matched_query_nodes`
   * fields. Append `":thinking"` (e.g. `"copass/copass_2.0:thinking"`)
   * to enable task decomposition before retrieval on `search`.
   */
  preset?: SearchPreset;
}

/**
 * Return Copass retrieval as a set of Mastra tool objects (built with
 * `createTool` from `@mastra/core/tools`).
 *
 * Agent-framework-neutral shape: the LLM picks `discover` (menu of
 * relevant items) or `search` (synthesized answer). `interpret` stays
 * registered for back-compat but is legacy — prefer `search` for drill-in.
 *
 * @example
 * ```ts
 * import { Agent } from '@mastra/core/agent';
 * import { anthropic } from '@ai-sdk/anthropic';
 * import { copassTools } from '@copass/mastra';
 *
 * const window = await copass.contextWindow.create({ sandbox_id });
 * const tools = copassTools({ client: copass, sandbox_id, window });
 *
 * const agent = new Agent({
 *   name: 'support-bot',
 *   instructions: 'Answer questions using the knowledge graph.',
 *   model: anthropic('claude-opus-4-7'),
 *   tools,
 * });
 *
 * const response = await agent.generate('why is checkout flaky?');
 * ```
 */
export function copassTools(options: CopassToolsOptions) {
  const { client, sandbox_id, project_id, window, preset = 'copass/copass_1.0' } = options;

  const discover = createTool({
    id: 'discover',
    description: DISCOVER_DESCRIPTION,
    inputSchema: z.object({
      query: z.string().describe(DISCOVER_QUERY_PARAM),
    }),
    execute: async ({ query }) => {
      const response = await client.retrieval.discover(sandbox_id, {
        query,
        project_id,
        window,
        preset,
      });
      return {
        header: response.header,
        // Project the v2 fields (`subgraph` + `matched_query_nodes`)
        // alongside the v1 fields. Populated only under
        // `copass/copass_2.0` (or its `copass/2.0` alias); `null` under
        // v1 — agents can ignore them when not present.
        items: response.items.map((item) => ({
          score: item.score,
          summary: item.summary,
          canonical_ids: item.canonical_ids,
          subgraph: item.subgraph ?? null,
          matched_query_nodes: item.matched_query_nodes ?? null,
          // Inline source-file paths so the agent can `read` directly
          // without a follow-up `get_origin` call. Empty array when
          // the backend couldn't enrich (legacy sandbox / no file
          // markers in source chunks).
          file_paths: item.file_paths ?? [],
        })),
        next_steps: response.next_steps,
      };
    },
  });

  const interpret = createTool({
    id: 'interpret',
    description: INTERPRET_DESCRIPTION,
    inputSchema: z.object({
      query: z.string().describe(INTERPRET_QUERY_PARAM),
      items: z.array(z.array(z.string())).min(1).describe(INTERPRET_ITEMS_PARAM),
    }),
    execute: async ({ query, items }) => {
      const response = await client.retrieval.interpret(sandbox_id, {
        query,
        items,
        project_id,
        window,
        preset,
      });
      return { brief: response.brief };
    },
  });

  const search = createTool({
    id: 'search',
    description: SEARCH_DESCRIPTION,
    inputSchema: z.object({
      query: z.string().describe(SEARCH_QUERY_PARAM),
    }),
    execute: async ({ query }) => {
      const response = await client.retrieval.search(sandbox_id, {
        query,
        project_id,
        window,
        preset,
      });
      return { answer: response.answer };
    },
  });

  const get_origin = createTool({
    id: 'get_origin',
    description: GET_ORIGIN_DESCRIPTION,
    inputSchema: z.object({
      canonical_ids: z
        .array(z.string())
        .min(1)
        .max(100)
        .describe(ORIGIN_CANONICAL_IDS_PARAM),
      limit_per_canonical: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe(ORIGIN_LIMIT_PARAM),
    }),
    execute: async ({ canonical_ids, limit_per_canonical }) => {
      const response = await client.retrieval.getOrigin(sandbox_id, {
        canonical_ids,
        ...(limit_per_canonical !== undefined ? { limit_per_canonical } : {}),
      });
      return {
        sandbox_id: response.sandbox_id,
        origins: response.origins.map((entry: OriginEntry) => ({
          canonical_id: entry.canonical_id,
          files: entry.files.map((f: OriginFile) => ({
            file_path: f.file_path,
            extraction_count: f.extraction_count,
          })),
        })),
      };
    },
  });

  return { discover, interpret, search, get_origin };
}
