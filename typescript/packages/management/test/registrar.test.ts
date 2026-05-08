import { describe, it, expect, vi } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CopassClient } from '@copass/core';
import { registerManagementTools, type ToolRegistration } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const sourceSpecDir = resolve(here, '..', '..', '..', '..', 'spec', 'management', 'v1');

describe('registerManagementTools', () => {
  it('registers all 34 tools (14 Phase 1 reads + 6 Phase 2 writes + 13 Chunk B writes + 1 v1.3) with handlers bound', () => {
    const client = new CopassClient({
      apiUrl: 'http://test',
      auth: { type: 'api-key', key: 'olk_test' },
    });

    const registered: ToolRegistration[] = [];
    registerManagementTools(
      (reg) => registered.push(reg),
      client,
      {
        sandboxId: 'sb_test',
        specDir: sourceSpecDir,
      },
    );

    expect(registered.length).toBe(34);
    const names = registered.map((r) => r.name).sort();
    expect(names).toEqual(
      [
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
        'purge_source_context',
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
      ].sort(),
    );

    for (const reg of registered) {
      expect(reg.description).toBeTypeOf('string');
      expect(reg.description.length).toBeGreaterThan(0);
      expect(reg.inputZod).toBeDefined();
      expect(reg.outputZod).toBeDefined();
      expect(reg.handler).toBeTypeOf('function');
    }
  });

  it('throws when a spec entry has no handler and allowMissingHandlers is false', async () => {
    const toolsModule = await import('../src/tools/index.js');
    const original = toolsModule.TOOL_HANDLERS.list_sandboxes;
    delete (toolsModule.TOOL_HANDLERS as Record<string, unknown>).list_sandboxes;
    try {
      const client = new CopassClient({
        apiUrl: 'http://test',
        auth: { type: 'api-key', key: 'olk_test' },
      });

      expect(() =>
        registerManagementTools(
          () => undefined,
          client,
          { sandboxId: 'sb_test', specDir: sourceSpecDir },
        ),
      ).toThrow(/no handler implementation for tool "list_sandboxes"/);
    } finally {
      (toolsModule.TOOL_HANDLERS as Record<string, unknown>).list_sandboxes = original;
    }
  });

  it('threads parsed input through the handler to the client', async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ sandboxes: [], count: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fakeFetch);

    const client = new CopassClient({
      apiUrl: 'http://test',
      auth: { type: 'api-key', key: 'olk_test' },
    });

    const registered: ToolRegistration[] = [];
    registerManagementTools(
      (reg) => registered.push(reg),
      client,
      {
        sandboxId: 'sb_test',
        specDir: sourceSpecDir,
      },
    );

    const listSandboxes = registered.find((r) => r.name === 'list_sandboxes');
    expect(listSandboxes).toBeDefined();

    const result = await listSandboxes!.handler({});
    expect(result).toEqual({ sandboxes: [], count: 0 });
    expect(fakeFetch).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
