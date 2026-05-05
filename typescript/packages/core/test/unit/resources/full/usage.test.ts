import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

describe('usage', () => {
  beforeEach(() => mockFetch.mockReset());

  it('getSummary GETs /api/v1/usage', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ period: '2026-05', tokens_used: 12345, credits_consumed: 1.23 }),
    );
    const client = makeClient();
    const resp = await client.usage.getSummary();
    expect(lastFetchCall().url).toContain('/api/v1/usage');
    expect(resp.tokens_used).toBe(12345);
  });

  it('getBalance GETs /api/v1/usage/credits', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ balance_credits: 100.5, low_balance: false }),
    );
    const client = makeClient();
    const resp = await client.usage.getBalance();
    expect(lastFetchCall().url).toContain('/api/v1/usage/credits');
    expect(resp.balance_credits).toBe(100.5);
  });
});
