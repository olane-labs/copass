import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

describe('entities', () => {
  beforeEach(() => mockFetch.mockReset());

  it('list unwraps {canonical_entities: [...]} envelope', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        canonical_entities: [{ canonical_id: 'c-1' }, { canonical_id: 'c-2' }],
      }),
    );
    const client = makeClient();
    const resp = await client.entities.list();
    expect(resp).toHaveLength(2);
    expect(lastFetchCall().url).toContain('/api/v1/users/me/canonical-entities');
  });

  it('getPerspective hits the perspective subpath', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ canonical_id: 'cid', tree: { nodes: [] } }));
    const client = makeClient();
    const resp = await client.entities.getPerspective('cid');
    expect(lastFetchCall().url).toContain('/canonical-entities/cid/perspective');
    expect(resp.canonical_id).toBe('cid');
  });

  it('search passes q as positional and limit as option', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ results: [] }));
    const client = makeClient();
    await client.entities.search('sb-1', 'stripe', { limit: 5 });
    const call = lastFetchCall();
    expect(call.url).toContain('/sandboxes/sb-1/entities/search');
    expect(call.url).toContain('q=stripe');
    expect(call.url).toContain('limit=5');
  });
});
