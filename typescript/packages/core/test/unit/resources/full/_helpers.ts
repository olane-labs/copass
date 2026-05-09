/**
 * Shared helpers for the full SDK contract test suite.
 *
 * Mock-based — every fetch call is intercepted by the global mock and
 * asserted against expected URL, method, and body shape. No network.
 *
 * Acts as a pre-publish deploy guard: when an SDK refactor breaks a
 * request shape or stops unpacking a response field, the matching
 * test fails before the package can be released.
 */
import { vi } from 'vitest';

import { CopassClient } from '../../../../src/client.js';

export const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

export function lastFetchCall(): FetchCall {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  const init = (call?.[1] ?? {}) as RequestInit;
  let body: unknown = undefined;
  if (typeof init.body === 'string' && init.body.length > 0) {
    body = JSON.parse(init.body);
  }
  const headers: Record<string, string> = {};
  // RequestInit.headers can be Headers, Record, or array — normalize.
  const raw = init.headers as Headers | Record<string, string> | undefined;
  if (raw instanceof Headers) {
    raw.forEach((v, k) => (headers[k] = v));
  } else if (raw && typeof raw === 'object') {
    Object.assign(headers, raw);
  }
  return {
    url: String(call?.[0]),
    method: String(init.method ?? 'GET'),
    body,
    headers,
  };
}

export function makeClient(): CopassClient {
  return new CopassClient({
    apiUrl: 'http://test',
    auth: { type: 'api-key', key: 'olk_test' },
  });
}
