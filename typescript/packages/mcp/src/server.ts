import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CopassClient } from '@copass/core';
import { registerToMcpServer } from '@copass/management/adapters/mcp';
import type { ServerConfig } from './config.js';
import { WindowRegistry } from './windows.js';
import { registerRetrievalTools } from './tools/retrieval.js';
import { registerContextWindowTools } from './tools/context-window.js';
import { registerIngestTool } from './tools/ingest.js';

export interface BuildServerOptions {
  client: CopassClient;
  config: ServerConfig;
  /**
   * Optional pre-populated window registry. Useful when a parent process has
   * already created or attached to a Context Window and wants the server to
   * start with it as the active window.
   */
  windows?: WindowRegistry;
}

/**
 * Assemble the Copass MCP server with every tool registered. Doesn't connect
 * a transport — see `startStdioServer` in `./bin.ts` for the default path,
 * or wire your own transport if embedding.
 */
export function buildServer({ client, config, windows }: BuildServerOptions): McpServer {
  const server = new McpServer(
    {
      name: 'copass',
      version: '0.3.0',
    },
    {
      capabilities: { tools: {} },
    },
  );

  const registry = windows ?? new WindowRegistry();
  const deps = { client, config, windows: registry };

  registerRetrievalTools(server, deps);
  registerContextWindowTools(server, deps);
  registerIngestTool(server, { client, config });

  // The full management tool corpus is exposed regardless of sandbox role.
  // Viewer-role users see write tools but get structured 403 from the
  // service layer when they call them. Avoids an extra HTTP round-trip
  // at MCP startup. See ADR 0007 Phase 4 brief §10 for trade-off.
  registerToMcpServer(server, client, { sandboxId: config.sandbox_id });

  return server;
}
