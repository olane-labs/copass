import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

describe('concierge.test', () => {
  beforeEach(() => mockFetch.mockReset());

  it('POSTs to /sandboxes/{sid}/concierge/test with the message', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        run_id: 'run-1',
        status: 'succeeded',
        output_text: 'ok',
        tools_called: [],
        tokens_in: 12,
        tokens_out: 4,
        duration_ms: 250,
        error_message: null,
      }),
    );
    const client = makeClient();
    const resp = await client.concierge.test('sb-1', { message: 'hello' });
    const call = lastFetchCall();
    expect(call.url).toContain('/api/v1/storage/sandboxes/sb-1/concierge/test');
    expect(call.method).toBe('POST');
    expect((call.body as { message: string }).message).toBe('hello');
    expect(resp.run_id).toBe('run-1');
    expect(resp.status).toBe('succeeded');
    expect(resp.output_text).toBe('ok');
    expect(resp.tools_called).toEqual([]);
  });

  it('parses status + tokens + duration from the response', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        run_id: 'run-2',
        status: 'failed',
        output_text: '',
        tools_called: [],
        tokens_in: 0,
        tokens_out: 0,
        duration_ms: 5,
        error_message: 'rate limited',
      }),
    );
    const client = makeClient();
    const resp = await client.concierge.test('sb-1', { message: 'q' });
    expect(resp.status).toBe('failed');
    expect(resp.error_message).toBe('rate limited');
  });
});
