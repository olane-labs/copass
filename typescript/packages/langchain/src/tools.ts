import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  DISCOVER_DESCRIPTION,
  DISCOVER_QUERY_PARAM,
  INTERPRET_DESCRIPTION,
  INTERPRET_ITEMS_PARAM,
  INTERPRET_QUERY_PARAM,
  SEARCH_DESCRIPTION,
  SEARCH_QUERY_PARAM,
} from '@copass/config';
import type { CopassClient, SearchPreset, WindowLike } from '@copass/core';

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
 * Return Copass retrieval as a set of LangChain tool objects (built with
 * `tool()` from `@langchain/core/tools`).
 *
 * Agent-framework-neutral shape: the LLM picks `discover` (menu of
 * relevant items) or `search` (synthesized answer). `interpret` stays
 * registered for back-compat but is legacy — prefer `search` for drill-in.
 *
 * @example
 * ```ts
 * import { ChatAnthropic } from '@langchain/anthropic';
 * import { createReactAgent } from '@langchain/langgraph/prebuilt';
 * import { copassTools } from '@copass/langchain';
 *
 * const window = await copass.contextWindow.create({ sandbox_id });
 * const tools = copassTools({ client: copass, sandbox_id, window });
 *
 * const agent = createReactAgent({
 *   llm: new ChatAnthropic({ model: 'claude-opus-4-7' }),
 *   tools: [tools.discover, tools.interpret, tools.search],
 * });
 *
 * const result = await agent.invoke({
 *   messages: [{ role: 'user', content: 'why is checkout flaky?' }],
 * });
 * ```
 */
export function copassTools(options: CopassToolsOptions) {
  const { client, sandbox_id, project_id, window, preset = 'copass/copass_1.0' } = options;

  const discover = tool(
    async ({ query }: { query: string }) => {
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
        })),
        next_steps: response.next_steps,
      };
    },
    {
      name: 'discover',
      description: DISCOVER_DESCRIPTION,
      schema: z.object({
        query: z.string().describe(DISCOVER_QUERY_PARAM),
      }),
    },
  );

  const interpret = tool(
    async ({ query, items }: { query: string; items: string[][] }) => {
      const response = await client.retrieval.interpret(sandbox_id, {
        query,
        items,
        project_id,
        window,
        preset,
      });
      return { brief: response.brief };
    },
    {
      name: 'interpret',
      description: INTERPRET_DESCRIPTION,
      schema: z.object({
        query: z.string().describe(INTERPRET_QUERY_PARAM),
        items: z.array(z.array(z.string())).min(1).describe(INTERPRET_ITEMS_PARAM),
      }),
    },
  );

  const search = tool(
    async ({ query }: { query: string }) => {
      const response = await client.retrieval.search(sandbox_id, {
        query,
        project_id,
        window,
        preset,
      });
      return { answer: response.answer };
    },
    {
      name: 'search',
      description: SEARCH_DESCRIPTION,
      schema: z.object({
        query: z.string().describe(SEARCH_QUERY_PARAM),
      }),
    },
  );

  return { discover, interpret, search };
}
