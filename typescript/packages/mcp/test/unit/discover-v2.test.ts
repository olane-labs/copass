/**
 * copass/2.0 propagation tests for the @copass/mcp discover MCP tool.
 *
 * Verifies the MCP tool registered under name "discover":
 *   1. Forwards config.preset (subprocess default) when no per-call override.
 *   2. Honors per-call preset arg from the tool input.
 *   3. Projects v2 subgraph + matched_query_nodes in mcpResult.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../../src/server.js';
import type { CopassClient } from '@copass/core';
import type { ServerConfig } from '../../src/config.js';

function makeClientWithV2Response(discoverImpl?: ReturnType<typeof vi.fn>): CopassClient {
  return {
    retrieval: {
      discover: discoverImpl ?? vi.fn().mockResolvedValue({
        header: 'menu',
        items: [
          {
            id: 'cid-1',
            score: 0.89,
            summary: '',
            canonical_ids: ['cid-1', 'node-a'],
            subgraph: 'Tree ⭐',
            matched_query_nodes: ['A'],
          },
        ],
        count: 1,
        sandbox_id: 'sb-1',
        query: 'q',
        next_steps: '',
      }),
      interpret: vi.fn(),
      search: vi.fn(),
    },
  } as unknown as CopassClient;
}

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    api_url: 'http://stub',
    sandbox_id: 'sb-1',
    preset: 'copass/copass_1.0',
    ...overrides,
  } as ServerConfig;
}

async function connectPair(server: Awaited<ReturnType<typeof buildServer>>) {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return mcpClient;
}

describe('@copass/mcp discover tool — copass/2.0 propagation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses config.preset when no per-call preset is supplied', async () => {
    const discover = vi.fn().mockResolvedValue({
      header: '',
      items: [],
      count: 0,
      sandbox_id: 'sb-1',
      query: 'q',
      next_steps: '',
    });
    const client = makeClientWithV2Response(discover);
    const server = buildServer({
      client,
      config: makeConfig({ preset: 'copass/copass_2.0' }),
    });
    const mcpClient = await connectPair(server);
    await mcpClient.callTool({ name: 'discover', arguments: { query: 'q' } });
    expect(discover).toHaveBeenCalledWith(
      'sb-1',
      expect.objectContaining({ preset: 'copass/copass_2.0' }),
    );
  });

  it('per-call preset overrides config.preset', async () => {
    const discover = vi.fn().mockResolvedValue({
      header: '', items: [], count: 0, sandbox_id: 'sb-1', query: 'q', next_steps: '',
    });
    const client = makeClientWithV2Response(discover);
    const server = buildServer({
      client,
      config: makeConfig({ preset: 'copass/copass_1.0' }),
    });
    const mcpClient = await connectPair(server);
    await mcpClient.callTool({
      name: 'discover',
      arguments: { query: 'q', preset: 'copass/copass_2.0' },
    });
    expect(discover).toHaveBeenCalledWith(
      'sb-1',
      expect.objectContaining({ preset: 'copass/copass_2.0' }),
    );
  });

  it('projects v2 subgraph + matched_query_nodes in mcpResult', async () => {
    const client = makeClientWithV2Response();
    const server = buildServer({
      client,
      config: makeConfig({ preset: 'copass/copass_2.0' }),
    });
    const mcpClient = await connectPair(server);
    const result = await mcpClient.callTool({
      name: 'discover',
      arguments: { query: 'q' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text) as {
      items: Array<{ subgraph?: string | null; matched_query_nodes?: string[] | null }>;
    };
    expect(parsed.items[0].subgraph).toBe('Tree ⭐');
    expect(parsed.items[0].matched_query_nodes).toEqual(['A']);
  });
});
