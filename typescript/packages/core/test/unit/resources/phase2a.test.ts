import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopassClient } from '../../../src/client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function lastFetchCall(): FetchCall {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  const init = call[1] as RequestInit;
  let body: unknown = undefined;
  if (typeof init.body === 'string' && init.body.length > 0) {
    body = JSON.parse(init.body);
  }
  return { url: String(call[0]), method: String(init.method ?? 'GET'), body };
}

function makeClient(): CopassClient {
  return new CopassClient({
    apiUrl: 'http://test',
    auth: { type: 'api-key', key: 'olk_test' },
  });
}

describe('agents.updateToolSources (Phase 2A)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('PATCHes /agents/{slug}/tool-sources with an explicit list', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        agent_id: 'ag-1',
        slug: 'demo',
        version: 5,
      }),
    );
    const client = makeClient();
    await client.agents.updateToolSources('sb-1', 'demo', [
      'copass_retrieval',
      'pipedream',
    ]);

    const last = lastFetchCall();
    expect(last.method).toBe('PATCH');
    expect(last.url).toBe(
      'http://test/api/v1/storage/sandboxes/sb-1/agents/demo/tool-sources',
    );
    expect(last.body).toEqual({
      tool_sources: ['copass_retrieval', 'pipedream'],
    });
  });

  it('serializes null as JSON null (revert-to-default sentinel)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ agent_id: 'ag-1', slug: 'demo', version: 6 }),
    );
    const client = makeClient();
    await client.agents.updateToolSources('sb-1', 'demo', null);
    expect(lastFetchCall().body).toEqual({ tool_sources: null });
  });

  it('serializes [] (tool-less by choice) verbatim', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ agent_id: 'ag-1', slug: 'demo', version: 7 }),
    );
    const client = makeClient();
    await client.agents.updateToolSources('sb-1', 'demo', []);
    expect(lastFetchCall().body).toEqual({ tool_sources: [] });
  });
});

describe('agents.wireIntegration (Phase 2A)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('POSTs to /agents/{slug}/wire-integration and returns the typed envelope', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        wired: true,
        agent_slug: 'demo',
        app_slug: 'slack',
        sources_added: ['pipedream'],
        tool_count: 12,
        mode: 'explicit',
        message: 'Slack is now wired to demo — 12 tools available.',
      }),
    );
    const client = makeClient();
    const result = await client.agents.wireIntegration('sb-1', 'demo', 'slack');

    const last = lastFetchCall();
    expect(last.method).toBe('POST');
    expect(last.url).toBe(
      'http://test/api/v1/storage/sandboxes/sb-1/agents/demo/wire-integration',
    );
    expect(last.body).toEqual({ app_slug: 'slack' });
    expect(result.wired).toBe(true);
    expect(result.mode).toBe('explicit');
    expect(result.tool_count).toBe(12);
    expect(result.sources_added).toEqual(['pipedream']);
  });

  it('passes through the not_connected branch unmodified', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        wired: false,
        agent_slug: 'demo',
        app_slug: 'gmail',
        sources_added: [],
        tool_count: 0,
        mode: 'not_connected',
        message: 'Gmail is not connected.',
      }),
    );
    const client = makeClient();
    const result = await client.agents.wireIntegration('sb-1', 'demo', 'gmail');
    expect(result.wired).toBe(false);
    expect(result.mode).toBe('not_connected');
    expect(result.tool_count).toBe(0);
  });
});
