/**
 * Per-call cost projection tests for the @copass/mcp retrieval tools.
 *
 * When the server returns optional `cost` telemetry on a discover/search
 * response, the MCP tool result should carry it in two places:
 *
 * 1. A compact one-line `Cost: …` summary appended to the `text` content
 *    so a calling LLM sees what each retrieval call spent and can
 *    self-throttle.
 * 2. The full `CostInfo` object on `_meta.cost` so programmatic
 *    consumers (benchmark harnesses, budget enforcers) can read it
 *    deterministically without parsing text.
 *
 * Covered cases:
 *   - cost absent → text unchanged, `_meta.cost` undefined.
 *   - cost present with `gate_mode: 'off'` and microcents 0 → text
 *     unchanged, but `_meta.cost` set (so consumers can read the mode).
 *   - cost present, `shadow` with microcents > 0 and deduction_id set →
 *     text appended with compact line, `_meta.cost` carries full object.
 *   - cost present, `shadow` with microcents > 0 and deduction_id null
 *     → same as above; text never renders deduction id either way.
 *   - cost present, `enforce` fully populated → all fields surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../../src/server.js';
import type { CopassClient, CostInfo } from '@copass/core';
import type { ServerConfig } from '../../src/config.js';

function makeClient(opts: {
  discoverCost?: CostInfo | null;
  searchCost?: CostInfo | null;
}): CopassClient {
  return {
    retrieval: {
      discover: vi.fn().mockResolvedValue({
        header: 'menu',
        items: [
          {
            id: 'cid-1',
            score: 0.5,
            summary: 'one',
            canonical_ids: ['cid-1'],
          },
        ],
        count: 1,
        sandbox_id: 'sb-1',
        query: 'q',
        next_steps: '',
        ...(opts.discoverCost !== undefined ? { cost: opts.discoverCost } : {}),
      }),
      interpret: vi.fn(),
      search: vi.fn().mockResolvedValue({
        answer: 'ok',
        preset: 'copass/copass_1.0',
        execution_time_ms: 1,
        sandbox_id: 'sb-1',
        query: 'q',
        ...(opts.searchCost !== undefined ? { cost: opts.searchCost } : {}),
      }),
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

async function connectPair(server: ReturnType<typeof buildServer>) {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return mcpClient;
}

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  _meta?: { cost?: CostInfo } & Record<string, unknown>;
};

describe('@copass/mcp retrieval tools — cost projection', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('discover', () => {
    it('cost absent → text unchanged, _meta.cost undefined', async () => {
      const client = makeClient({});
      const server = buildServer({ client, config: makeConfig() });
      const mcpClient = await connectPair(server);

      const result = (await mcpClient.callTool({
        name: 'discover',
        arguments: { query: 'q' },
      })) as ToolResult;

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).not.toContain('Cost:');
      expect(result._meta?.cost).toBeUndefined();
    });

    it("gate 'off' + microcents 0 → text unchanged, _meta.cost present (consumers see mode)", async () => {
      const cost: CostInfo = { microcents: 0, gate_mode: 'off' };
      const client = makeClient({ discoverCost: cost });
      const server = buildServer({ client, config: makeConfig() });
      const mcpClient = await connectPair(server);

      const result = (await mcpClient.callTool({
        name: 'discover',
        arguments: { query: 'q' },
      })) as ToolResult;

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).not.toContain('Cost:');
      expect(result._meta?.cost).toEqual(cost);
      expect(result._meta?.cost?.gate_mode).toBe('off');
    });

    it("gate 'shadow' + microcents > 0 + deduction_id set → text appended, _meta.cost full object", async () => {
      const cost: CostInfo = {
        microcents: 1234,
        usd: 0.001234,
        deduction_id: 'ded_abc123',
        gate_mode: 'shadow',
      };
      const client = makeClient({ discoverCost: cost });
      const server = buildServer({ client, config: makeConfig() });
      const mcpClient = await connectPair(server);

      const result = (await mcpClient.callTool({
        name: 'discover',
        arguments: { query: 'q' },
      })) as ToolResult;

      expect(result.content).toHaveLength(2);
      const costLine = result.content[1].text;
      expect(costLine).toBe('Cost: 1234 µ¢ ($0.001234) [gate: shadow]');
      // Opaque ledger id deliberately not rendered in LLM-visible text.
      expect(costLine).not.toContain('ded_abc123');

      expect(result._meta?.cost).toEqual(cost);
      expect(result._meta?.cost?.deduction_id).toBe('ded_abc123');
    });

    it("gate 'shadow' + microcents > 0 + deduction_id null → text appended, _meta.cost preserves null id", async () => {
      const cost: CostInfo = {
        microcents: 500,
        usd: 0.0005,
        deduction_id: null,
        gate_mode: 'shadow',
      };
      const client = makeClient({ discoverCost: cost });
      const server = buildServer({ client, config: makeConfig() });
      const mcpClient = await connectPair(server);

      const result = (await mcpClient.callTool({
        name: 'discover',
        arguments: { query: 'q' },
      })) as ToolResult;

      expect(result.content).toHaveLength(2);
      expect(result.content[1].text).toBe('Cost: 500 µ¢ ($0.000500) [gate: shadow]');
      expect(result._meta?.cost).toEqual(cost);
      expect(result._meta?.cost?.deduction_id).toBeNull();
    });

    it("gate 'enforce' fully populated → all fields surface correctly", async () => {
      const cost: CostInfo = {
        microcents: 9876,
        usd: 0.009876,
        deduction_id: 'ded_xyz789',
        gate_mode: 'enforce',
      };
      const client = makeClient({ discoverCost: cost });
      const server = buildServer({ client, config: makeConfig() });
      const mcpClient = await connectPair(server);

      const result = (await mcpClient.callTool({
        name: 'discover',
        arguments: { query: 'q' },
      })) as ToolResult;

      expect(result.content).toHaveLength(2);
      expect(result.content[1].text).toBe('Cost: 9876 µ¢ ($0.009876) [gate: enforce]');
      expect(result._meta?.cost).toEqual(cost);
      expect(result._meta?.cost?.gate_mode).toBe('enforce');
    });
  });

  describe('search', () => {
    it('cost absent → text unchanged, _meta.cost undefined', async () => {
      const client = makeClient({});
      const server = buildServer({ client, config: makeConfig() });
      const mcpClient = await connectPair(server);

      const result = (await mcpClient.callTool({
        name: 'search',
        arguments: { query: 'q' },
      })) as ToolResult;

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).not.toContain('Cost:');
      expect(result._meta?.cost).toBeUndefined();
    });

    it("gate 'shadow' + microcents > 0 → text appended, _meta.cost set", async () => {
      const cost: CostInfo = {
        microcents: 2500,
        usd: 0.0025,
        deduction_id: 'ded_search1',
        gate_mode: 'shadow',
      };
      const client = makeClient({ searchCost: cost });
      const server = buildServer({ client, config: makeConfig() });
      const mcpClient = await connectPair(server);

      const result = (await mcpClient.callTool({
        name: 'search',
        arguments: { query: 'q' },
      })) as ToolResult;

      expect(result.content).toHaveLength(2);
      expect(result.content[1].text).toBe('Cost: 2500 µ¢ ($0.002500) [gate: shadow]');
      expect(result._meta?.cost).toEqual(cost);
    });
  });
});
