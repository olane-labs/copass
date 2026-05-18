/**
 * Gateway registrar — libp2p heartbeat failure detection + leader-
 * originated registration (ADR 0030 lifecycle option C, post-PR for
 * registrar-uses-rootleader-not-transient-client).
 *
 * The registrar now dials the gateway directly from the daemon's own
 * ``os.rootLeader`` (rather than spinning up a transient
 * ``oClientNode``). The gateway's anchor-scoped dialer then finds the
 * daemon's inbound connection in its connection-manager cache —
 * keyed under the leader's peer-id — and skips the fresh dial that
 * would trip libp2p's ``denyDialPeer`` gater.
 *
 * Test surface (no real libp2p — we mock the leader's ``use``
 * boundary):
 *   * Initial register dials via ``os.rootLeader.use(...)`` with the
 *     gateway's multiaddr as a pre-populated transport. The address
 *     is the registry tool's address (``o://daemons``).
 *   * Successful heartbeat resets the consecutive-failure counter.
 *   * N consecutive failures fire ``onReconnectNeeded`` exactly once.
 *   * ``unregister()`` is idempotent and stops the heartbeat loop.
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
  GATEWAY_REGISTRY_ADDRESS,
  registerWithGateway,
  type GatewayRegistrarOptions,
} from '../src/gateway-registrar.js';

// ---------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------

vi.mock('@olane/o-node', async () => {
  // The registrar imports ``oNodeAddress`` + ``oNodeTransport`` to
  // construct the address it hands to ``leaderNode.use(...)``. Mock
  // them as transparent wrappers so we can assert on their shape from
  // outside.
  class FakeNodeAddress {
    _addr: string;
    _transports: any[];
    constructor(addr: string, transports: any[] = []) {
      this._addr = addr;
      this._transports = transports;
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
  return {
    oNodeAddress: FakeNodeAddress,
    oNodeTransport: FakeNodeTransport,
  };
});

interface FakeLeader {
  use: ReturnType<typeof vi.fn>;
  transports: Array<{ toString: () => string }>;
}

// Minimal fake OlaneOS — only ``rootLeader.transports`` (for
// ``daemon_address`` resolution) and ``rootLeader.use`` (the dial
// path) matter to the registrar.
function makeFakeOS(
  transport = '/ip4/192.168.1.10/tcp/9999/p2p/12D3KooFAKE',
): { rootLeader: FakeLeader } {
  return {
    rootLeader: {
      transports: [{ toString: () => transport }],
      use: vi.fn(),
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------
// Initial register — addresses + transports
// ---------------------------------------------------------------------

describe('gateway-registrar — leader-originated register', () => {
  it('dials via rootLeader.use with the gateway multiaddr as transport', async () => {
    const os = makeFakeOS();
    os.rootLeader.use.mockResolvedValue({ result: { data: { ok: true } } });

    const handle = await registerWithGateway(os, baseOptions());

    // First call must be the initial register (no heartbeats yet —
    // timers untouched).
    expect(os.rootLeader.use).toHaveBeenCalled();
    const [address, payload] = os.rootLeader.use.mock.calls[0];
    expect(address.toString()).toBe(GATEWAY_REGISTRY_ADDRESS);
    // The address must carry the gateway's multiaddr as a transport
    // hint — that's what tells the framework's oSearchResolver to
    // early-return + go straight to the connection manager.
    expect(address._transports).toHaveLength(1);
    expect(address._transports[0].toString()).toBe(
      baseOptions().gatewayMultiaddr,
    );
    expect(payload.method).toBe('register');
    expect(payload.params.daemon_id).toBe('test-daemon');
    expect(payload.params.user_id).toBe(baseOptions().userId);

    await handle.unregister();
  });

  it('throws when rootLeader is missing or has no use() method', async () => {
    await expect(
      registerWithGateway({} as any, baseOptions()),
    ).rejects.toThrow(/rootLeader/);
    await expect(
      registerWithGateway({ rootLeader: {} } as any, baseOptions()),
    ).rejects.toThrow(/rootLeader/);
  });

  it('throws when leader has no libp2p transports', async () => {
    const os = { rootLeader: { transports: [], use: vi.fn() } };
    await expect(registerWithGateway(os as any, baseOptions())).rejects.toThrow(
      /no libp2p transports/,
    );
  });
});

// ---------------------------------------------------------------------
// Heartbeat success → resets counter
// ---------------------------------------------------------------------

describe('gateway-registrar — heartbeat success path', () => {
  it('successful heartbeats keep onReconnectNeeded silent', async () => {
    vi.useFakeTimers();
    const onReconnect = vi.fn();
    const os = makeFakeOS();
    os.rootLeader.use.mockResolvedValue({ result: { data: { ok: true } } });

    const handle = await registerWithGateway(os, {
      ...baseOptions(),
      onReconnectNeeded: onReconnect,
      failureThreshold: 1,
    });

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

    let callIdx = 0;
    os.rootLeader.use.mockImplementation(async () => {
      callIdx += 1;
      // call 1 = initial register (resolved before failures start)
      if (callIdx === 1) return { result: { data: { ok: true } } };
      // HB1 fail, HB2 fail, HB3 fail, HB4 success (resets), HB5 fail,
      // HB6 fail. With failureThreshold=4 the threshold is never met.
      if (callIdx === 5) return { result: { data: { ok: true } } };
      throw new Error('simulated heartbeat failure');
    });

    const handle = await registerWithGateway(os, {
      ...baseOptions(),
      onReconnectNeeded: onReconnect,
      failureThreshold: 4,
    });

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

    let callIdx = 0;
    os.rootLeader.use.mockImplementation(async () => {
      callIdx += 1;
      // Initial register (idx 1) → success. Heartbeats fail.
      if (callIdx === 1) return { result: { data: { ok: true } } };
      throw new Error('connection refused');
    });

    const handle = await registerWithGateway(os, {
      ...baseOptions(),
      onReconnectNeeded: onReconnect,
      failureThreshold: 2,
    });

    await vi.advanceTimersByTimeAsync(150); // HB1 → fail
    await vi.advanceTimersByTimeAsync(150); // HB2 → fail; threshold hit
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

    let callIdx = 0;
    os.rootLeader.use.mockImplementation(async () => {
      callIdx += 1;
      if (callIdx === 1) return { result: { data: { ok: true } } };
      throw new Error('ongoing failure');
    });

    const handle = await registerWithGateway(os, {
      ...baseOptions(),
      onReconnectNeeded: onReconnect,
      failureThreshold: 1,
    });

    // Multiple failure cycles past the threshold — callback should
    // fire EXACTLY ONCE.
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(onReconnect).toHaveBeenCalledTimes(1);
    await handle.unregister();
  });

  it('uses the default threshold when not overridden', () => {
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
    os.rootLeader.use.mockResolvedValue({ result: { data: { ok: true } } });

    const handle = await registerWithGateway(os, baseOptions());

    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(150);
    const callsAtUnregister = os.rootLeader.use.mock.calls.length;

    await handle.unregister();
    await vi.advanceTimersByTimeAsync(1000);
    // Allow the unregister call (+1); confirm no further heartbeats.
    expect(os.rootLeader.use.mock.calls.length).toBeLessThanOrEqual(
      callsAtUnregister + 1,
    );
    // Idempotent — second call must not throw.
    await expect(handle.unregister()).resolves.toBeUndefined();
  });
});
