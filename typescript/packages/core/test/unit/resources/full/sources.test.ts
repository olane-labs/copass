import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

const BASE = '/api/v1/storage/sandboxes/sb-1/sources';

describe('sources', () => {
  beforeEach(() => mockFetch.mockReset());

  it('register POSTs body', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ data_source_id: 'ds-1', name: 'demo', provider: 'manual', kind: 'durable' }),
    );
    const client = makeClient();
    const resp = await client.sources.register('sb-1', { provider: 'manual', name: 'demo' });
    const call = lastFetchCall();
    expect(call.url).toContain(BASE);
    expect(call.method).toBe('POST');
    expect((call.body as { provider: string }).provider).toBe('manual');
    expect(resp.data_source_id).toBe('ds-1');
  });

  it('list GETs /sources', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ sources: [], count: 0 }));
    const client = makeClient();
    await client.sources.list('sb-1');
    expect(lastFetchCall().url).toContain(BASE);
  });

  it('retrieve GETs /sources/{id}', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data_source_id: 'ds-1' }));
    const client = makeClient();
    await client.sources.retrieve('sb-1', 'ds-1');
    expect(lastFetchCall().url).toContain(`${BASE}/ds-1`);
  });

  it('update PATCHes', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data_source_id: 'ds-1', name: 'renamed' }));
    const client = makeClient();
    await client.sources.update('sb-1', 'ds-1', { name: 'renamed' });
    expect(lastFetchCall().method).toBe('PATCH');
  });

  it('connectLinear POSTs to /linear', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ data_source_id: 'ds-linear', kind: 'linear' }),
    );
    const client = makeClient();
    await client.sources.connectLinear('sb-1', { api_key: 'lin_abc' });
    expect(lastFetchCall().url).toContain(`${BASE}/linear`);
  });

  it('pause POSTs to /pause', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'paused' }));
    const client = makeClient();
    await client.sources.pause('sb-1', 'ds-1');
    expect(lastFetchCall().url).toContain(`${BASE}/ds-1/pause`);
  });

  it('resume POSTs to /resume', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'active' }));
    const client = makeClient();
    await client.sources.resume('sb-1', 'ds-1');
    expect(lastFetchCall().url).toContain(`${BASE}/ds-1/resume`);
  });

  it('disconnect POSTs to /disconnect', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'disconnected' }));
    const client = makeClient();
    await client.sources.disconnect('sb-1', 'ds-1');
    expect(lastFetchCall().url).toContain(`${BASE}/ds-1/disconnect`);
  });

  it('del DELETEs /sources/{id}', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ deleted: true }));
    const client = makeClient();
    await client.sources.del('sb-1', 'ds-1');
    expect(lastFetchCall().method).toBe('DELETE');
  });

  it('registerUserMcp POSTs to /user-mcp', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data_source_id: 'ds-mcp-1',
        status: 'active',
        name: 'my-mcp',
      }),
    );
    const client = makeClient();
    const resp = await client.sources.registerUserMcp('sb-1', {
      name: 'my-mcp',
      base_url: 'https://mcp.example',
      auth_kind: 'none',
    });
    expect(lastFetchCall().url).toContain(`${BASE}/user-mcp`);
    expect(resp.data_source_id).toBe('ds-mcp-1');
  });

  it('testUserMcp POSTs to /sources/{id}/user-mcp/test', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data_source_id: 'ds-mcp-1', status: 'active' }));
    const client = makeClient();
    await client.sources.testUserMcp('sb-1', 'ds-mcp-1');
    expect(lastFetchCall().url).toContain(`${BASE}/ds-mcp-1/user-mcp/test`);
  });

  it('revokeUserMcp POSTs to /sources/{id}/user-mcp/revoke', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data_source_id: 'ds-mcp-1', status: 'revoked' }));
    const client = makeClient();
    await client.sources.revokeUserMcp('sb-1', 'ds-mcp-1');
    expect(lastFetchCall().url).toContain(`${BASE}/ds-mcp-1/user-mcp/revoke`);
  });

  it('ingest POSTs to /sandboxes/{sid}/ingest with data_source_id pre-bound', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ job_id: 'j-1' }));
    const client = makeClient();
    await client.sources.ingest('sb-1', 'ds-1', { text: 'hello' });
    const call = lastFetchCall();
    expect(call.url).toContain('/api/v1/storage/sandboxes/sb-1/ingest');
    expect((call.body as { data_source_id: string }).data_source_id).toBe('ds-1');
  });
});
