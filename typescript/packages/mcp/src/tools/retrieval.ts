import { z } from 'zod';
import {
  DISCOVER_QUERY_PARAM,
  INTERPRET_DESCRIPTION,
  INTERPRET_ITEMS_PARAM,
  INTERPRET_QUERY_PARAM,
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
      },
    },
    async ({ query, project_id }) => {
      try {
        const response = await client.retrieval.discover(config.sandbox_id, {
          query,
          project_id: project_id ?? config.project_id,
          window: windows.resolve(),
        });
        return mcpResult({
          header: response.header,
          items: response.items.map((item) => ({
            score: item.score,
            summary: item.summary,
            canonical_ids: item.canonical_ids,
          })),
          next_steps: response.next_steps,
        });
      } catch (e) {
        return mcpError(e);
      }
    },
  );

  server.registerTool(
    'interpret',
    {
      description: INTERPRET_DESCRIPTION,
      inputSchema: {
        query: z.string().describe(INTERPRET_QUERY_PARAM),
        items: z.array(z.array(z.string()).min(1)).min(1).describe(INTERPRET_ITEMS_PARAM),
        preset: z.enum(['copass/1.0', 'copass/2.0']).optional().describe(PRESET_PARAM),
        project_id: z.string().optional().describe(PROJECT_ID_PARAM),
      },
    },
    async ({ query, items, preset, project_id }) => {
      try {
        const response = await client.retrieval.interpret(config.sandbox_id, {
          query,
          items,
          project_id: project_id ?? config.project_id,
          window: windows.resolve(),
          preset: preset ?? config.preset,
        });
        return mcpResult({ brief: response.brief });
      } catch (e) {
        return mcpError(e);
      }
    },
  );

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
