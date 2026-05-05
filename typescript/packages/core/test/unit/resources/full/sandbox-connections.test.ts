import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

const BASE = '/api/v1/storage/sandboxes/sb-1/connections';

describe('sandboxConnections', () => {
  beforeEach(() => mockFetch.mockReset());

  it('create POSTs body', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ connection_id: 'conn-1', scope: 'read' }),
    );
    const client = makeClient();
    const resp = await client.sandboxConnections.create('sb-1', {
      target_user_id: 'u-2',
      scope: 'read',
    });
    const call = lastFetchCall();
    expect(call.url).toContain(BASE);
    expect((call.body as { target_user_id: string }).target_user_id).toBe('u-2');
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

  it('spawnApiKey POSTs to /api-key', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ key_id: 'k-1', key: 'olk_conn_abc' }),
    );
    const client = makeClient();
    const resp = await client.sandboxConnections.spawnApiKey('sb-1', 'conn-1');
    expect(lastFetchCall().url).toContain(`${BASE}/conn-1/api-key`);
    expect(resp.key).toBe('olk_conn_abc');
  });
});
