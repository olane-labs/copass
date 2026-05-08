/**
 * copass/2.0 propagation tests for the @copass/mastra discover wrapper.
 *
 * Verifies the wrapper:
 *   1. Forwards the constructor's `preset` to client.retrieval.discover().
 *   2. Projects `subgraph` + `matched_query_nodes` from each item into
 *      the agent-facing response.
 */
import { describe, it, expect, vi } from 'vitest';
import { copassTools } from '../../src/tools.js';
import type { CopassClient } from '@copass/core';

function makeClientWithV2Response(): CopassClient {
  return {
    retrieval: {
      discover: vi.fn().mockResolvedValue({
        header: 'menu',
        items: [
          {
            id: 'cid-1',
            score: 0.89,
            summary: '',
            canonical_ids: ['cid-1', 'node-a'],
            subgraph: 'Tree ⭐',
            matched_query_nodes: ['A'],
          },
        ],
        count: 1,
        next_steps: '',
      }),
      interpret: vi.fn(),
      search: vi.fn(),
    },
  } as unknown as CopassClient;
}

const execCtx = { runtimeContext: {} as never } as never;

describe('mastra discover wrapper — copass/2.0 propagation', () => {
  it('forwards preset to underlying discover call', async () => {
    const client = makeClientWithV2Response();
    const tools = copassTools({ client, sandbox_id: 'sb-1', preset: 'copass/copass_2.0' });
    await tools.discover.execute!({ query: 'q' }, execCtx);
    expect(client.retrieval.discover).toHaveBeenCalledWith(
      'sb-1',
      expect.objectContaining({ preset: 'copass/copass_2.0' }),
    );
  });

  it('projects v2 subgraph + matched_query_nodes in returned items', async () => {
    const client = makeClientWithV2Response();
    const tools = copassTools({ client, sandbox_id: 'sb-1', preset: 'copass/copass_2.0' });
    const result = (await tools.discover.execute!({ query: 'q' }, execCtx)) as {
      items: Array<{ subgraph: string | null; matched_query_nodes: string[] | null }>;
    };
    expect(result.items[0].subgraph).toBe('Tree ⭐');
    expect(result.items[0].matched_query_nodes).toEqual(['A']);
  });
});
