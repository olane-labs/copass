/**
 * Wire-level mock tests for ``client.retrieval`` — discover / interpret
 * / search.
 *
 * Asserts the SDK posts to the right URL, sends the right body fields
 * (including the v2 preset families and `:thinking` suffix), and
 * unpacks the v2-only `subgraph` + `matched_query_nodes` fields when
 * `copass/copass_2.0` is selected.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

describe('retrieval.discover', () => {
  beforeEach(() => mockFetch.mockReset());

  it('POSTs to /discover with minimum body and resolves preset', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        header: 'menu',
        items: [],
        count: 0,
        sandbox_id: 'sb-1',
        query: 'q',
        next_steps: '',
      }),
    );
    const client = makeClient();
    const resp = await client.retrieval.discover('sb-1', { query: 'q' });
    const call = lastFetchCall();

    expect(call.url).toContain('/api/v1/query/sandboxes/sb-1/discover');
    expect(call.method).toBe('POST');
    expect(call.body).toMatchObject({ query: 'q' });
    expect((call.body as { history: unknown[] }).history).toEqual([]);
    expect(resp.sandbox_id).toBe('sb-1');
  });

  it('forwards preset (canonical name)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ header: '', items: [], count: 0, sandbox_id: 'sb-1', query: 'q', next_steps: '' }),
    );
    const client = makeClient();
    await client.retrieval.discover('sb-1', {
      query: 'q',
      preset: 'copass/copass_2.0',
      project_id: 'proj-1',
    });
    const call = lastFetchCall();
    expect((call.body as { preset: string }).preset).toBe('copass/copass_2.0');
    expect((call.body as { project_id: string }).project_id).toBe('proj-1');
  });

  it('unpacks v2 subgraph + matched_query_nodes from response items', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        header: '',
        items: [
          {
            id: 'cid-1',
            score: 0.89,
            summary: '',
            canonical_ids: ['cid-1', 'node-a'],
            subgraph: 'Stripe Integration\n├── webhook_retry_policy ⭐',
            matched_query_nodes: ['webhook_retry_policy'],
          },
        ],
        count: 1,
        sandbox_id: 'sb-1',
        query: 'q',
        next_steps: '',
      }),
    );
    const client = makeClient();
    const resp = await client.retrieval.discover('sb-1', {
      query: 'q',
      preset: 'copass/copass_2.0',
    });
    const item = resp.items[0];
    expect(item.subgraph).toContain('Stripe Integration');
    expect(item.subgraph).toContain('⭐');
    expect(item.matched_query_nodes).toEqual(['webhook_retry_policy']);
    expect(item.canonical_ids).toEqual(['cid-1', 'node-a']);
  });

  it('resolves window.getTurns() into history (window stripped from body)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ header: '', items: [], count: 0, sandbox_id: 'sb-1', query: 'q', next_steps: '' }),
    );
    const client = makeClient();
    const window = { getTurns: () => [{ role: 'user' as const, content: 'earlier' }] };
    await client.retrieval.discover('sb-1', { query: 'q', window });
    const body = lastFetchCall().body as Record<string, unknown>;
    expect(body.history).toEqual([{ role: 'user', content: 'earlier' }]);
    expect(body).not.toHaveProperty('window');
  });
});

describe('retrieval.interpret', () => {
  beforeEach(() => mockFetch.mockReset());

  it('POSTs items + preset', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        brief: 'answer',
        citations: [],
        items: [['cid-1']],
        sandbox_id: 'sb-1',
        query: 'q',
      }),
    );
    const client = makeClient();
    await client.retrieval.interpret('sb-1', {
      query: 'q',
      items: [['cid-1', 'cid-2']],
      preset: 'copass/copass_2.0',
      max_tokens: 500,
    });
    const body = lastFetchCall().body as Record<string, unknown>;
    expect(body.items).toEqual([['cid-1', 'cid-2']]);
    expect(body.preset).toBe('copass/copass_2.0');
    expect(body.max_tokens).toBe(500);
  });

  it('unpacks brief + citations', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        brief: 'Stripe webhooks retry 3x.',
        citations: [{ canonical_id: 'cid-1', name: 'Stripe', relevance: 0.9 }],
        items: [['cid-1']],
        sandbox_id: 'sb-1',
        query: 'q',
      }),
    );
    const client = makeClient();
    const resp = await client.retrieval.interpret('sb-1', {
      query: 'q',
      items: [['cid-1']],
    });
    expect(resp.brief).toContain('Stripe');
    expect(resp.citations[0].relevance).toBe(0.9);
  });
});

describe('retrieval.search', () => {
  beforeEach(() => mockFetch.mockReset());

  it('POSTs full body with preset + detail_level', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        answer: 'ok',
        preset: 'copass/copass_1.0',
        execution_time_ms: 100,
        sandbox_id: 'sb-1',
        query: 'q',
      }),
    );
    const client = makeClient();
    await client.retrieval.search('sb-1', {
      query: 'q',
      preset: 'copass/copass_1.0',
      detail_level: 'detailed',
      max_tokens: 1000,
    });
    const body = lastFetchCall().body as Record<string, unknown>;
    expect(body.preset).toBe('copass/copass_1.0');
    expect(body.detail_level).toBe('detailed');
    expect(body.max_tokens).toBe(1000);
  });

  it('forwards :thinking suffix verbatim (server applies decomposition)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        answer: 'ok',
        preset: 'copass/copass_2.0:thinking',
        execution_time_ms: 5000,
        sandbox_id: 'sb-1',
        query: 'complex',
      }),
    );
    const client = makeClient();
    await client.retrieval.search('sb-1', {
      query: 'complex',
      preset: 'copass/copass_2.0:thinking',
    });
    expect((lastFetchCall().body as { preset: string }).preset).toBe('copass/copass_2.0:thinking');
  });

  it('unpacks warnings array from response', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        answer: 'thin',
        preset: 'copass/copass_1.0',
        execution_time_ms: 200,
        warnings: ['no_context'],
        sandbox_id: 'sb-1',
        query: 'q',
      }),
    );
    const client = makeClient();
    const resp = await client.retrieval.search('sb-1', { query: 'q' });
    expect(resp.warnings).toEqual(['no_context']);
  });

  it('accepts short alias copass/2.0 (kept for backward-compat)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        answer: 'ok',
        preset: 'copass/2.0',
        execution_time_ms: 100,
        sandbox_id: 'sb-1',
        query: 'q',
      }),
    );
    const client = makeClient();
    await client.retrieval.search('sb-1', { query: 'q', preset: 'copass/2.0' });
    expect((lastFetchCall().body as { preset: string }).preset).toBe('copass/2.0');
  });
});
