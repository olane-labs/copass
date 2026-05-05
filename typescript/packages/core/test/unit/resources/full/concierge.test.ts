import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

describe('concierge.test', () => {
  beforeEach(() => mockFetch.mockReset());

  it('POSTs to /sandboxes/{sid}/concierge/test with the message', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        run_id: 'run-1',
        response: 'ok',
        tool_resolution_trace: [],
      }),
    );
    const client = makeClient();
    await client.concierge.test('sb-1', { message: 'hello' });
    const call = lastFetchCall();
    expect(call.url).toContain('/api/v1/storage/sandboxes/sb-1/concierge/test');
    expect(call.method).toBe('POST');
    expect((call.body as { message: string }).message).toBe('hello');
  });

  it('returns the trace from the response', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        run_id: 'run-1',
        response: 'ok',
        tool_resolution_trace: [{ tool: 'discover', source: 'copass_retrieval' }],
      }),
    );
    const client = makeClient();
    const resp = await client.concierge.test('sb-1', { message: 'q' });
    expect(resp.tool_resolution_trace).toHaveLength(1);
    expect(resp.tool_resolution_trace![0].tool).toBe('discover');
  });
});
