import { describe, it, expect, vi } from 'vitest';
import type { HttpClient } from '../src/http/http-client.js';
import { SourcesResource } from '../src/resources/sources.js';

describe('SourcesResource.purge', () => {
  it('POSTs to /sources/{id}/purge with optional delete_source', async () => {
    const request = vi.fn().mockResolvedValue({
      success: true,
      delete_source_applied: true,
      events_deleted: 1,
      extractions_deleted: 1,
      canonical_index_rows_deleted: 0,
      entity_vectors_deleted: 2,
      triggers_deleted: 0,
      webhooks_deleted: 0,
      event_seen_deleted: 0,
      project_links_deleted: 0,
      strategy_artifacts_deleted: 0,
      pull_artifacts_deleted: 0,
      user_strategies_deleted: 0,
      vault_objects_deleted: 0,
    });
    const http = { request } as unknown as HttpClient;
    const sources = new SourcesResource(http);

    await sources.purge('sb-1', 'ds-1', { delete_source: true });

    expect(request).toHaveBeenCalledWith(
      '/api/v1/storage/sandboxes/sb-1/sources/ds-1/purge',
      expect.objectContaining({
        method: 'POST',
        body: { delete_source: true },
      }),
    );
  });
});
