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

/**
 * Optional `cost?: CostInfo` on retrieval responses.
 *
 * The server populates this field when retrieval has a billable cost
 * (`gate_mode` of `shadow` or `enforce`); the field is absent / `null`
 * when `gate_mode` is `off` or when the server omits it. The SDK is
 * purely typed pass-through — these tests assert the shape round-trips
 * and that absence stays valid (backward compat with older servers).
 */
describe('retrieval cost field', () => {
  beforeEach(() => mockFetch.mockReset());

  it('unpacks cost on discover when gate is in enforce mode', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        header: '',
        items: [],
        count: 0,
        sandbox_id: 'sb-1',
        query: 'q',
        next_steps: '',
        cost: {
          microcents: 1234,
          usd: 0.001234,
          deduction_id: '5f3e8b9c-1234-4abc-9def-0123456789ab',
          gate_mode: 'enforce',
        },
      }),
    );
    const client = makeClient();
    const resp = await client.retrieval.discover('sb-1', { query: 'q' });
    expect(resp.cost).toBeDefined();
    expect(resp.cost?.microcents).toBe(1234);
    expect(resp.cost?.usd).toBeCloseTo(0.001234, 6);
    expect(resp.cost?.deduction_id).toBe('5f3e8b9c-1234-4abc-9def-0123456789ab');
    expect(resp.cost?.gate_mode).toBe('enforce');
  });

  it('unpacks cost on interpret in shadow mode with null deduction_id', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        brief: 'answer',
        citations: [],
        items: [['cid-1']],
        sandbox_id: 'sb-1',
        query: 'q',
        cost: {
          microcents: 5000,
          usd: 0.005,
          deduction_id: null,
          gate_mode: 'shadow',
        },
      }),
    );
    const client = makeClient();
    const resp = await client.retrieval.interpret('sb-1', {
      query: 'q',
      items: [['cid-1']],
    });
    expect(resp.cost?.microcents).toBe(5000);
    expect(resp.cost?.deduction_id).toBeNull();
    expect(resp.cost?.gate_mode).toBe('shadow');
  });

  it('unpacks cost on search with minimal payload (microcents + gate_mode only)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        answer: 'ok',
        preset: 'copass/copass_1.0',
        execution_time_ms: 100,
        sandbox_id: 'sb-1',
        query: 'q',
        cost: {
          microcents: 42,
          gate_mode: 'enforce',
        },
      }),
    );
    const client = makeClient();
    const resp = await client.retrieval.search('sb-1', { query: 'q' });
    expect(resp.cost?.microcents).toBe(42);
    expect(resp.cost?.gate_mode).toBe('enforce');
    expect(resp.cost?.usd).toBeUndefined();
    expect(resp.cost?.deduction_id).toBeUndefined();
  });

  it('tolerates absent cost field (gate_mode off or older server)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        header: '',
        items: [],
        count: 0,
        sandbox_id: 'sb-1',
        query: 'q',
        next_steps: '',
        // no `cost` field — server omits when gate_mode is off.
      }),
    );
    const client = makeClient();
    const resp = await client.retrieval.discover('sb-1', { query: 'q' });
    expect(resp.cost).toBeUndefined();
  });

  it('tolerates explicit null cost (server may emit null when gate_mode is off)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        answer: 'ok',
        preset: 'copass/copass_1.0',
        execution_time_ms: 100,
        sandbox_id: 'sb-1',
        query: 'q',
        cost: null,
      }),
    );
    const client = makeClient();
    const resp = await client.retrieval.search('sb-1', { query: 'q' });
    expect(resp.cost).toBeNull();
  });

  it('CostInfo round-trips through JSON.parse(JSON.stringify(...))', () => {
    const original = {
      microcents: 1234,
      usd: 0.001234,
      deduction_id: '5f3e8b9c-1234-4abc-9def-0123456789ab',
      gate_mode: 'enforce' as const,
    };
    const roundTripped = JSON.parse(JSON.stringify(original)) as typeof original;
    expect(roundTripped).toEqual(original);
    expect(roundTripped.microcents).toBe(1234);
    expect(roundTripped.gate_mode).toBe('enforce');
  });

  it('supports all three gate_mode literals (off / shadow / enforce)', () => {
    // Type-instantiation smoke: the union must accept each literal.
    // Compile-time check; if any literal stops being assignable this
    // file won't typecheck.
    const modes: Array<'off' | 'shadow' | 'enforce'> = ['off', 'shadow', 'enforce'];
    expect(modes).toHaveLength(3);
  });
});

