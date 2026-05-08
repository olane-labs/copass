import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopassClient } from '../../src/client.js';

/**
 * Round-trip wire-shape tests for the ingest envelope (ADR 0022).
 *
 * Asserts that the new optional fields (`speaker`, `participants`)
 * land on the POST body verbatim, that legacy callers without those
 * fields still send a clean payload, and that `source_type` accepts
 * both content-shape and artifact-kind tokens.
 */

// Mock fetch globally — same pattern as test/unit/auth/supabase.test.ts.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function ingestResponse(): Response {
  return new Response(
    JSON.stringify({
      job_id: 'test-job',
      status: 'queued',
      encrypted: false,
      sandbox_id: 'sandbox-test',
      status_url: '/jobs/test-job',
    }),
    { status: 202, headers: { 'Content-Type': 'application/json' } },
  );
}

function lastRequestBody(): Record<string, unknown> {
  const init = mockFetch.mock.calls.at(-1)?.[1] as RequestInit | undefined;
  expect(init?.body, 'fetch body must be set').toBeDefined();
  return JSON.parse(init!.body as string);
}

describe('IngestResource — envelope wire shape (ADR 0022)', () => {
  let client: CopassClient;

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(ingestResponse());
    client = new CopassClient({
      auth: { type: 'api-key', key: 'olk_test' },
      apiUrl: 'https://test.example.com',
    });
  });

  it('forwards speaker on the wire body', async () => {
    await client.ingest.text({
      text: 'I just ran 5km in the Spring Run.',
      source_type: 'conversation',
      speaker: 'User',
    });

    const body = lastRequestBody();
    expect(body.text).toBe('I just ran 5km in the Spring Run.');
    expect(body.source_type).toBe('conversation');
    expect(body.speaker).toBe('User');
    expect(body.participants).toBeUndefined();
  });

  it('forwards participants on the wire body', async () => {
    await client.ingest.text({
      text: 'Hey Alice, did you finish the report?',
      source_type: 'conversation',
      speaker: 'Bob',
      participants: ['Alice', 'Bob'],
    });

    const body = lastRequestBody();
    expect(body.speaker).toBe('Bob');
    expect(body.participants).toEqual(['Alice', 'Bob']);
  });

  it('omits speaker / participants when not provided (legacy caller)', async () => {
    await client.ingest.text({
      text: 'A doc snippet.',
      source_type: 'text',
    });

    const body = lastRequestBody();
    expect(body).not.toHaveProperty('speaker');
    expect(body).not.toHaveProperty('participants');
  });

  it('accepts artifact-kind source_type values (free-form hint)', async () => {
    await client.ingest.text({
      text: 'Issue body',
      source_type: 'ticket',
    });

    expect(lastRequestBody().source_type).toBe('ticket');
  });

  it('accepts custom source_type strings (no enum gating)', async () => {
    await client.ingest.text({
      text: 'A custom shape',
      source_type: 'my-custom-shape',
    });

    expect(lastRequestBody().source_type).toBe('my-custom-shape');
  });

  it('forwards through textInSandbox the same way', async () => {
    await client.ingest.textInSandbox('sb-123', {
      text: 'a payload',
      speaker: 'Assistant',
      participants: ['User', 'Assistant'],
    });

    const body = lastRequestBody();
    expect(body.speaker).toBe('Assistant');
    expect(body.participants).toEqual(['User', 'Assistant']);
  });
});
