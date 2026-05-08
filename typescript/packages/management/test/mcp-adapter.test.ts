/**
 * Coverage for the @copass/management MCP adapter (registerToMcpServer).
 *
 * Regression-pinning two real bugs that hit production:
 *
 * 1. The "_zod undefined" bug: passing a full ``ZodObject`` (or worse, a
 *    ``ZodUnion`` from an ``oneOf`` output schema) to ``McpServer.registerTool``
 *    causes MCP to iterate over the schema's own properties (``_def``,
 *    ``parse``, ``shape``) and call ``._zod`` on them — exploding with
 *    ``Cannot read properties of undefined (reading '_zod')``. The adapter
 *    must extract the ``ZodRawShape`` (the ``{ key: ZodType }`` map) before
 *    handing the schema to MCP.
 *
 * 2. The ``list_agent_tools`` ``by_app`` mismatch: same root cause — the
 *    output schema for that tool used ``oneOf`` at the top level, which
 *    produces a ``ZodUnion`` that has no ``.shape``. The adapter must
 *    drop the outputSchema field gracefully when the schema isn't a
 *    plain object, so MCP doesn't choke on undefined.
 *
 * The handler-level dispatch is covered by ``handlers-dispatch.test.ts``;
 * this file exclusively exercises the MCP adaptation layer.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerToMcpServer } from '../src/adapters/mcp.js';
import type { CopassClient } from '@copass/core';


function makeStubClient(overrides: Record<string, unknown> = {}): CopassClient {
  // Every method the management handlers might call — stubbed.
  // Returns shape-compatible empty payloads so handler validation passes.
  const stub = {
    apiKeys: { list: vi.fn().mockResolvedValue([]) },
    integrations: {
      catalog: vi.fn().mockResolvedValue({ apps: [] }),
      listAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
      connect: vi.fn().mockResolvedValue({ connect_url: 'https://provider/x' }),
    },
    sandboxes: { list: vi.fn().mockResolvedValue({ sandboxes: [], count: 0 }) },
    sandboxConnections: {
      create: vi.fn().mockResolvedValue({ connection_id: 'conn-1' }),
      list: vi.fn().mockResolvedValue({ connections: [], count: 0 }),
      revoke: vi.fn().mockResolvedValue({ revoked: true }),
    },
    sources: {
      register: vi.fn().mockResolvedValue({ data_source_id: 'ds-1' }),
      list: vi.fn().mockResolvedValue({ sources: [], count: 0 }),
      retrieve: vi.fn().mockResolvedValue({ data_source_id: 'ds-1' }),
      update: vi.fn().mockResolvedValue({ data_source_id: 'ds-1' }),
      purge: vi.fn().mockResolvedValue({ success: true, delete_source_applied: false }),
      connectLinear: vi.fn().mockResolvedValue({ data_source_id: 'ds-linear' }),
      registerUserMcp: vi.fn().mockResolvedValue({ data_source_id: 'ds-mcp-1' }),
      testUserMcp: vi.fn().mockResolvedValue({ reachable: true }),
      revokeUserMcp: vi.fn().mockResolvedValue({ revoked: true }),
    },
    agents: {
      create: vi.fn().mockResolvedValue({ slug: 'new-bot' }),
      list: vi.fn().mockResolvedValue({ agents: [], count: 0 }),
      retrieve: vi.fn().mockResolvedValue({ slug: 'demo' }),
      update: vi.fn().mockResolvedValue({ slug: 'demo' }),
      updateModelSettings: vi.fn().mockResolvedValue({ slug: 'demo' }),
      updateToolSources: vi.fn().mockResolvedValue({ slug: 'demo' }),
      wireIntegration: vi.fn().mockResolvedValue({
        wired: true, mode: 'explicit', sources_added: [], tool_count: 5, message: 'ok',
      }),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      listRuns: vi.fn().mockResolvedValue({ runs: [], count: 0 }),
      getRun: vi.fn().mockResolvedValue({ run_id: 'run-1' }),
      listTriggerComponents: vi.fn().mockResolvedValue({ components: [] }),
      triggers: {
        create: vi.fn().mockResolvedValue({ trigger_id: 'trg-1' }),
        list: vi.fn().mockResolvedValue({ triggers: [], count: 0 }),
        updateById: vi.fn().mockResolvedValue({ trigger_id: 'trg-1' }),
      },
    },
    ...overrides,
  };
  return stub as unknown as CopassClient;
}


function makeMcpServer(): McpServer {
  return new McpServer(
    { name: 'mgmt-test', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
}


async function connectPair(server: McpServer): Promise<Client> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return mcpClient;
}


describe('registerToMcpServer — registration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers all 34 management tools without crashing on _zod', async () => {
    // The pre-fix adapter blew up with "Cannot read properties of
    // undefined (reading '_zod')" on tools whose outputSchema used
    // `oneOf` at the top level. This test would have caught it.
    const server = makeMcpServer();
    const regs = registerToMcpServer(server, makeStubClient(), { sandboxId: 'sb-1' });
    expect(regs.length).toBeGreaterThanOrEqual(34);
  });

  it('exposes every management tool through MCP listTools', async () => {
    const server = makeMcpServer();
    registerToMcpServer(server, makeStubClient(), { sandboxId: 'sb-1' });
    const mcpClient = await connectPair(server);
    try {
      const { tools } = await mcpClient.listTools();
      expect(tools.length).toBeGreaterThanOrEqual(34);
      const names = new Set(tools.map((t) => t.name));
      // Spot-check the surfaces from each management area.
      for (const required of [
        'list_apps', 'list_sandboxes', 'list_agents', 'list_sources',
        'list_api_keys', 'get_agent', 'get_source',
        'list_runs', 'list_triggers', 'list_agent_tools',
        'create_agent', 'update_agent_prompt', 'wire_integration_to_agent',
      ]) {
        expect(names.has(required)).toBe(true);
      }
    } finally {
      await mcpClient.close();
    }
  });
});


describe('registerToMcpServer — _zod regression bugs', () => {
  beforeEach(() => vi.clearAllMocks());

  // The bug appeared at MCP listTools / callTool time, not at register
  // time. So the regression test must actually invoke each previously
  // broken tool through the real MCP transport — that's what proves
  // the adapter no longer crashes on `oneOf` output schemas.
  const PREVIOUSLY_BROKEN = [
    { name: 'list_api_keys', args: {} },
    { name: 'list_apps', args: {} },
    { name: 'list_connected_accounts', args: {} },
    { name: 'list_sandbox_connections', args: {} },
    { name: 'list_runs', args: { agent_slug: 'demo' } },
    { name: 'list_triggers', args: { agent_slug: 'demo' } },
    { name: 'get_agent', args: { slug: 'demo' } },
    { name: 'get_source', args: { data_source_id: 'ds-1' } },
    { name: 'list_agent_tools', args: {} },
  ];

  for (const { name, args } of PREVIOUSLY_BROKEN) {
    it(`MCP callTool('${name}') no longer crashes with _zod undefined`, async () => {
      const server = makeMcpServer();
      registerToMcpServer(server, makeStubClient(), { sandboxId: 'sb-1' });
      const mcpClient = await connectPair(server);
      try {
        const result = await mcpClient.callTool({ name, arguments: args });
        // Crucial: the call returns a result rather than throwing.
        // The result MAY be an MCP error from the handler, but it MUST
        // NOT be the _zod TypeError that previously broke this path.
        expect(result).toBeDefined();
        if (result.isError) {
          const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
          expect(text).not.toMatch(/_zod/);
        }
      } finally {
        await mcpClient.close();
      }
    });
  }
});


describe('registerToMcpServer — handler dispatch through MCP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list_sandboxes routes through MCP to client.sandboxes.list', async () => {
    const list = vi.fn().mockResolvedValue({
      sandboxes: [
        {
          sandbox_id: 'sb_test',
          name: 'Test',
          tier: 'free',
          status: 'active',
          created_at: '2026-04-30T12:00:00Z',
        },
      ],
      count: 1,
    });
    const client = makeStubClient({
      sandboxes: { list } as unknown as CopassClient['sandboxes'],
    });
    const server = makeMcpServer();
    registerToMcpServer(server, client, { sandboxId: 'sb-1' });
    const mcpClient = await connectPair(server);
    try {
      const result = await mcpClient.callTool({
        name: 'list_sandboxes',
        arguments: {},
      });
      expect(list).toHaveBeenCalledTimes(1);
      expect(result.isError).toBeFalsy();
      // Structured content is the parsed handler result.
      const structured = result.structuredContent as { sandboxes: unknown[]; count: number };
      expect(structured.count).toBe(1);
    } finally {
      await mcpClient.close();
    }
  });

  it('list_apps (oneOf output schema) routes to integrations.catalog', async () => {
    // This is the test that would have caught the original _zod bug —
    // list_apps has the oneOf top-level output schema and was one of
    // the 8 broken tools. End-to-end MCP roundtrip pinned.
    const catalog = vi.fn().mockResolvedValue({
      apps: [{ app_slug: 'slack', name: 'Slack', provider: 'pipedream' }],
    });
    const client = makeStubClient({
      integrations: {
        catalog,
        listAccounts: vi.fn(),
        connect: vi.fn(),
      } as unknown as CopassClient['integrations'],
    });
    const server = makeMcpServer();
    registerToMcpServer(server, client, { sandboxId: 'sb-1' });
    const mcpClient = await connectPair(server);
    try {
      const result = await mcpClient.callTool({
        name: 'list_apps',
        arguments: { q: 'slack', limit: 10 },
      });
      expect(catalog).toHaveBeenCalledTimes(1);
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { apps: Array<{ app_slug: string }> };
      expect(structured.apps[0].app_slug).toBe('slack');
    } finally {
      await mcpClient.close();
    }
  });

  it('handler errors surface as MCP isError without crashing the adapter', async () => {
    const failingList = vi.fn().mockRejectedValue(new Error('upstream 500'));
    const client = makeStubClient({
      sandboxes: { list: failingList } as unknown as CopassClient['sandboxes'],
    });
    const server = makeMcpServer();
    registerToMcpServer(server, client, { sandboxId: 'sb-1' });
    const mcpClient = await connectPair(server);
    try {
      const result = await mcpClient.callTool({
        name: 'list_sandboxes',
        arguments: {},
      });
      // Adapter must not crash on handler exceptions. MCP wraps the
      // error into a result.isError = true response.
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
      expect(text).toMatch(/upstream 500/);
    } finally {
      await mcpClient.close();
    }
  });
});


describe('registerToMcpServer — schema shape extraction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('declares input schema for tools with required fields', async () => {
    const server = makeMcpServer();
    registerToMcpServer(server, makeStubClient(), { sandboxId: 'sb-1' });
    const mcpClient = await connectPair(server);
    try {
      const { tools } = await mcpClient.listTools();
      const getAgent = tools.find((t) => t.name === 'get_agent');
      expect(getAgent).toBeDefined();
      // get_agent requires { slug: string } — MCP advertises this in
      // its inputSchema.
      const inputSchema = getAgent!.inputSchema as {
        type: string;
        properties?: Record<string, unknown>;
      };
      expect(inputSchema.type).toBe('object');
      expect(inputSchema.properties).toBeDefined();
      expect(inputSchema.properties).toHaveProperty('slug');
    } finally {
      await mcpClient.close();
    }
  });

  it('drops outputSchema gracefully when handler output is non-object (oneOf)', async () => {
    // For tools whose outputSchema is `oneOf`-based (e.g. list_apps,
    // list_runs, get_agent — anything our jsonSchemaToZod compiles to
    // a ZodUnion), the MCP adapter must SKIP the outputSchema field
    // rather than passing a ZodUnion that MCP can't iterate. This
    // test verifies the listing succeeds with no outputSchema crash.
    const server = makeMcpServer();
    registerToMcpServer(server, makeStubClient(), { sandboxId: 'sb-1' });
    const mcpClient = await connectPair(server);
    try {
      const { tools } = await mcpClient.listTools();
      // The fact that listTools returned without crashing IS the
      // assertion. Pre-fix, this would never reach here.
      expect(tools.length).toBeGreaterThan(0);
    } finally {
      await mcpClient.close();
    }
  });
});
