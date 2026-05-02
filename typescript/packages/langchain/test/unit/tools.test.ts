import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copassTools } from '../../src/tools.js';
import type { CopassClient, WindowLike } from '@copass/core';

function makeClient(overrides: Record<string, unknown> = {}): CopassClient {
  return {
    retrieval: {
      discover: vi.fn().mockResolvedValue({
        header: 'stub header',
        items: [
          { id: 'a', score: 0.9, summary: 'Checkout ▸ Stripe', canonical_ids: ['c1', 'c2'] },
          { id: 'b', score: 0.7, summary: 'Webhooks', canonical_ids: ['c3'] },
        ],
        count: 2,
        sandbox_id: 'sb1',
        query: 'checkout',
        next_steps: 'Pick items and call interpret',
      }),
      interpret: vi.fn().mockResolvedValue({
        brief: 'Checkout retries on 5xx from Stripe.',
        citations: [],
        items: [['c1', 'c2']],
        sandbox_id: 'sb1',
        query: 'why is checkout flaky?',
      }),
      search: vi.fn().mockResolvedValue({
        answer: 'Auth refresh is driven by a background interceptor.',
        preset: 'copass/1.0',
        execution_time_ms: 123,
        sandbox_id: 'sb1',
        query: 'how does auth handle refresh?',
      }),
      ...(overrides.retrieval ?? {}),
    },
  } as unknown as CopassClient;
}

describe('copassTools (LangChain)', () => {
  let client: CopassClient;

  beforeEach(() => {
    client = makeClient();
  });

  it('exposes discover / interpret / search as LangChain StructuredTools', () => {
    const tools = copassTools({ client, sandbox_id: 'sb1' });

    for (const name of ['discover', 'interpret', 'search'] as const) {
      expect(tools[name]).toBeDefined();
      expect(tools[name].name).toBe(name);
      expect(typeof tools[name].description).toBe('string');
      expect(typeof tools[name].invoke).toBe('function');
    }
  });

  describe('discover', () => {
    it('forwards query + sandbox_id, returns trimmed response', async () => {
      const tools = copassTools({ client, sandbox_id: 'sb1' });

      const result = await tools.discover.invoke({ query: 'checkout' });

      expect(client.retrieval.discover).toHaveBeenCalledWith(
        'sb1',
        expect.objectContaining({ query: 'checkout' }),
      );
      // LangChain tool() JSON-stringifies object returns for ToolMessage content.
      const parsed = typeof result === 'string' ? JSON.parse(result) : result;
      expect(parsed).toEqual({
        header: 'stub header',
        items: [
          { score: 0.9, summary: 'Checkout ▸ Stripe', canonical_ids: ['c1', 'c2'] },
          { score: 0.7, summary: 'Webhooks', canonical_ids: ['c3'] },
        ],
        next_steps: 'Pick items and call interpret',
      });
    });

    it('forwards project_id and window when configured', async () => {
      const window: WindowLike = { getTurns: () => [{ role: 'user', content: 'hi' }] };
      const tools = copassTools({
        client,
        sandbox_id: 'sb1',
        project_id: 'proj_42',
        window,
      });

      await tools.discover.invoke({ query: 'x' });

      expect(client.retrieval.discover).toHaveBeenCalledWith(
        'sb1',
        expect.objectContaining({ project_id: 'proj_42', window }),
      );
    });
  });

  describe('interpret', () => {
    it('forwards items + preset, returns brief only', async () => {
      const tools = copassTools({ client, sandbox_id: 'sb1', preset: 'copass/1.0' });

      const result = await tools.interpret.invoke({
        query: 'why is checkout flaky?',
        items: [['c1', 'c2']],
      });

      expect(client.retrieval.interpret).toHaveBeenCalledWith(
        'sb1',
        expect.objectContaining({
          query: 'why is checkout flaky?',
          items: [['c1', 'c2']],
          preset: 'copass/1.0',
        }),
      );
      const parsed = typeof result === 'string' ? JSON.parse(result) : result;
      expect(parsed).toEqual({ brief: 'Checkout retries on 5xx from Stripe.' });
    });

    it('defaults preset to "copass/1.0" when not provided', async () => {
      const tools = copassTools({ client, sandbox_id: 'sb1' });

      await tools.interpret.invoke({ query: 'q', items: [['c1']] });

      expect(client.retrieval.interpret).toHaveBeenCalledWith(
        'sb1',
        expect.objectContaining({ preset: 'copass/1.0' }),
      );
    });
  });

  describe('search', () => {
    it('forwards preset + window, returns only the synthesized answer', async () => {
      const window: WindowLike = { getTurns: () => [] };
      const tools = copassTools({ client, sandbox_id: 'sb1', window, preset: 'copass/1.0' });

      const result = await tools.search.invoke({ query: 'how does auth handle refresh?' });

      expect(client.retrieval.search).toHaveBeenCalledWith(
        'sb1',
        expect.objectContaining({
          query: 'how does auth handle refresh?',
          preset: 'copass/1.0',
          window,
        }),
      );
      const parsed = typeof result === 'string' ? JSON.parse(result) : result;
      expect(parsed).toEqual({
        answer: 'Auth refresh is driven by a background interceptor.',
      });
    });
  });
});
