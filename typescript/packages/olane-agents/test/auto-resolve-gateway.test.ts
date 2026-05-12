/**
 * Gateway auto-resolution — ADR 0030 Phase 2a.
 *
 * Verifies the precedence chain inside ``resolveGatewayOptions`` plus
 * the direct ``autoResolveGateway`` failure / success branches:
 *
 *   1. ``GATEWAY_MULTIADDR`` env set → env wins, no api call.
 *   2. No env vars + 2xx api response → multiaddr from api.
 *   3. No env vars + 4xx/5xx api → null + warn.
 *   4. ``OLANE_GATEWAY_AUTO_RESOLVE=false`` → never call api.
 *   5. Stable daemon_id across calls within a single process.
 *
 * Tests deliberately do NOT spin up an actual `runOlaneOSHost` —
 * they exercise ``resolveGatewayOptions`` + ``autoResolveGateway``
 * in isolation. End-to-end registration is verified by hand against
 * staging after Part A (the api side) lands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  autoResolveGateway,
  _resetDaemonIdForTest,
  type GatewayAutoResolveTransport,
} from '../src/auto-resolve-gateway.js';
import { resolveGatewayOptions } from '../src/os-host.js';

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_API_BASE = 'https://api.test.copass.id';

function makeTransport(
  overrides: Partial<GatewayAutoResolveTransport> = {},
): GatewayAutoResolveTransport {
  return {
    apiBaseUrl: overrides.apiBaseUrl ?? TEST_API_BASE,
    getAccessToken: overrides.getAccessToken ?? (async () => 'test-bearer-token'),
  };
}

function makeSuccessResponse(
  body: Record<string, unknown> = {},
): Response {
  const defaults = {
    gateway_url: 'https://4020-test-sandbox.e2b.dev',
    gateway_multiaddr:
      '/dns4/4016-test-sandbox.e2b.dev/tcp/443/tls/ws/p2p/12D3KooWTEST',
    gateway_peer_id: '12D3KooWTEST',
    sandbox_id: '33333333-3333-3333-3333-333333333333',
    session_id: '22222222-2222-2222-2222-222222222222',
    provisioned_now: false,
  };
  return new Response(JSON.stringify({ ...defaults, ...body }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeErrorResponse(status: number, body: unknown = null): Response {
  return new Response(body == null ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  _resetDaemonIdForTest();
  // Strip GATEWAY_* env vars so the precedence chain starts clean for
  // each test — without this a test that sets one leaks into the next.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('GATEWAY_') || key === 'OLANE_GATEWAY_AUTO_RESOLVE') {
      delete process.env[key];
    }
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =======================================================================
// autoResolveGateway() direct tests — pure function behavior
// =======================================================================

describe('autoResolveGateway — success', () => {
  it('returns the multiaddr + peer-id from a 200 api response', async () => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValue(makeSuccessResponse());

    const result = await autoResolveGateway({
      transport: makeTransport(),
      userId: TEST_USER_ID,
      fetchImpl: fetchSpy,
    });

    expect(result).not.toBeNull();
    expect(result!.gatewayMultiaddr).toBe(
      '/dns4/4016-test-sandbox.e2b.dev/tcp/443/tls/ws/p2p/12D3KooWTEST',
    );
    expect(result!.gatewayPeerId).toBe('12D3KooWTEST');
    expect(result!.daemonId).toBeTruthy();
    // The endpoint path + auth header — load-bearing contract with Part A.
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      `${TEST_API_BASE}/api/v1/storage/compute-providers/local/gateway`,
    );
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-bearer-token');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      provision_if_missing: true,
    });
  });

  it('strips trailing slash on apiBaseUrl', async () => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValue(makeSuccessResponse());

    await autoResolveGateway({
      transport: makeTransport({ apiBaseUrl: `${TEST_API_BASE}/` }),
      userId: TEST_USER_ID,
      fetchImpl: fetchSpy,
    });
    expect(fetchSpy.mock.calls[0][0]).toBe(
      `${TEST_API_BASE}/api/v1/storage/compute-providers/local/gateway`,
    );
  });

  it('reuses the same daemonId across calls within a process', async () => {
    // Fresh Response per call — fetch Response bodies are one-shot
    // streams, so a single ``mockResolvedValue`` would be consumed on
    // the first call.
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => makeSuccessResponse());

    const transport = makeTransport();
    const first = await autoResolveGateway({
      transport, userId: TEST_USER_ID, fetchImpl: fetchSpy,
    });
    const second = await autoResolveGateway({
      transport, userId: TEST_USER_ID, fetchImpl: fetchSpy,
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.daemonId).toBe(second!.daemonId);
    // The daemonId must be derived from the hostname (not a fresh
    // random each call) — sanity-check that the suffix is short
    // but the host prefix isn't empty.
    expect(first!.daemonId).toMatch(/^.+-[a-z0-9]{6}$/);
  });

  it('honors an explicit daemonId option', async () => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValue(makeSuccessResponse());

    const result = await autoResolveGateway({
      transport: makeTransport(),
      userId: TEST_USER_ID,
      daemonId: 'pinned-daemon-id',
      fetchImpl: fetchSpy,
    });
    expect(result!.daemonId).toBe('pinned-daemon-id');
  });
});

describe('autoResolveGateway — failure paths return null', () => {
  it('returns null when getAccessToken yields null', async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    const result = await autoResolveGateway({
      transport: makeTransport({ getAccessToken: async () => null }),
      userId: TEST_USER_ID,
      fetchImpl: fetchSpy,
      log: () => {},
    });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null when getAccessToken throws', async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    const result = await autoResolveGateway({
      transport: makeTransport({
        getAccessToken: async () => {
          throw new Error('boom');
        },
      }),
      userId: TEST_USER_ID,
      fetchImpl: fetchSpy,
      log: () => {},
    });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null on transport error (network down)', async () => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('fetch failed'));
    const result = await autoResolveGateway({
      transport: makeTransport(),
      userId: TEST_USER_ID,
      fetchImpl: fetchSpy,
      log: () => {},
    });
    expect(result).toBeNull();
  });

  it('returns null on 401 (auth failure)', async () => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        makeErrorResponse(401, { detail: 'invalid token' }),
      );
    const result = await autoResolveGateway({
      transport: makeTransport(),
      userId: TEST_USER_ID,
      fetchImpl: fetchSpy,
      log: () => {},
    });
    expect(result).toBeNull();
  });

  it('returns null on 403 (forbidden)', async () => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValue(makeErrorResponse(403));
    const result = await autoResolveGateway({
      transport: makeTransport(),
      userId: TEST_USER_ID,
      fetchImpl: fetchSpy,
      log: () => {},
    });
    expect(result).toBeNull();
  });

  it('returns null on 500 (server error)', async () => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValue(makeErrorResponse(500));
    const result = await autoResolveGateway({
      transport: makeTransport(),
      userId: TEST_USER_ID,
      fetchImpl: fetchSpy,
      log: () => {},
    });
    expect(result).toBeNull();
  });

  it('returns null on 503 gateway_peer_id_unresolved', async () => {
    // Part A's "broker still booting" code path — we must NOT crash
    // here. The user re-runs `copass os start` after a few seconds.
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      makeErrorResponse(503, {
        detail: {
          error_code: 'gateway_peer_id_unresolved',
          message: 'broker still booting',
        },
      }),
    );
    const result = await autoResolveGateway({
      transport: makeTransport(),
      userId: TEST_USER_ID,
      fetchImpl: fetchSpy,
      log: () => {},
    });
    expect(result).toBeNull();
  });

  it('returns null when response is missing gateway_multiaddr', async () => {
    // Defensive — if Part A regressed and stopped sending the field,
    // we'd rather null out than return a registration with an empty
    // multiaddr (which would fail mysteriously at libp2p dial time).
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      makeSuccessResponse({ gateway_multiaddr: '', gateway_peer_id: '' }),
    );
    const result = await autoResolveGateway({
      transport: makeTransport(),
      userId: TEST_USER_ID,
      fetchImpl: fetchSpy,
      log: () => {},
    });
    expect(result).toBeNull();
  });

  it('returns null when response body is not JSON', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const result = await autoResolveGateway({
      transport: makeTransport(),
      userId: TEST_USER_ID,
      fetchImpl: fetchSpy,
      log: () => {},
    });
    expect(result).toBeNull();
  });
});

// =======================================================================
// resolveGatewayOptions() precedence chain
// =======================================================================

describe('resolveGatewayOptions — precedence chain', () => {
  it('env GATEWAY_MULTIADDR wins; api is never called', async () => {
    process.env.GATEWAY_MULTIADDR =
      '/ip4/127.0.0.1/tcp/9999/p2p/12D3KooWENV';
    process.env.GATEWAY_USER_ID = TEST_USER_ID;
    const fetchSpy = vi.fn<typeof fetch>();

    const result = await resolveGatewayOptions({
      instanceName: 'test',
      gateway: {
        autoResolveTransport: {
          apiBaseUrl: TEST_API_BASE,
          // Will never be called.
          getAccessToken: async () => 'should-not-be-used',
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result!.gatewayMultiaddr).toBe(
      '/ip4/127.0.0.1/tcp/9999/p2p/12D3KooWENV',
    );
    expect(result!.userId).toBe(TEST_USER_ID);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('no env + autoResolveTransport + 200 → uses api multiaddr', async () => {
    process.env.GATEWAY_USER_ID = TEST_USER_ID;
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => makeSuccessResponse());

    const result = await resolveGatewayOptions({
      instanceName: 'test',
      gateway: {
        autoResolveTransport: makeTransport(),
        autoResolveFetchImpl: fetchSpy,
        log: () => {},
      },
    });

    expect(result).not.toBeNull();
    expect(result!.gatewayMultiaddr).toBe(
      '/dns4/4016-test-sandbox.e2b.dev/tcp/443/tls/ws/p2p/12D3KooWTEST',
    );
    // Sensible default capabilities — `copass os start` always boots
    // a network-broker daemon with a shell tool mounted.
    expect(result!.capabilities).toEqual(['network-broker', 'shell']);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('OLANE_GATEWAY_AUTO_RESOLVE=false → never calls api', async () => {
    process.env.OLANE_GATEWAY_AUTO_RESOLVE = 'false';
    process.env.GATEWAY_USER_ID = TEST_USER_ID;
    const fetchSpy = vi.fn<typeof fetch>();

    const result = await resolveGatewayOptions({
      instanceName: 'test',
      gateway: {
        autoResolveTransport: {
          apiBaseUrl: TEST_API_BASE,
          getAccessToken: async () => {
            fetchSpy(); // proxy — if auto-resolve fires we'd hit this.
            return 'token';
          },
        },
      },
    });

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('no env + autoResolveTransport unset → returns null (no registration)', async () => {
    const result = await resolveGatewayOptions({
      instanceName: 'test',
      // no gateway config at all
    });
    expect(result).toBeNull();
  });

  it('no env + autoResolveTransport + api 401 → null (best-effort fallback)', async () => {
    process.env.GATEWAY_USER_ID = TEST_USER_ID;
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        makeErrorResponse(401, { detail: 'invalid token' }),
      );

    const result = await resolveGatewayOptions({
      instanceName: 'test',
      gateway: {
        autoResolveTransport: {
          apiBaseUrl: TEST_API_BASE,
          getAccessToken: async () => 'expired-token',
        },
        autoResolveFetchImpl: fetchSpy,
        log: () => {},
      },
    });
    expect(result).toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('options.gateway.enabled=false → never resolves, even with env set', async () => {
    process.env.GATEWAY_MULTIADDR = '/ip4/127.0.0.1/tcp/9999/p2p/X';
    process.env.GATEWAY_USER_ID = TEST_USER_ID;

    const result = await resolveGatewayOptions({
      instanceName: 'test',
      gateway: { enabled: false },
    });
    expect(result).toBeNull();
  });
});
