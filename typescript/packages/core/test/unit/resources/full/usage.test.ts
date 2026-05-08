import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

describe('usage', () => {
  beforeEach(() => mockFetch.mockReset());

  it('getSummary GETs /api/v1/usage', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        summary: {
          total_prompt_tokens: 10000,
          total_completion_tokens: 2345,
          total_tokens: 12345,
          total_cost_usd: 1.23,
          total_calls: 7,
        },
        by_model: [],
        by_call_type: [],
      }),
    );
    const client = makeClient();
    const resp = await client.usage.getSummary();
    expect(lastFetchCall().url).toContain('/api/v1/usage');
    expect(resp.summary.total_tokens).toBe(12345);
    expect(resp.summary.total_cost_usd).toBe(1.23);
  });

  it('getBalance GETs /api/v1/usage/balance', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        credits_purchased: 1_000_000,
        credits_used: 500_000,
        credits_remaining: 500_000,
        currency: 'USD_microcents',
      }),
    );
    const client = makeClient();
    const resp = await client.usage.getBalance();
    expect(lastFetchCall().url).toContain('/api/v1/usage/balance');
    expect(resp.credits_remaining).toBe(500_000);
    expect(resp.currency).toBe('USD_microcents');
  });
});
