import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

const BASE = '/api/v1/storage/sandboxes/sb-1/vault';

describe('vault', () => {
  beforeEach(() => mockFetch.mockReset());

  it('store PUTs raw bytes (Uint8Array) to encoded key path', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ key: 'copass/agent/fixture', stored: true }),
    );
    const client = makeClient();
    const data = new TextEncoder().encode('raw payload');
    await client.vault.store('sb-1', 'copass/agent/fixture', data);
    const call = lastFetchCall();
    expect(call.url).toContain(BASE);
    // The TS SDK keeps slashes literal in the path (they're valid URI
    // path separators); the Python SDK URL-encodes them. Accept both.
    expect(call.url).toMatch(/copass(\/|%2F)agent(\/|%2F)fixture/);
    expect(call.method).toBe('PUT');
  });

  it('retrieve GETs encoded key, returns raw bytes', async () => {
    // Server returns binary bytes; the SDK passes them through.
    mockFetch.mockResolvedValue(
      new Response(new TextEncoder().encode('binary'), { status: 200 }),
    );
    const client = makeClient();
    const resp = await client.vault.retrieve('sb-1', 'k1');
    expect(lastFetchCall().url).toContain(`${BASE}/k1`);
    // Returned as Uint8Array (or compatible binary).
    expect(resp instanceof Uint8Array || resp instanceof ArrayBuffer).toBe(true);
  });

  it('del DELETEs encoded key', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ deleted: true }));
    const client = makeClient();
    await client.vault.del('sb-1', 'k1');
    expect(lastFetchCall().method).toBe('DELETE');
  });

  it('list passes prefix query param', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ keys: ['copass/a'], count: 1 }));
    const client = makeClient();
    await client.vault.list('sb-1', { prefix: 'copass/' });
    expect(lastFetchCall().url).toContain('prefix=copass');
  });
});
