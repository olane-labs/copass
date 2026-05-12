/**
 * Gateway registrar — libp2p heartbeat failure detection (ADR 0030
 * lifecycle option C).
 *
 * The registrar runs a periodic libp2p heartbeat against the gateway's
 * `o://daemons` tool. When N consecutive heartbeats fail (default 2 ≈
 * ~2 min at the default cadence), it fires the `onReconnectNeeded`
 * callback so the host can drive teardown + re-resolve + re-register.
 *
 * Test surface (no real libp2p — we mock the `oClientNode` boundary):
 *   * Successful heartbeat resets the consecutive-failure counter.
 *   * N consecutive failures fire `onReconnectNeeded` exactly once.
 *   * `unregister()` is idempotent and stops the heartbeat loop.
 *   * The callback fires at most once per registrar instance even if
 *     failures continue past the threshold.
 *
 * The threshold is asserted via a 1-tick threshold (so the callback
 * fires on the first failure) to keep tests fast — production default
 * of 2 is just a tunable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_HEARTBEAT_FAILURE_THRESHOLD,
  registerWithGateway,
  type GatewayRegistrarOptions,
} from '../src/gateway-registrar.js';

// ---------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------

interface FakeClient {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  use: ReturnType<typeof vi.fn>;
}

let lastClient: FakeClient | null = null;

vi.mock('@olane/o-node', async () => {
  // Hoisted mock — the registrar imports `oClientNode` + address shims.
  // We need each `new oClientNode(...)` to produce a fresh fake that
  // we can assert against from outside. All three exports are
  // constructor-like (`new ...`) so we use class-shaped functions
  // rather than `vi.fn` (which produces non-constructable mocks).
  class FakeNodeAddress {
    _addr: string;
    constructor(addr: string) {
      this._addr = addr;
    }
    toString(): string {
      return this._addr;
    }
  }
  class FakeNodeTransport {
    _multiaddr: string;
    constructor(m: string) {
      this._multiaddr = m;
    }
    toString(): string {
      return this._multiaddr;
    }
  }
  class FakeClientNode implements FakeClient {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    use: ReturnType<typeof vi.fn>;
    constructor() {
      this.start = vi.fn().mockResolvedValue(undefined);
      this.stop = vi.fn().mockResolvedValue(undefined);
      this.use = vi.fn();
      lastClient = this;
    }
  }
  return {
    oClientNode: FakeClientNode,
    oNodeAddress: FakeNodeAddress,
    oNodeTransport: FakeNodeTransport,
  };
});

vi.mock('@olane/o-core', async () => {
  class FakeAddress {
    _addr: string;
    constructor(addr: string) {
      this._addr = addr;
    }
    toString(): string {
      return this._addr;
    }
  }
  return {
    oAddress: FakeAddress,
  };
});

// Minimal fake OlaneOS — only `rootLeader.transports` matters to the
// registrar's address resolution.
function makeFakeOS(transport = '/ip4/192.168.1.10/tcp/9999/p2p/12D3KooFAKE') {
  return {
    rootLeader: {
      transports: [{ toString: () => transport }],
    },
  };
}

function baseOptions(
  overrides: Partial<GatewayRegistrarOptions> = {},
): GatewayRegistrarOptions {
  return {
    gatewayMultiaddr: '/dns4/test-gw.e2b.dev/tcp/443/tls/ws/p2p/12D3KooWGW',
    userId: '11111111-1111-1111-1111-111111111111',
    daemonId: 'test-daemon',
    heartbeatMs: 100,
    log: () => {},
    ...overrides,
  };
}

beforeEach(() => {
  lastClient = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------
// Heartbeat success → resets counter
// ---------------------------------------------------------------------

describe('gateway-registrar — heartbeat success path', () => {
  it('successful heartbeats keep onReconnectNeeded silent', async () => {
    vi.useFakeTimers();
    const onReconnect = vi.fn();
    const os = makeFakeOS();

    // First call inside `registerWithGateway` is the initial register.
    // Subsequent calls are heartbeats. All succeed.
    const handle = await registerWithGateway(os, {
      ...baseOptions(),
      onReconnectNeeded: onReconnect,
      failureThreshold: 1,
    });

    expect(lastClient).not.toBeNull();
    lastClient!.use.mockResolvedValue({
      result: { data: { ok: true } },
    });

    // Advance through several heartbeat cycles.
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(onReconnect).not.toHaveBeenCalled();
    await handle.unregister();
  });

  it('a single success after failures resets the counter', async () => {
    vi.useFakeTimers();
    const onReconnect = vi.fn();
    const os = makeFakeOS();

    const handle = await registerWithGateway(os, {
      ...baseOptions(),
      onReconnectNeeded: onReconnect,
      failureThreshold: 4,
    });

    expect(lastClient).not.toBeNull();
    let hbIdx = 0;
    lastClient!.use.mockImplementation(async () => {
      // The initial register call resolves before we set this impl —
      // it returned `undefined` (vi.fn default) which the heartbeat
      // path tolerates. Every call we observe here is a heartbeat.
      hbIdx += 1;
      // HB1 fail, HB2 fail, HB3 fail, HB4 success (resets counter),
      // HB5 fail, HB6 fail. Threshold=4; never reached.
      if (hbIdx === 4) return { result: { data: { ok: true } } };
      throw new Error('simulated heartbeat failure');
    });
    // Each tick at 100ms. 6 ticks = 600ms; advance generously.
    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(110);
    }
    expect(onReconnect).not.toHaveBeenCalled();
    await handle.unregister();
  });
});

// ---------------------------------------------------------------------
// Heartbeat failure → reconnect-needed
// ---------------------------------------------------------------------

describe('gateway-registrar — reconnect-needed signal', () => {
  it('fires onReconnectNeeded after N consecutive failures', async () => {
    vi.useFakeTimers();
    const onReconnect = vi.fn();
    const os = makeFakeOS();

    const handle = await registerWithGateway(os, {
      ...baseOptions(),
      onReconnectNeeded: onReconnect,
      failureThreshold: 2,
    });

    expect(lastClient).not.toBeNull();
    let callIdx = 0;
    lastClient!.use.mockImplementation(async () => {
      callIdx += 1;
      // Initial register (idx 1) → success. Heartbeats fail.
      if (callIdx === 1) return { result: { data: { ok: true } } };
      throw new Error('connection refused');
    });

    // Heartbeat 1 fires at t≈heartbeatMs. Advance enough for 2 ticks.
    await vi.advanceTimersByTimeAsync(150); // heartbeat 1 → fail
    await vi.advanceTimersByTimeAsync(150); // heartbeat 2 → fail; threshold hit
    expect(onReconnect).toHaveBeenCalledTimes(1);
    const arg = onReconnect.mock.calls[0][0];
    expect(arg.consecutiveFailures).toBeGreaterThanOrEqual(2);
    expect(arg.lastError).toBeInstanceOf(Error);
    await handle.unregister();
  });

  it('fires onReconnectNeeded at most once per registrar instance', async () => {
    vi.useFakeTimers();
    const onReconnect = vi.fn();
    const os = makeFakeOS();

    const handle = await registerWithGateway(os, {
      ...baseOptions(),
      onReconnectNeeded: onReconnect,
      failureThreshold: 1,
    });

    expect(lastClient).not.toBeNull();
    let callIdx = 0;
    lastClient!.use.mockImplementation(async () => {
      callIdx += 1;
      if (callIdx === 1) return { result: { data: { ok: true } } };
      throw new Error('ongoing failure');
    });

    // Multiple failure cycles past the threshold — the callback should
    // fire EXACTLY ONCE. The host is responsible for spawning a fresh
    // registrar to handle the next failure window.
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(onReconnect).toHaveBeenCalledTimes(1);
    await handle.unregister();
  });

  it('uses the default threshold when not overridden', () => {
    // Sanity check that the documented default isn't accidentally
    // moved away from 2 — that would change the dead-state recovery
    // window for the whole CLI.
    expect(DEFAULT_HEARTBEAT_FAILURE_THRESHOLD).toBe(2);
  });
});

// ---------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------

describe('gateway-registrar — unregister', () => {
  it('unregister stops the heartbeat loop and is idempotent', async () => {
    vi.useFakeTimers();
    const os = makeFakeOS();

    const handle = await registerWithGateway(os, baseOptions());

    expect(lastClient).not.toBeNull();
    lastClient!.use.mockResolvedValue({ result: { data: { ok: true } } });

    // Let a couple heartbeats fire.
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(150);
    const callsAtUnregister = lastClient!.use.mock.calls.length;

    await handle.unregister();
    // The unregister call itself adds 1; after that no more ticks.
    await vi.advanceTimersByTimeAsync(1000);
    // Allow the unregister call (+1); confirm no further heartbeats.
    expect(lastClient!.use.mock.calls.length).toBeLessThanOrEqual(
      callsAtUnregister + 1,
    );
    // Idempotent — second call must not throw.
    await expect(handle.unregister()).resolves.toBeUndefined();
  });
});
