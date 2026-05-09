import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextWindow } from '../../src/context-window/context-window.js';
import { ContextWindowResource } from '../../src/context-window/resource.js';
import type { CopassClient } from '../../src/client.js';
import type { DataSource } from '../../src/types/sources.js';
import type { IngestJobResponse } from '../../src/types/ingest.js';
import type { StatusResponse } from '../../src/types/sandboxes.js';

function makeClient(overrides: Record<string, unknown> = {}): CopassClient {
  return {
    sources: {
      register: vi.fn(),
      retrieve: vi.fn(),
      ingest: vi.fn().mockResolvedValue({
        job_id: 'job_1',
        status: 'queued',
        encrypted: false,
        sandbox_id: 'sb1',
        status_url: '/jobs/job_1',
      } satisfies IngestJobResponse),
      pause: vi.fn(),
      resume: vi.fn(),
      disconnect: vi.fn().mockResolvedValue({ status: 'disconnected' } satisfies StatusResponse),
      ...(overrides.sources ?? {}),
    },
    ingest: { getSandboxJob: vi.fn() },
  } as unknown as CopassClient;
}

describe('ContextWindow', () => {
  let client: CopassClient;

  beforeEach(() => {
    client = makeClient();
  });

  it('getTurns returns a defensive copy', () => {
    const window = new ContextWindow({
      client,
      sandboxId: 'sb1',
      dataSourceId: 'ds1',
      initialTurns: [{ role: 'user', content: 'hello' }],
    });
    const turns = window.getTurns();
    turns.push({ role: 'user', content: 'injected' });
    expect(window.getTurns()).toHaveLength(1);
  });

  it('addTurn appends locally and pushes through the source', async () => {
    // ADR 0022 Phase 2 — body is the verbatim content; speaker rides
    // on the envelope. Capitalized role is the fallback when
    // ChatMessage.name is absent.
    const window = new ContextWindow({
      client,
      sandboxId: 'sb1',
      dataSourceId: 'ds1',
    });
    await window.addTurn({ role: 'user', content: 'hello' });
    expect(window.getTurns()).toEqual([{ role: 'user', content: 'hello' }]);
    expect(client.sources.ingest).toHaveBeenCalledWith(
      'sb1',
      'ds1',
      expect.objectContaining({
        text: 'hello',
        source_type: 'conversation',
        speaker: 'User',
      }),
    );
  });

  it('addTurn forwards ChatMessage.name as speaker when set', async () => {
    const window = new ContextWindow({
      client,
      sandboxId: 'sb1',
      dataSourceId: 'ds1',
    });
    await window.addTurn({
      role: 'user',
      content: 'Hey Bob, did you finish?',
      name: 'Alice',
    });
    expect(client.sources.ingest).toHaveBeenCalledWith(
      'sb1',
      'ds1',
      expect.objectContaining({
        text: 'Hey Bob, did you finish?',
        speaker: 'Alice',  // name wins over role-derived fallback
      }),
    );
  });

  it('addTurn forwards constructor-time participants on every push', async () => {
    const window = new ContextWindow({
      client,
      sandboxId: 'sb1',
      dataSourceId: 'ds1',
      participants: ['User', 'Alice'],
    });
    await window.addTurn({ role: 'user', content: 'hello' });
    expect(client.sources.ingest).toHaveBeenCalledWith(
      'sb1',
      'ds1',
      expect.objectContaining({
        participants: ['User', 'Alice'],
      }),
    );
  });

  it('addTurn per-call participants override the constructor default', async () => {
    const window = new ContextWindow({
      client,
      sandboxId: 'sb1',
      dataSourceId: 'ds1',
      participants: ['User', 'Alice'],
    });
    await window.addTurn(
      { role: 'user', content: 'hi' },
      { participants: ['User', 'Bob', 'Carol'] },
    );
    expect(client.sources.ingest).toHaveBeenCalledWith(
      'sb1',
      'ds1',
      expect.objectContaining({
        participants: ['User', 'Bob', 'Carol'],
      }),
    );
  });

  it('addTurn omits participants when neither constructor nor call-site set it', async () => {
    const window = new ContextWindow({
      client,
      sandboxId: 'sb1',
      dataSourceId: 'ds1',
    });
    await window.addTurn({ role: 'user', content: 'hi' });
    const call = (client.sources.ingest as ReturnType<typeof vi.fn>).mock
      .calls[0]![2] as Record<string, unknown>;
    expect(call.participants).toBeUndefined();
  });

  it('addTurn forwards projectId when the window was created with one', async () => {
    const window = new ContextWindow({
      client,
      sandboxId: 'sb1',
      dataSourceId: 'ds1',
      projectId: 'proj_42',
    });
    await window.addTurn({ role: 'assistant', content: 'hi' });
    expect(client.sources.ingest).toHaveBeenCalledWith(
      'sb1',
      'ds1',
      expect.objectContaining({ project_id: 'proj_42' }),
    );
  });

  it('close disconnects the underlying source', async () => {
    const window = new ContextWindow({ client, sandboxId: 'sb1', dataSourceId: 'ds1' });
    await window.close();
    expect(client.sources.disconnect).toHaveBeenCalledWith('sb1', 'ds1');
  });

  it('seeds initialTurns on construction', () => {
    const window = new ContextWindow({
      client,
      sandboxId: 'sb1',
      dataSourceId: 'ds1',
      initialTurns: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
      ],
    });
    expect(window.getTurns()).toHaveLength(2);
  });
});

describe('ContextWindowResource', () => {
  const mockSource: DataSource = {
    data_source_id: 'ds_new',
    user_id: 'u1',
    sandbox_id: 'sb1',
    provider: 'custom',
    name: 'window-123',
    ingestion_mode: 'manual',
    status: 'active',
    kind: 'ephemeral',
    adapter_config: {},
  };

  it('create() registers an ephemeral custom source and returns a window bound to it', async () => {
    const register = vi.fn().mockResolvedValue(mockSource);
    const client = makeClient({ sources: { register } });

    const resource = new ContextWindowResource(client);
    const window = await resource.create({ sandbox_id: 'sb1', project_id: 'proj_1' });

    expect(window).toBeInstanceOf(ContextWindow);
    expect(window.dataSourceId).toBe('ds_new');
    expect(window.projectId).toBe('proj_1');
    expect(register).toHaveBeenCalledWith(
      'sb1',
      expect.objectContaining({
        provider: 'custom',
        ingestion_mode: 'manual',
        kind: 'ephemeral',
      }),
    );
  });

  it('create() generates a default window-<ts> name when none is provided', async () => {
    const register = vi.fn().mockResolvedValue(mockSource);
    const client = makeClient({ sources: { register } });

    const resource = new ContextWindowResource(client);
    await resource.create({ sandbox_id: 'sb1' });

    const passedName = register.mock.calls[0][1].name as string;
    expect(passedName).toMatch(/^window-\d+$/);
  });

  it('attach() retrieves the existing source and seeds initialTurns', async () => {
    const existing: DataSource = { ...mockSource, data_source_id: 'ds_existing' };
    const retrieve = vi.fn().mockResolvedValue(existing);
    const client = makeClient({ sources: { retrieve } });

    const resource = new ContextWindowResource(client);
    const window = await resource.attach({
      sandbox_id: 'sb1',
      data_source_id: 'ds_existing',
      initialTurns: [
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer' },
      ],
    });

    expect(retrieve).toHaveBeenCalledWith('sb1', 'ds_existing');
    expect(window.dataSourceId).toBe('ds_existing');
    expect(window.getTurns()).toHaveLength(2);
  });
});
