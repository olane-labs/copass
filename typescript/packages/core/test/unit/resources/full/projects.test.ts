import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

const BASE = '/api/v1/storage/sandboxes/sb-1/projects';

describe('projects', () => {
  beforeEach(() => mockFetch.mockReset());

  it('create POSTs body', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ project_id: 'p-1', name: 'Demo', status: 'active' }),
    );
    const client = makeClient();
    const resp = await client.projects.create('sb-1', { name: 'Demo' });
    const call = lastFetchCall();
    expect(call.url).toContain(BASE);
    expect(call.method).toBe('POST');
    expect((call.body as { name: string }).name).toBe('Demo');
    expect(resp.project_id).toBe('p-1');
  });

  it('list passes status query param', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ projects: [], count: 0 }));
    const client = makeClient();
    await client.projects.list('sb-1', { status: 'active' });
    expect(lastFetchCall().url).toContain('status=active');
  });

  it('retrieve GETs the project path', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ project_id: 'p-1' }));
    const client = makeClient();
    await client.projects.retrieve('sb-1', 'p-1');
    expect(lastFetchCall().url).toContain(`${BASE}/p-1`);
  });

  it('update PATCHes', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ project_id: 'p-1', name: 'renamed' }));
    const client = makeClient();
    await client.projects.update('sb-1', 'p-1', { name: 'renamed' });
    const call = lastFetchCall();
    expect(call.method).toBe('PATCH');
    expect(call.body).toEqual({ name: 'renamed' });
  });

  it('archive POSTs to /archive', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'archived' }));
    const client = makeClient();
    await client.projects.archive('sb-1', 'p-1');
    expect(lastFetchCall().url).toContain(`${BASE}/p-1/archive`);
  });

  it('del DELETEs the project', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ deleted: true }));
    const client = makeClient();
    await client.projects.del('sb-1', 'p-1');
    const call = lastFetchCall();
    expect(call.method).toBe('DELETE');
  });

  it('linkSource POSTs to /sources/{src}', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ linked: true }));
    const client = makeClient();
    await client.projects.linkSource('sb-1', 'p-1', 'src-1');
    expect(lastFetchCall().url).toContain(`${BASE}/p-1/sources/src-1`);
    expect(lastFetchCall().method).toBe('POST');
  });

  it('unlinkSource DELETEs /sources/{src}', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ unlinked: true }));
    const client = makeClient();
    await client.projects.unlinkSource('sb-1', 'p-1', 'src-1');
    expect(lastFetchCall().method).toBe('DELETE');
  });
});
