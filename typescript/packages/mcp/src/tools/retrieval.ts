import { z } from 'zod';
import {
  DISCOVER_QUERY_PARAM,
  MCP_DISCOVER_DESCRIPTION,
  PRESET_PARAM,
  PROJECT_ID_PARAM,
  SEARCH_DESCRIPTION,
  SEARCH_QUERY_PARAM,
} from '@copass/config';
import type { CopassClient } from '@copass/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerConfig } from '../config.js';
import type { WindowRegistry } from '../windows.js';

interface RetrievalDeps {
  client: CopassClient;
  config: ServerConfig;
  windows: WindowRegistry;
}

function mcpResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function mcpError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}

export function registerRetrievalTools(server: McpServer, deps: RetrievalDeps): void {
  const { client, config, windows } = deps;

  server.registerTool(
    'discover',
    {
      description: MCP_DISCOVER_DESCRIPTION,
      inputSchema: {
        query: z.string().describe(DISCOVER_QUERY_PARAM),
        project_id: z.string().optional().describe(PROJECT_ID_PARAM),
        // Per-call preset override. `:thinking` variants are
        // /search-only and rejected on /discover, so the enum here
        // intentionally omits them.
        preset: z
          .enum([
            'copass/copass_1.0',
            'copass/copass_2.0',
            // Short aliases (kept for backward-compat)
            'copass/1.0',
            'copass/2.0',
          ])
          .optional()
          .describe(PRESET_PARAM),
      },
    },
    async ({ query, project_id, preset }) => {
      try {
        const response = await client.retrieval.discover(config.sandbox_id, {
          query,
          project_id: project_id ?? config.project_id,
          window: windows.resolve(),
          // Per-call override wins; otherwise inherit the subprocess
          // default. `:thinking` variants are stripped at the server
          // (/discover rejects them) so we don't second-guess here.
          preset: preset ?? config.preset,
        });
        return mcpResult({
          header: response.header,
          // Project the v2 fields (`subgraph` + `matched_query_nodes`)
          // alongside the v1 fields. Populated only under
          // `copass/copass_2.0` (or its `copass/2.0` alias); `null`
          // under v1.
          items: response.items.map((item) => ({
            score: item.score,
            summary: item.summary,
            canonical_ids: item.canonical_ids,
            subgraph: item.subgraph ?? null,
            matched_query_nodes: item.matched_query_nodes ?? null,
          })),
          next_steps: response.next_steps,
        });
      } catch (e) {
        return mcpError(e);
      }
    },
  );

  // `interpret` is intentionally NOT registered as an MCP tool — agents
  // should use `discover` (auto-fired per turn via the hook) for context
  // and `search` for semantic lookups. The backend `/interpret` endpoint
  // stays available for legacy non-MCP clients (langchain/mastra/ai-sdk
  // adapters) that still register it.

  server.registerTool(
    'search',
    {
      description: SEARCH_DESCRIPTION,
      inputSchema: {
        query: z.string().describe(SEARCH_QUERY_PARAM),
        // `:thinking` variants split the question into sub-questions and
        // run the base preset on each before a combined synthesis.
        preset: z
          .enum([
            // Canonical names
            'copass/copass_1.0',
            'copass/copass_2.0',
            'copass/copass_1.0:thinking',
            'copass/copass_2.0:thinking',
            // Short aliases (kept for backward-compat)
            'copass/1.0',
            'copass/2.0',
            'copass/1.0:thinking',
            'copass/2.0:thinking',
          ])
          .optional()
          .describe(PRESET_PARAM),
        project_id: z.string().optional().describe(PROJECT_ID_PARAM),
      },
    },
    async ({ query, preset, project_id }) => {
      try {
        const response = await client.retrieval.search(config.sandbox_id, {
          query,
          project_id: project_id ?? config.project_id,
          window: windows.resolve(),
          preset: preset ?? config.preset,
        });
        return mcpResult({ answer: response.answer });
      } catch (e) {
        return mcpError(e);
      }
    },
  );
}
