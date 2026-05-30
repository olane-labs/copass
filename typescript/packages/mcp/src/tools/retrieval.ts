import { z } from 'zod';
import {
  DISCOVER_QUERY_PARAM,
  MCP_DISCOVER_DESCRIPTION,
  MCP_GET_ORIGIN_DESCRIPTION,
  ORIGIN_CANONICAL_IDS_PARAM,
  ORIGIN_LIMIT_PARAM,
  PRESET_PARAM,
  PROJECT_ID_PARAM,
  SEARCH_DESCRIPTION,
  SEARCH_QUERY_PARAM,
} from '@copass/config';
import type { CopassClient, CostInfo } from '@copass/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerConfig } from '../config.js';
import type { WindowRegistry } from '../windows.js';

interface RetrievalDeps {
  client: CopassClient;
  config: ServerConfig;
  windows: WindowRegistry;
}

interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  // Index signature to match MCP SDK's `CallToolResult` shape (extends
  // `ResultSchema`'s loose object). Without it, TS rejects assignment
  // into the `ToolCallback` return type.
  [key: string]: unknown;
}

function mcpResult(payload: unknown): McpToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function mcpError(error: unknown): McpToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Project optional per-call cost telemetry onto a tool result. Mutates two
 * surfaces so both LLM and programmatic consumers see it:
 *
 * 1. Appends a compact one-line `Cost: …` summary to the text content so a
 *    calling LLM can self-throttle. Skipped when cost is absent, or when
 *    the gate is `off` and the call had zero microcents (no signal to add).
 *    Deduction ids are deliberately omitted from the text — they're opaque
 *    ledger references with no value to an LLM.
 * 2. Sets `_meta.cost` to the raw `CostInfo` object whenever the server
 *    returned one, including in `off` mode, so programmatic consumers can
 *    read the gate mode explicitly and join against ledger ids.
 *
 * No-op when `cost` is `null` or `undefined`.
 */
function appendCostToResult(result: McpToolResult, cost: CostInfo | null | undefined): McpToolResult {
  if (cost === null || cost === undefined) return result;

  const microcents = cost.microcents;
  // `_meta.cost` is always set when the server reports cost — even in
  // `off` mode — so programmatic consumers can see the gate state.
  result._meta = { ...(result._meta ?? {}), cost };

  if (typeof microcents !== 'number') return result;
  // Skip the LLM-visible line when the server isn't actually tracking
  // anything — `off` mode with zero microcents conveys no signal.
  if (cost.gate_mode === 'off' && microcents === 0) return result;

  // Prefer the server-supplied `usd` display value when present; fall
  // back to `microcents / 1_000_000` rounded to 6 decimals to match the
  // SDK's convention.
  const usd = typeof cost.usd === 'number' ? cost.usd : Number((microcents / 1_000_000).toFixed(6));
  const usdStr = usd.toFixed(6);
  const line = `Cost: ${microcents} µ¢ ($${usdStr}) [gate: ${cost.gate_mode}]`;

  result.content = [...result.content, { type: 'text' as const, text: line }];
  return result;
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
        return appendCostToResult(
          mcpResult({
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
              // Inline file_paths so agents can route directly from
              // discover → read without a follow-up get_origin call.
              // Empty for items the server couldn't enrich (legacy
              // sandboxes, conversation-only ingests). Populated by
              // the backend's discover_file_paths enrichment.
              file_paths: item.file_paths ?? [],
            })),
            next_steps: response.next_steps,
          }),
          response.cost,
        );
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
        return appendCostToResult(mcpResult({ answer: response.answer }), response.cost);
      } catch (e) {
        return mcpError(e);
      }
    },
  );

  server.registerTool(
    'get_origin',
    {
      description: MCP_GET_ORIGIN_DESCRIPTION,
      inputSchema: {
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
      },
    },
    async ({ canonical_ids, limit_per_canonical }) => {
      try {
        const response = await client.retrieval.getOrigin(config.sandbox_id, {
          canonical_ids,
          // Omit `limit_per_canonical` from the payload when the caller
          // didn't supply one so the server applies its own default
          // (currently 10) and adapters don't have to encode that here.
          ...(limit_per_canonical !== undefined ? { limit_per_canonical } : {}),
        });
        return appendCostToResult(
          mcpResult({
            sandbox_id: response.sandbox_id,
            origins: response.origins.map((entry) => ({
              canonical_id: entry.canonical_id,
              files: entry.files.map((f) => ({
                file_path: f.file_path,
                extraction_count: f.extraction_count,
              })),
            })),
          }),
          response.cost,
        );
      } catch (e) {
        return mcpError(e);
      }
    },
  );
}
