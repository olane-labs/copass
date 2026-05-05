import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

const BASE = '/api/v1/storage/sandboxes';

describe('sandboxes', () => {
  beforeEach(() => mockFetch.mockReset());

  it('create POSTs body', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ sandbox_id: 'sb-1', owner_id: 'owner', name: 'demo', tier: 'free', status: 'active', storage_provider_type: 'platform_s3', limits: {}, metadata: {} }),
    );
    const client = makeClient();
    const resp = await client.sandboxes.create({ name: 'demo', owner_id: 'owner' });
    const call = lastFetchCall();
    expect(call.url).toContain(BASE);
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ name: 'demo', owner_id: 'owner' });
    expect(resp.sandbox_id).toBe('sb-1');
  });

  it('list passes query params', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ sandboxes: [], count: 0 }));
    const client = makeClient();
    await client.sandboxes.list({ status: 'active', owner_id: 'owner-1' });
    const call = lastFetchCall();
    expect(call.url).toContain('status=active');
    expect(call.url).toContain('owner_id=owner-1');
    expect(call.method).toBe('GET');
  });

  it('retrieve GETs the sandbox path', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ sandbox_id: 'sb-1' }));
    const client = makeClient();
    const resp = await client.sandboxes.retrieve('sb-1');
    expect(lastFetchCall().url).toContain(`${BASE}/sb-1`);
    expect(resp.sandbox_id).toBe('sb-1');
  });

  it('update PATCHes', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ sandbox_id: 'sb-1', name: 'renamed' }));
    const client = makeClient();
    await client.sandboxes.update('sb-1', { name: 'renamed' });
    const call = lastFetchCall();
    expect(call.method).toBe('PATCH');
    expect(call.body).toEqual({ name: 'renamed' });
  });

  it('suspend POSTs to /suspend', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'suspended' }));
    const client = makeClient();
    await client.sandboxes.suspend('sb-1');
    expect(lastFetchCall().url).toContain('/sb-1/suspend');
  });

  it('reactivate POSTs to /reactivate', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'active' }));
    const client = makeClient();
    await client.sandboxes.reactivate('sb-1');
    expect(lastFetchCall().url).toContain('/sb-1/reactivate');
  });

  it('archive POSTs to /archive', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true }));
    const client = makeClient();
    await client.sandboxes.archive('sb-1');
    expect(lastFetchCall().url).toContain('/sb-1/archive');
  });

  it('destroy DELETEs', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ deleted: true }));
    const client = makeClient();
    await client.sandboxes.destroy('sb-1');
    const call = lastFetchCall();
    expect(call.method).toBe('DELETE');
    expect(call.url).toContain(`${BASE}/sb-1`);
  });
});
