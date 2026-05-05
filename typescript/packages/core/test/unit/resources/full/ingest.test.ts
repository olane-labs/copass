import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

describe('ingest', () => {
  beforeEach(() => mockFetch.mockReset());

  it('text shorthand POSTs to /api/v1/storage/ingest', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ job_id: 'j-1', status: 'queued' }));
    const client = makeClient();
    const resp = await client.ingest.text({ text: 'hello world', data_source_id: 'ds-1' });
    const call = lastFetchCall();
    expect(call.url).toContain('/api/v1/storage/ingest');
    expect(call.method).toBe('POST');
    expect((call.body as { text: string }).text).toBe('hello world');
    expect((call.body as { data_source_id: string }).data_source_id).toBe('ds-1');
    expect(resp.job_id).toBe('j-1');
  });

  it('getJob GETs by id', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ job_id: 'j-1', status: 'completed' }));
    const client = makeClient();
    const resp = await client.ingest.getJob('j-1');
    expect(lastFetchCall().url).toContain('/api/v1/storage/ingest/j-1');
    expect(resp.status).toBe('completed');
  });

  it('textInSandbox POSTs to /sandboxes/{sid}/ingest', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ job_id: 'j-2', status: 'queued' }));
    const client = makeClient();
    await client.ingest.textInSandbox('sb-1', { text: 'data', data_source_id: 'ds-2' });
    expect(lastFetchCall().url).toContain('/api/v1/storage/sandboxes/sb-1/ingest');
  });

  it('getSandboxJob GETs the sandbox-scoped path', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ job_id: 'j-2', status: 'running' }));
    const client = makeClient();
    await client.ingest.getSandboxJob('sb-1', 'j-2');
    expect(lastFetchCall().url).toContain('/api/v1/storage/sandboxes/sb-1/ingest/j-2');
  });
});