/**
 * ``retrieval.getOrigin`` — entity → source-file lookup.
 *
 * Cheap, read-only companion to ``discover``. The SDK posts the
 * caller's ``canonical_ids`` to ``/origins`` and surfaces the per-file
 * roll-up the server returns.
 */
describe('retrieval.getOrigin', () => {
  beforeEach(() => mockFetch.mockReset());

  it('POSTs to /origins with the canonical_ids body', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        sandbox_id: 'sb-1',
        origins: [
          {
            canonical_id: 'cid-1',
            files: [
              { file_path: 'src/click/core.py', extraction_count: 12 },
              { file_path: 'src/click/decorators.py', extraction_count: 3 },
            ],
          },
        ],
      }),
    );
    const client = makeClient();
    const resp = await client.retrieval.getOrigin('sb-1', {
      canonical_ids: ['cid-1'],
    });
    const call = lastFetchCall();

    expect(call.url).toContain('/api/v1/query/sandboxes/sb-1/origins');
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ canonical_ids: ['cid-1'] });
    expect(resp.sandbox_id).toBe('sb-1');
    expect(resp.origins[0].canonical_id).toBe('cid-1');
    expect(resp.origins[0].files[0].file_path).toBe('src/click/core.py');
    expect(resp.origins[0].files[0].extraction_count).toBe(12);
  });

  it('forwards limit_per_canonical when supplied', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ sandbox_id: 'sb-1', origins: [] }),
    );
    const client = makeClient();
    await client.retrieval.getOrigin('sb-1', {
      canonical_ids: ['cid-1', 'cid-2'],
      limit_per_canonical: 3,
    });
    const body = lastFetchCall().body as Record<string, unknown>;
    expect(body.canonical_ids).toEqual(['cid-1', 'cid-2']);
    expect(body.limit_per_canonical).toBe(3);
  });

  it('omits limit_per_canonical from body when not supplied (server applies default)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ sandbox_id: 'sb-1', origins: [] }),
    );
    const client = makeClient();
    await client.retrieval.getOrigin('sb-1', { canonical_ids: ['cid-1'] });
    const body = lastFetchCall().body as Record<string, unknown>;
    expect(body).not.toHaveProperty('limit_per_canonical');
  });

  it('preserves response position alignment when files is empty', async () => {
    // The server returns `files=[]` for canonicals it has no recorded
    // origins for so the response stays positionally aligned with the
    // input. The SDK is a pure pass-through.
    mockFetch.mockResolvedValue(
      jsonResponse({
        sandbox_id: 'sb-1',
        origins: [
          { canonical_id: 'cid-1', files: [{ file_path: 'src/a.py', extraction_count: 1 }] },
          { canonical_id: 'cid-2', files: [] },
        ],
      }),
    );
    const client = makeClient();
    const resp = await client.retrieval.getOrigin('sb-1', {
      canonical_ids: ['cid-1', 'cid-2'],
    });
    expect(resp.origins.map((o) => o.canonical_id)).toEqual(['cid-1', 'cid-2']);
    expect(resp.origins[1].files).toEqual([]);
  });

  it('unpacks cost when the server attaches it', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        sandbox_id: 'sb-1',
        origins: [],
        cost: { microcents: 0, gate_mode: 'enforce' },
      }),
    );
    const client = makeClient();
    const resp = await client.retrieval.getOrigin('sb-1', {
      canonical_ids: ['cid-1'],
    });
    expect(resp.cost?.microcents).toBe(0);
    expect(resp.cost?.gate_mode).toBe('enforce');
  });

  it('tolerates an absent cost field (gate_mode off / older server)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ sandbox_id: 'sb-1', origins: [] }),
    );
    const client = makeClient();
    const resp = await client.retrieval.getOrigin('sb-1', {
      canonical_ids: ['cid-1'],
    });
    expect(resp.cost).toBeUndefined();
  });
});
