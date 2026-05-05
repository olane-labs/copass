import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

const BASE = '/api/v1/storage/sandboxes/sb-1/agents';

describe('agents', () => {
  beforeEach(() => mockFetch.mockReset());

  it('create POSTs body to /agents', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ slug: 'support-bot', name: 'Support', version: 1 }),
    );
    const client = makeClient();
    await client.agents.create('sb-1', {
      slug: 'support-bot',
      name: 'Support',
      system_prompt: 'Help users.',
    });
    const call = lastFetchCall();
    expect(call.url).toContain(BASE);
    expect(call.method).toBe('POST');
    expect((call.body as { slug: string }).slug).toBe('support-bot');
  });

  it('list GETs /agents', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ agents: [], count: 0 }));
    const client = makeClient();
    await client.agents.list('sb-1');
    expect(lastFetchCall().url).toContain(BASE);
  });

  it('retrieve GETs /agents/{slug}', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ slug: 'support-bot' }));
    const client = makeClient();
    await client.agents.retrieve('sb-1', 'support-bot');
    expect(lastFetchCall().url).toContain(`${BASE}/support-bot`);
  });

  it('update PATCHes /agents/{slug}', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ slug: 'support-bot', version: 2 }));
    const client = makeClient();
    await client.agents.update('sb-1', 'support-bot', { name: 'renamed' });
    const call = lastFetchCall();
    expect(call.method).toBe('PATCH');
    expect(call.body).toEqual({ name: 'renamed' });
  });

  it('archive DELETEs /agents/{slug}', async () => {
    mockFetch.mockResolvedValue(jsonResponse(null));
    const client = makeClient();
    await client.agents.archive('sb-1', 'support-bot');
    expect(lastFetchCall().method).toBe('DELETE');
  });

  it('updateModelSettings PATCHes /model-settings', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ slug: 'support-bot', model_settings: { backend: 'anthropic' } }),
    );
    const client = makeClient();
    await client.agents.updateModelSettings('sb-1', 'support-bot', {
      backend: 'anthropic',
      model: 'claude-opus-4-7',
    });
    expect(lastFetchCall().url).toContain('/model-settings');
    expect(lastFetchCall().method).toBe('PATCH');
  });

  it('updateToolSources PATCHes /tool-sources', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ slug: 'support-bot', tool_sources: ['slack'] }),
    );
    const client = makeClient();
    await client.agents.updateToolSources('sb-1', 'support-bot', ['slack']);
    expect(lastFetchCall().url).toContain('/tool-sources');
    expect(lastFetchCall().body).toEqual({ tool_sources: ['slack'] });
  });

  it('wireIntegration POSTs to /wire-integration', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        wired: true,
        mode: 'explicit',
        sources_added: ['slack-1'],
        tool_count: 5,
        message: 'wired',
      }),
    );
    const client = makeClient();
    const resp = await client.agents.wireIntegration('sb-1', 'support-bot', { app_slug: 'slack' });
    expect(lastFetchCall().url).toContain('/wire-integration');
    expect(resp.wired).toBe(true);
    expect(resp.tool_count).toBe(5);
  });

  it('testFire POSTs to /test', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ run_id: 'run-1', status: 'queued' }));
    const client = makeClient();
    await client.agents.testFire('sb-1', 'support-bot', { message: 'hello' });
    expect(lastFetchCall().url).toContain(`${BASE}/support-bot/test`);
    expect((lastFetchCall().body as { message: string }).message).toBe('hello');
  });

  it('listRuns GETs /runs with limit', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ runs: [], count: 0 }));
    const client = makeClient();
    await client.agents.listRuns('sb-1', 'support-bot', { limit: 10 });
    expect(lastFetchCall().url).toContain('limit=10');
  });

  it('getRun GETs /agents/runs/{run_id}', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ run_id: 'run-1', status: 'completed' }));
    const client = makeClient();
    await client.agents.getRun('sb-1', 'run-1');
    expect(lastFetchCall().url).toContain(`${BASE}/runs/run-1`);
  });

  it('listTools GETs /agents/tools', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ tools: [{ name: 'discover' }] }));
    const client = makeClient();
    await client.agents.listTools('sb-1');
    expect(lastFetchCall().url).toContain(`${BASE}/tools`);
  });

  it('listTriggerComponents GETs /triggers/components with app filter', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ components: [{ id: 'slack-msg' }] }));
    const client = makeClient();
    await client.agents.listTriggerComponents('sb-1', { app: 'slack' });
    expect(lastFetchCall().url).toContain(`${BASE}/triggers/components`);
    expect(lastFetchCall().url).toContain('app=slack');
  });
});
