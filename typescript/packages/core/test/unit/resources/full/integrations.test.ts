import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

const BASE = '/api/v1/storage/sandboxes/sb-1/sources/integrations';

describe('integrations', () => {
  beforeEach(() => mockFetch.mockReset());

  it('catalog GETs /catalog', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ apps: [{ slug: 'slack' }] }));
    const client = makeClient();
    await client.integrations.catalog('sb-1');
    expect(lastFetchCall().url).toContain(`${BASE}/catalog`);
  });

  it('listAccounts hits /accounts and passes app_slug query param', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ accounts: [{ id: 'acct-1' }] }));
    const client = makeClient();
    await client.integrations.listAccounts('sb-1', { app_slug: 'slack' });
    const call = lastFetchCall();
    expect(call.url).toContain(`${BASE}/accounts`);
    expect(call.url).toContain('app_slug=slack');
  });

  it('connect POSTs to /{app}/connect with redirect URIs', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ connect_url: 'https://provider/connect/abc' }),
    );
    const client = makeClient();
    await client.integrations.connect('sb-1', 'slack', {
      success_redirect_uri: 'https://app/done',
      error_redirect_uri: 'https://app/err',
    });
    const call = lastFetchCall();
    expect(call.url).toContain(`${BASE}/slack/connect`);
    expect((call.body as { success_redirect_uri: string }).success_redirect_uri).toBe(
      'https://app/done',
    );
  });

  it('list passes app query param and returns ConnectionsListResponse {items}', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ items: [] }));
    const client = makeClient();
    const resp = await client.integrations.list('sb-1', { app: 'slack' });
    expect(lastFetchCall().url).toContain('app=slack');
    expect(resp.items).toEqual([]);
  });

  it('disconnect DELETEs /connections/{src} (204 No Content)', async () => {
    // Backend returns 204 with no body — provide a 204 Response so the
    // SDK's no-body path is exercised end-to-end.
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const client = makeClient();
    await client.integrations.disconnect('sb-1', 'src-1');
    const call = lastFetchCall();
    expect(call.method).toBe('DELETE');
    expect(call.url).toContain(`${BASE}/connections/src-1`);
  });

  it('reconcile POSTs to /reconcile', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ reconciled: 3 }));
    const client = makeClient();
    await client.integrations.reconcile('sb-1');
    expect(lastFetchCall().url).toContain(`${BASE}/reconcile`);
  });
});
