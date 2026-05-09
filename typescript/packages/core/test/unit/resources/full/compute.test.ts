import { describe, it, expect, beforeEach } from 'vitest';
import { ComputeSession } from '../../../../src/resources/compute-session.js';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

const BASE = '/api/v1/storage/sandboxes/sb-1/compute';

const GATEWAY = {
  base_url: 'https://compute.staging.copass.io',
  url_template: '{base_url}/compute/{session_id}/p/{port}{path}',
  kind: 'edge-proxy-v1' as const,
};

function sessionRecord(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'sess-1',
    template: 'copass-hermes-py311',
    status: 'running',
    provisioned_at: '2026-05-08T00:00:00Z',
    deadline_at: '2026-05-08T00:10:00Z',
    last_activity_at: '2026-05-08T00:00:30Z',
    metadata: {},
    gateway: GATEWAY,
    ...overrides,
  };
}

describe('compute', () => {
  beforeEach(() => mockFetch.mockReset());

  it('listTemplates GETs /compute/templates', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        templates: [
          {
            name: 'copass-hermes-py311',
            provider: 'daytona',
            cpu_count: 2,
            memory_mb: 4096,
            description: 'Hermes runtime',
          },
        ],
      }),
    );
    const client = makeClient();
    const resp = await client.compute.listTemplates('sb-1');
    const call = lastFetchCall();
    expect(call.url).toContain(`${BASE}/templates`);
    expect(call.method).toBe('GET');
    expect(resp.templates[0].name).toBe('copass-hermes-py311');
    expect(resp.templates[0].provider).toBe('daytona');
  });

  it('listTemplates forwards provider filter as query param', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ templates: [] }));
    const client = makeClient();
    await client.compute.listTemplates('sb-1', { provider: 'e2b' });
    expect(lastFetchCall().url).toContain('provider=e2b');
  });

  it('createSession POSTs body to /compute/sessions', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        session_id: 'sess-1',
        template: 'copass-hermes-py311',
        status: 'provisioning',
        provisioned_at: '2026-05-08T00:00:00Z',
        deadline_at: '2026-05-08T00:10:00Z',
        last_activity_at: '2026-05-08T00:00:00Z',
        metadata: {},
      }),
    );
    const client = makeClient();
    const resp = await client.compute.createSession('sb-1', {
      template: 'copass-hermes-py311',
      timeout_seconds: 600,
      env_vars: { FOO: 'bar' },
      metadata: { tag: 'demo' },
    });
    const call = lastFetchCall();
    expect(call.url).toContain(`${BASE}/sessions`);
    expect(call.method).toBe('POST');
    const body = call.body as {
      template: string;
      timeout_seconds: number;
      env_vars: Record<string, string>;
      metadata: Record<string, string>;
    };
    expect(body.template).toBe('copass-hermes-py311');
    expect(body.timeout_seconds).toBe(600);
    expect(body.env_vars.FOO).toBe('bar');
    expect(body.metadata.tag).toBe('demo');
    expect(resp.session_id).toBe('sess-1');
    // ADR 0026 Phase 2 — createSession returns a ComputeSession instance.
    expect(resp).toBeInstanceOf(ComputeSession);
    // Server contract — external_session_id must NOT appear on the wire.
    expect(resp).not.toHaveProperty('external_session_id');
  });

  it('listSessions GETs /compute/sessions with filters', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ sessions: [] }));
    const client = makeClient();
    await client.compute.listSessions('sb-1', {
      include_stopped: true,
      limit: 50,
    });
    const call = lastFetchCall();
    expect(call.url).toContain(`${BASE}/sessions`);
    expect(call.url).toContain('include_stopped=true');
    expect(call.url).toContain('limit=50');
  });

  it('listSessions omits include_stopped when false', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ sessions: [] }));
    const client = makeClient();
    await client.compute.listSessions('sb-1');
    expect(lastFetchCall().url).not.toContain('include_stopped');
  });

  it('getSession GETs /compute/sessions/{session_id}', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        session_id: 'sess-1',
        template: 'copass-hermes-py311',
        status: 'running',
        provisioned_at: '2026-05-08T00:00:00Z',
        deadline_at: '2026-05-08T00:10:00Z',
        last_activity_at: '2026-05-08T00:00:30Z',
        metadata: {},
      }),
    );
    const client = makeClient();
    const resp = await client.compute.getSession('sb-1', 'sess-1');
    expect(lastFetchCall().url).toContain(`${BASE}/sessions/sess-1`);
    expect(lastFetchCall().method).toBe('GET');
    // ADR 0026 Phase 2 — getSession returns a ComputeSession instance.
    expect(resp).toBeInstanceOf(ComputeSession);
  });

  it('listSessions wraps each item as a ComputeSession instance', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        sessions: [
          sessionRecord({ session_id: 'sess-1' }),
          sessionRecord({ session_id: 'sess-2' }),
        ],
      }),
    );
    const client = makeClient();
    const resp = await client.compute.listSessions('sb-1');
    expect(resp.sessions).toHaveLength(2);
    expect(resp.sessions[0]).toBeInstanceOf(ComputeSession);
    expect(resp.sessions[1]).toBeInstanceOf(ComputeSession);
    expect(resp.sessions[0].session_id).toBe('sess-1');
    expect(resp.sessions[1].session_id).toBe('sess-2');
  });

  // --- ADR 0026 Phase 2 gateway surface --------------------------------

  function makeSessionFromCreate() {
    mockFetch.mockResolvedValueOnce(jsonResponse(sessionRecord()));
    return makeClient().compute.createSession('sb-1', {
      template: 'copass-hermes-py311',
    });
  }

  it('proxyUrl(port, "/api") substitutes the template', async () => {
    const session = await makeSessionFromCreate();
    expect(session.proxyUrl(3000, '/api')).toBe(
      'https://compute.staging.copass.io/compute/sess-1/p/3000/api',
    );
  });

  it('proxyUrl(port, "") yields the bare per-port URL with no trailing slash', async () => {
    const session = await makeSessionFromCreate();
    expect(session.proxyUrl(3000, '')).toBe(
      'https://compute.staging.copass.io/compute/sess-1/p/3000',
    );
    // Default `path` argument behaves the same as explicit "".
    expect(session.proxyUrl(3000)).toBe(
      'https://compute.staging.copass.io/compute/sess-1/p/3000',
    );
  });

  it('websocketUrl(port) rewrites https:// to wss://', async () => {
    const session = await makeSessionFromCreate();
    expect(session.websocketUrl(3000)).toBe(
      'wss://compute.staging.copass.io/compute/sess-1/p/3000',
    );
    expect(session.websocketUrl(3000, '/ws')).toBe(
      'wss://compute.staging.copass.io/compute/sess-1/p/3000/ws',
    );
  });

  it('websocketUrl rewrites http:// to ws://', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(
        sessionRecord({
          gateway: {
            base_url: 'http://localhost:8080',
            url_template: '{base_url}/compute/{session_id}/p/{port}{path}',
            kind: 'edge-proxy-v1',
          },
        }),
      ),
    );
    const session = await makeClient().compute.createSession('sb-1', {
      template: 't',
    });
    expect(session.websocketUrl(3000, '/ws')).toBe(
      'ws://localhost:8080/compute/sess-1/p/3000/ws',
    );
  });

  it('proxyUrl / websocketUrl / fetch throw the locked Error when gateway is absent', async () => {
    mockFetch.mockResolvedValue(jsonResponse(sessionRecord({ gateway: undefined })));
    const session = await makeClient().compute.createSession('sb-1', {
      template: 't',
    });
    const expectedMessage = /Gateway is not configured on this Copass deployment\./;
    expect(() => session.proxyUrl(3000, '/x')).toThrow(expectedMessage);
    expect(() => session.websocketUrl(3000)).toThrow(expectedMessage);
    await expect(session.fetch(3000, '/x')).rejects.toThrow(expectedMessage);
  });

  it('fetch hits globalThis.fetch with the gateway URL, bearer header, and forwards init', async () => {
    // First fetch: the createSession round-trip.
    mockFetch.mockResolvedValueOnce(jsonResponse(sessionRecord()));
    const session = await makeClient().compute.createSession('sb-1', {
      template: 't',
    });
    const callsBefore = mockFetch.mock.calls.length;

    // Second fetch: the gateway passthrough.
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const resp = await session.fetch(3000, '/foo', {
      method: 'POST',
      body: JSON.stringify({ x: 1 }),
      headers: { 'X-Custom': 'yes' },
    });

    expect(mockFetch.mock.calls.length).toBe(callsBefore + 1);
    const call = lastFetchCall();
    expect(call.url).toBe(
      'https://compute.staging.copass.io/compute/sess-1/p/3000/foo',
    );
    expect(call.method).toBe('POST');
    // Bearer header pulled from the same auth source the SDK uses
    // elsewhere (api-key auth in `makeClient` resolves to `olk_test`).
    expect(call.headers['authorization']).toBe('Bearer olk_test');
    // Caller-supplied headers are forwarded through `init`.
    expect(call.headers['x-custom']).toBe('yes');
    expect(resp.status).toBe(200);
    await expect(resp.text()).resolves.toBe('ok');
  });

  it('fetch pulls a fresh bearer token per call', async () => {
    let getSessionCalls = 0;
    // Monkey-patch the auth provider underneath the client so we can
    // count how often the bearer is resolved. Two `session.fetch`
    // calls => two auth-provider hits.
    mockFetch.mockResolvedValueOnce(jsonResponse(sessionRecord()));
    const client = makeClient();
    const session = await client.compute.createSession('sb-1', { template: 't' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const http = (client.compute as any).http;
    const original = http.getAuthSession.bind(http);
    http.getAuthSession = () => {
      getSessionCalls += 1;
      return original();
    };
    mockFetch.mockResolvedValueOnce(new Response('a'));
    mockFetch.mockResolvedValueOnce(new Response('b'));
    await session.fetch(3000, '/a');
    await session.fetch(3000, '/b');
    expect(getSessionCalls).toBe(2);
  });

  it('stopSession DELETEs /compute/sessions/{session_id}', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ session_id: 'sess-1', status: 'stopped' }),
    );
    const client = makeClient();
    const resp = await client.compute.stopSession('sb-1', 'sess-1');
    expect(lastFetchCall().url).toContain(`${BASE}/sessions/sess-1`);
    expect(lastFetchCall().method).toBe('DELETE');
    expect(resp.status).toBe('stopped');
  });

  it('exec POSTs to /compute/sessions/{session_id}/exec', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        stdout: 'hello\n',
        stderr: '',
        exit_code: 0,
        elapsed_ms: 42,
        truncated: false,
      }),
    );
    const client = makeClient();
    const resp = await client.compute.exec('sb-1', 'sess-1', {
      cmd: ['python', '-c', 'print("hello")'],
      timeout_seconds: 30,
    });
    const call = lastFetchCall();
    expect(call.url).toContain(`${BASE}/sessions/sess-1/exec`);
    expect(call.method).toBe('POST');
    const body = call.body as { cmd: string[]; timeout_seconds: number };
    expect(body.cmd).toEqual(['python', '-c', 'print("hello")']);
    expect(body.timeout_seconds).toBe(30);
    expect(resp.stdout).toBe('hello\n');
    expect(resp.exit_code).toBe(0);
  });

  it('exec preserves a non-zero exit_code as a value (not a throw)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        stdout: '',
        stderr: 'oops',
        exit_code: 1,
        elapsed_ms: 5,
        truncated: false,
      }),
    );
    const client = makeClient();
    const resp = await client.compute.exec('sb-1', 'sess-1', {
      cmd: ['false'],
    });
    // 200 with non-zero exit_code — user's command failing is NOT a 5xx.
    expect(resp.exit_code).toBe(1);
    expect(resp.stderr).toBe('oops');
  });

  it('sessionHealth GETs /compute/sessions/{session_id}/health', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        session_id: 'sess-1',
        status: 'ready',
        last_activity_at: '2026-05-08T00:00:30Z',
      }),
    );
    const client = makeClient();
    const resp = await client.compute.sessionHealth('sb-1', 'sess-1');
    expect(lastFetchCall().url).toContain(`${BASE}/sessions/sess-1/health`);
    expect(lastFetchCall().method).toBe('GET');
    expect(resp.status).toBe('ready');
  });
});
