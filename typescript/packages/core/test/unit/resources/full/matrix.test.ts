import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

describe('matrix.query', () => {
  beforeEach(() => mockFetch.mockReset());

  it('GETs /api/v1/matrix/query with query string', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        query: 'q',
        answer: 'a',
        preset: 'copass/copass_1.0',
        execution_time_ms: 42,
      }),
    );
    const client = makeClient();
    const resp = await client.matrix.query({ query: 'q' });
    const call = lastFetchCall();
    expect(call.url).toContain('/api/v1/matrix/query');
    expect(call.url).toContain('query=q');
    expect(call.method).toBe('GET');
    expect(resp.answer).toBe('a');
  });

  it('sends X-Search-Matrix header for preset', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        query: 'q',
        answer: 'a',
        preset: 'copass/copass_2.0',
        execution_time_ms: 100,
      }),
    );
    const client = makeClient();
    await client.matrix.query({ query: 'q', preset: 'copass/copass_2.0' });
    const headers = lastFetchCall().headers;
    // Header keys may be lowercased by fetch
    const matrixHeader = headers['X-Search-Matrix'] || headers['x-search-matrix'];
    expect(matrixHeader).toBe('copass/copass_2.0');
  });
});
