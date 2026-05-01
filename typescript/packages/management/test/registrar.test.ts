import { describe, it, expect, vi } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CopassClient } from '@copass/core';
import { registerManagementTools, type ToolRegistration } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const sourceSpecDir = resolve(here, '..', '..', '..', '..', 'spec', 'management', 'v1');

describe('registerManagementTools', () => {
  it('registers the 14 Phase 1 read tools (Phase 2A specs are loaded but lack handlers until Phase 2B)', () => {
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
        allowMissingHandlers: true,
      },
    );

    // 14 read tools in Phase 2A — Phase 2B fans out to all 20.
    expect(registered.length).toBe(14);
    const names = registered.map((r) => r.name).sort();
    expect(names).toEqual(
      [
        'get_agent',
        'get_run_trace',
        'get_source',
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
        allowMissingHandlers: true,
      },
    );

    const listSandboxes = registered.find((r) => r.name === 'list_sandboxes');
    expect(listSandboxes).toBeDefined();

    const result = await listSandboxes!.handler({});
    expect(result).toEqual({ sandboxes: [], count: 0 });
    expect(fakeFetch).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('throws when a spec has no handler and allowMissingHandlers is not set', () => {
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
    ).toThrow(/no handler implementation for tool/);
  });
});
