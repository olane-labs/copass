import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

describe('apiKeys', () => {
  beforeEach(() => mockFetch.mockReset());

  it('create POSTs to /api/v1/api-keys with name', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ key_id: 'k-1', key: 'olk_live_abc', name: 'ci' }),
    );
    const client = makeClient();
    const resp = await client.apiKeys.create({ name: 'ci' });
    const call = lastFetchCall();
    expect(call.url).toContain('/api/v1/api-keys');
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ name: 'ci' });
    expect(resp.key).toBe('olk_live_abc');
  });

  it('list returns the array', async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ key_id: 'k-1' }, { key_id: 'k-2' }]));
    const client = makeClient();
    const resp = await client.apiKeys.list();
    expect(resp).toHaveLength(2);
    expect(resp[0].key_id).toBe('k-1');
  });

  it('revoke DELETEs the key path', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ revoked: true }));
    const client = makeClient();
    await client.apiKeys.revoke('k-1');
    const call = lastFetchCall();
    expect(call.method).toBe('DELETE');
    expect(call.url).toContain('/api/v1/api-keys/k-1');
  });
});
