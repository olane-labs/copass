import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

const BASE = '/api/v1/storage/sandboxes/sb-1/connections';

describe('sandboxConnections', () => {
  beforeEach(() => mockFetch.mockReset());

  it('create POSTs body with user_id + role', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ connection_id: 'conn-1', role: 'viewer' }),
    );
    const client = makeClient();
    const resp = await client.sandboxConnections.create('sb-1', {
      user_id: 'u-2',
      role: 'viewer',
    });
    const call = lastFetchCall();
    expect(call.url).toContain(BASE);
    expect((call.body as { user_id: string }).user_id).toBe('u-2');
    expect((call.body as { role: string }).role).toBe('viewer');
    expect(resp.connection_id).toBe('conn-1');
  });

  it('list GETs /connections', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ connections: [], count: 0 }));
    const client = makeClient();
    await client.sandboxConnections.list('sb-1');
    expect(lastFetchCall().url).toContain(BASE);
  });

  it('revoke DELETEs /connections/{cid}', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ revoked: true }));
    const client = makeClient();
    await client.sandboxConnections.revoke('sb-1', 'conn-1');
    const call = lastFetchCall();
    expect(call.method).toBe('DELETE');
    expect(call.url).toContain(`${BASE}/conn-1`);
  });

  it('spawnApiKey POSTs to /api-keys (plural)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        api_key_id: 'k-1',
        plaintext_key: 'olk_conn_abc',
        key_prefix: 'olk_conn_abc',
      }),
    );
    const client = makeClient();
    const resp = await client.sandboxConnections.spawnApiKey('sb-1', 'conn-1');
    expect(lastFetchCall().url).toContain(`${BASE}/conn-1/api-keys`);
    expect(resp.plaintext_key).toBe('olk_conn_abc');
    expect(resp.api_key_id).toBe('k-1');
  });
});
