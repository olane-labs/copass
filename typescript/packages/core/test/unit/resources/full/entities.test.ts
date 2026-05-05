import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

describe('entities', () => {
  beforeEach(() => mockFetch.mockReset());

  it('search passes q + limit and unwraps the results envelope', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        results: [
          { canonical_id: 'c-1', name: 'Stripe', similarity: 0.91 },
          { canonical_id: 'c-2', name: 'Stripe Webhook', similarity: 0.88 },
        ],
        count: 2,
        query: 'stripe',
        record_type: 'entity',
        sandbox_id: 'sb-1',
      }),
    );
    const client = makeClient();
    const resp = await client.entities.search('sb-1', 'stripe', { limit: 5 });
    const call = lastFetchCall();
    expect(call.url).toContain('/sandboxes/sb-1/entities/search');
    expect(call.url).toContain('q=stripe');
    expect(call.url).toContain('limit=5');
    expect(resp).toHaveLength(2);
    expect(resp[0].canonical_id).toBe('c-1');
    expect(resp[0].similarity).toBe(0.91);
  });
});
