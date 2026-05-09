import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

const BASE = '/api/v1/storage/sandboxes/sb-1/compute';

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
    await client.compute.getSession('sb-1', 'sess-1');
    expect(lastFetchCall().url).toContain(`${BASE}/sessions/sess-1`);
    expect(lastFetchCall().method).toBe('GET');
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
