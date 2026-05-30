/**
 * Tests for the @copass/mcp ``get_origin`` MCP tool.
 *
 * Verifies the tool wraps ``client.retrieval.getOrigin`` correctly:
 *   1. Forwards canonical_ids to the SDK call.
 *   2. Omits limit_per_canonical from the SDK body when not supplied
 *      (lets the server apply its own default).
 *   3. Forwards limit_per_canonical when the caller supplies one.
 *   4. Projects the origins payload + cost telemetry through
 *      mcpResult + appendCostToResult.
 *   5. Surfaces SDK errors as mcpError tool results.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../../src/server.js';
import type { CopassClient } from '@copass/core';
import type { ServerConfig } from '../../src/config.js';

function makeClient(
  getOriginImpl?: ReturnType<typeof vi.fn>,
): CopassClient {
  return {
    retrieval: {
      discover: vi.fn(),
      interpret: vi.fn(),
      search: vi.fn(),
      getOrigin:
        getOriginImpl ??
        vi.fn().mockResolvedValue({
          sandbox_id: 'sb-1',
          origins: [
            {
              canonical_id: 'cid-1',
              files: [
                { file_path: 'src/click/core.py', extraction_count: 12 },
                { file_path: 'src/click/decorators.py', extraction_count: 3 },
              ],
            },
          ],
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

async function connectPair(server: Awaited<ReturnType<typeof buildServer>>) {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return mcpClient;
}

describe('@copass/mcp get_origin tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards canonical_ids to the SDK call', async () => {
    const getOrigin = vi.fn().mockResolvedValue({
      sandbox_id: 'sb-1',
      origins: [{ canonical_id: 'cid-1', files: [] }],
    });
    const client = makeClient(getOrigin);
    const server = buildServer({ client, config: makeConfig() });
    const mcpClient = await connectPair(server);

    await mcpClient.callTool({
      name: 'get_origin',
      arguments: { canonical_ids: ['cid-1'] },
    });

    expect(getOrigin).toHaveBeenCalledWith(
      'sb-1',
      expect.objectContaining({ canonical_ids: ['cid-1'] }),
    );
  });

  it('omits limit_per_canonical when not supplied', async () => {
    const getOrigin = vi.fn().mockResolvedValue({
      sandbox_id: 'sb-1',
      origins: [],
    });
    const client = makeClient(getOrigin);
    const server = buildServer({ client, config: makeConfig() });
    const mcpClient = await connectPair(server);

    await mcpClient.callTool({
      name: 'get_origin',
      arguments: { canonical_ids: ['cid-1'] },
    });

    // Last arg to the SDK call should NOT carry limit_per_canonical —
    // the server applies its own default.
    const callArgs = getOrigin.mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('limit_per_canonical');
  });

  it('forwards limit_per_canonical when supplied', async () => {
    const getOrigin = vi.fn().mockResolvedValue({
      sandbox_id: 'sb-1',
      origins: [],
    });
    const client = makeClient(getOrigin);
    const server = buildServer({ client, config: makeConfig() });
    const mcpClient = await connectPair(server);

    await mcpClient.callTool({
      name: 'get_origin',
      arguments: { canonical_ids: ['cid-1', 'cid-2'], limit_per_canonical: 5 },
    });

    expect(getOrigin).toHaveBeenCalledWith(
      'sb-1',
      expect.objectContaining({
        canonical_ids: ['cid-1', 'cid-2'],
        limit_per_canonical: 5,
      }),
    );
  });

  it('projects origins payload through mcpResult', async () => {
    const client = makeClient(); // default mock — one canonical with two files
    const server = buildServer({ client, config: makeConfig() });
    const mcpClient = await connectPair(server);

    const result = await mcpClient.callTool({
      name: 'get_origin',
      arguments: { canonical_ids: ['cid-1'] },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text) as {
      sandbox_id: string;
      origins: Array<{
        canonical_id: string;
        files: Array<{ file_path: string; extraction_count: number }>;
      }>;
    };

    expect(parsed.sandbox_id).toBe('sb-1');
    expect(parsed.origins).toHaveLength(1);
    expect(parsed.origins[0].canonical_id).toBe('cid-1');
    expect(parsed.origins[0].files.map((f) => f.file_path)).toEqual([
      'src/click/core.py',
      'src/click/decorators.py',
    ]);
    expect(parsed.origins[0].files[0].extraction_count).toBe(12);
  });

  it('surfaces cost telemetry on _meta and the text content', async () => {
    const getOrigin = vi.fn().mockResolvedValue({
      sandbox_id: 'sb-1',
      origins: [],
      cost: { microcents: 1234, usd: 0.001234, gate_mode: 'enforce' },
    });
    const client = makeClient(getOrigin);
    const server = buildServer({ client, config: makeConfig() });
    const mcpClient = await connectPair(server);

    const result = await mcpClient.callTool({
      name: 'get_origin',
      arguments: { canonical_ids: ['cid-1'] },
    });

    const meta = result._meta as { cost?: { microcents: number; gate_mode: string } };
    expect(meta.cost?.microcents).toBe(1234);
    expect(meta.cost?.gate_mode).toBe('enforce');

    // The cost summary line is appended as a second text content
    // element so calling LLMs can self-throttle.
    const contents = result.content as Array<{ type: string; text: string }>;
    expect(contents.length).toBeGreaterThanOrEqual(2);
    expect(contents[contents.length - 1].text).toContain('1234');
  });

  it('returns mcpError when the SDK call throws', async () => {
    const getOrigin = vi
      .fn()
      .mockRejectedValue(new Error('upstream-500'));
    const client = makeClient(getOrigin);
    const server = buildServer({ client, config: makeConfig() });
    const mcpClient = await connectPair(server);

    const result = await mcpClient.callTool({
      name: 'get_origin',
      arguments: { canonical_ids: ['cid-1'] },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('upstream-500');
  });

  it('rejects empty canonical_ids without invoking the SDK', async () => {
    const client = makeClient();
    const server = buildServer({ client, config: makeConfig() });
    const mcpClient = await connectPair(server);

    // Zod-level minItems: 1. The MCP SDK either throws or returns an
    // isError result depending on transport — either is fine; the
    // contract we care about is that the upstream SDK is never
    // invoked with an invalid payload.
    let threw = false;
    let result: Awaited<ReturnType<typeof mcpClient.callTool>> | undefined;
    try {
      result = await mcpClient.callTool({
        name: 'get_origin',
        arguments: { canonical_ids: [] },
      });
    } catch {
      threw = true;
    }
    expect(threw || result?.isError === true).toBe(true);
    expect((client.retrieval.getOrigin as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
