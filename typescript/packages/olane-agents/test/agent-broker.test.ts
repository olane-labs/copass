import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentBroker } from '../src/agent-broker.js';
import * as olaneClient from '../src/olane-client.js';

/**
 * Method-level tests for AgentBroker. We mock `withOlaneClient` so we
 * don't need a running OS. These test the broker's argument-handling +
 * envelope-shape contracts (the hard-won invariants from the audit).
 *
 * A full round-trip integration test (register → list → send → drain →
 * deregister) is deferred to a future PR — the libp2p init cost makes
 * it expensive to run in CI, and `@olane/o-test`'s TestEnvironment is
 * single-process so doesn't exercise the cross-process daemon path
 * we actually care about. Track as F6 follow-up.
 */

describe('AgentBroker.send', () => {
  let broker: AgentBroker;
  let useFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    broker = new AgentBroker();
    useFn = vi.fn().mockResolvedValue({
      result: { success: true, data: { messageId: 'msg_test' } },
    });
    vi.spyOn(olaneClient, 'withOlaneClient').mockImplementation(
      async (fn) => fn(useFn as any),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when fromSessionId is missing (F2 — anonymous sends not supported)', async () => {
    await expect(
      broker.send({ to: 'o://x/y/1', text: 'hi' } as any),
    ).rejects.toThrow(/fromSessionId/);
  });

  it('throws when neither text nor data is provided', async () => {
    await expect(
      broker.send({ to: 'o://x/y/1', fromSessionId: 'irrelevant' }),
    ).rejects.toThrow(/text.*data/);
  });

  it('throws with a clear error when the fromSessionId session file is missing', async () => {
    await expect(
      broker.send({
        to: 'o://x/y/1',
        text: 'hi',
        fromSessionId: 'does-not-exist',
      }),
    ).rejects.toThrow(/no session daemon found/);
  });
});

describe('AgentBroker.register', () => {
  let broker: AgentBroker;

  beforeEach(() => {
    broker = new AgentBroker();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when cliEntry is missing (F3 — no implicit process.argv[1] fallback)', async () => {
    // We mock withOlaneClient so the OS-up check resolves; the real
    // check for cliEntry happens after.
    vi.spyOn(olaneClient, 'withOlaneClient').mockResolvedValue(
      undefined as any,
    );
    await expect(
      broker.register({
        kind: 'claude-code',
        sessionId: 'no-cli-entry',
      } as any),
    ).rejects.toThrow(/cliEntry.*required/);
  });
});

describe('AgentBroker.list', () => {
  let broker: AgentBroker;
  let useFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    broker = new AgentBroker();
    useFn = vi.fn();
    vi.spyOn(olaneClient, 'withOlaneClient').mockImplementation(
      async (fn) => fn(useFn as any),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes filters through to o://agents.list', async () => {
    useFn.mockResolvedValue({
      result: { success: true, data: { count: 0, entries: [] } },
    });
    await broker.list({ kind: 'claude-code', user: 'brendon', live: true });
    expect(useFn).toHaveBeenCalledTimes(1);
    const [target, payload] = useFn.mock.calls[0];
    expect(target).toBe('o://agents');
    expect(payload).toEqual({
      method: 'list',
      params: { kind: 'claude-code', user: 'brendon', live: true },
    });
  });

  it('returns an empty array when registry returns no entries', async () => {
    useFn.mockResolvedValue({ result: { success: true, data: null } });
    const result = await broker.list();
    expect(result).toEqual([]);
  });
});
