import { describe, it, expect, vi, beforeAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CopassClient } from '@copass/core';
import { buildServer } from '../../src/server.js';
import type { ServerConfig } from '../../src/config.js';

// Point @copass/management at the source spec corpus when running from
// the workspace (no `dist/specs/v1/` is built for the dependency in
// dev). End users of `npx @copass/mcp` get the bundled corpus from the
// installed `@copass/management` artifact and don't need this override.
const here = dirname(fileURLToPath(import.meta.url));
const SOURCE_SPEC_DIR = resolve(
  here,
  '..',
  '..',
  '..',
  '..',
  '..',
  'spec',
  'management',
  'v1',
);

beforeAll(() => {
  process.env.COPASS_MANAGEMENT_SPEC_DIR = SOURCE_SPEC_DIR;
});

// Snapshot of every tool name registered by buildServer, derived
// dynamically from the management corpus. Update this Set when the
// shape changes (a new management spec lands, a context-window /
// retrieval / ingest tool is added/removed). The test below also
// asserts on the cardinality so accidental additions are caught.
const EXPECTED_TOOL_NAMES = new Set<string>([
  // retrieval (3)
  'discover',
  'interpret',
  'search',
  // context window (4)
  'context_window_create',
  'context_window_add_turn',
  'context_window_attach',
  'context_window_close',
  // ingest (1)
  'ingest',
  // management — full management corpus (33). Surface count grows as
  // new specs land in spec/management/v1/.
  'add_user_mcp_source',
  'connect_linear',
  'create_agent',
  'create_trigger',
  'get_agent',
  'get_run_trace',
  'get_source',
  'grant_sandbox_connection',
  'list_agent_tools',
  'list_agents',
  'list_api_keys',
  'list_apps',
  'list_connected_accounts',
  'list_runs',
  'list_sandbox_connections',
  'list_sandboxes',
  'list_sources',
  'list_trigger_components',
  'list_triggers',
  'pause_trigger',
  'provision_source',
  'resume_trigger',
  'revoke_sandbox_connection',
  'revoke_user_mcp_source',
  'start_integration_connect',
  'test_user_mcp_source',
  'update_agent_model_settings',
  'update_agent_prompt',
  'update_agent_tool_sources',
  'update_agent_tools',
  'update_source',
  'update_trigger',
  'wire_integration_to_agent',
]);

interface StubOptions {
  listSandboxes?: () => Promise<unknown>;
}

function makeStubClient(opts: StubOptions = {}): CopassClient {
  const stub = {
    sandboxes: {
      list:
        opts.listSandboxes ??
        (async () => ({ sandboxes: [], count: 0 })),
    },
  };
  return stub as unknown as CopassClient;
}

function makeConfig(): ServerConfig {
  return {
    api_url: 'http://stub',
    sandbox_id: 'sb_test',
    preset: 'copass/1.0',
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

describe('buildServer (combined retrieval + management surface)', () => {
  it('exposes the union of retrieval + context_window + ingest + management tools', async () => {
    const client = makeStubClient();
    const server = buildServer({ client, config: makeConfig() });

    const mcpClient = await connectPair(server);
    try {
      const { tools } = await mcpClient.listTools();
      const names = new Set(tools.map((t) => t.name));

      expect(names).toEqual(EXPECTED_TOOL_NAMES);
      expect(tools).toHaveLength(EXPECTED_TOOL_NAMES.size);
    } finally {
      await mcpClient.close();
    }
  });

  it('routes list_sandboxes through the management adapter to client.sandboxes.list()', async () => {
    const listSandboxes = vi.fn(async () => ({
      sandboxes: [
        {
          sandbox_id: 'sb_test',
          name: 'Test Sandbox',
          tier: 'free',
          status: 'active',
          created_at: '2026-04-30T12:00:00Z',
        },
      ],
      count: 1,
    }));
    const client = makeStubClient({ listSandboxes });
    const server = buildServer({ client, config: makeConfig() });

    const mcpClient = await connectPair(server);
    try {
      const result = await mcpClient.callTool({
        name: 'list_sandboxes',
        arguments: {},
      });

      expect(listSandboxes).toHaveBeenCalledTimes(1);
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        sandboxes: [
          {
            sandbox_id: 'sb_test',
            name: 'Test Sandbox',
            tier: 'free',
            status: 'active',
            created_at: '2026-04-30T12:00:00Z',
          },
        ],
        count: 1,
      });
    } finally {
      await mcpClient.close();
    }
  });
});
