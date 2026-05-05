import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

describe('apiKeys', () => {
  beforeEach(() => mockFetch.mockReset());

  it('create POSTs to /api/v1/api-keys with name', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        id: 'k-1',
        name: 'ci',
        key: 'olk_live_abc',
        key_prefix: 'olk_live_abc',
        created_at: '2026-01-01T00:00:00',
        warning: 'Store this key securely — it will not be shown again.',
      }),
    );
    const client = makeClient();
    const resp = await client.apiKeys.create({ name: 'ci' });
    const call = lastFetchCall();
    expect(call.url).toContain('/api/v1/api-keys');
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ name: 'ci' });
    expect(resp.id).toBe('k-1');
    expect(resp.key).toBe('olk_live_abc');
    expect(resp.key_prefix).toBe('olk_live_abc');
  });

  it('list returns the array', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([
        {
          id: 'k-1',
          name: 'ci',
          key_prefix: 'olk_live_abc',
          created_at: '2026-01-01T00:00:00',
          use_count: 0,
          is_expired: false,
          jwt_needs_refresh: false,
        },
        {
          id: 'k-2',
          name: 'prod',
          key_prefix: 'olk_live_def',
          created_at: '2026-01-02T00:00:00',
          use_count: 0,
          is_expired: false,
          jwt_needs_refresh: false,
        },
      ]),
    );
    const client = makeClient();
    const resp = await client.apiKeys.list();
    expect(resp).toHaveLength(2);
    expect(resp[0].id).toBe('k-1');
    expect(resp[0].key_prefix).toBe('olk_live_abc');
  });

  it('revoke DELETEs the key path and returns the revoke response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ revoked: true, id: 'k-1', name: 'ci' }));
    const client = makeClient();
    const resp = await client.apiKeys.revoke('k-1');
    const call = lastFetchCall();
    expect(call.method).toBe('DELETE');
    expect(call.url).toContain('/api/v1/api-keys/k-1');
    expect(resp.revoked).toBe(true);
    expect(resp.id).toBe('k-1');
  });
});
