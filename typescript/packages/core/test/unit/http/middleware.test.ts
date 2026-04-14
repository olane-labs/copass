import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpClient } from '../../../src/http/http-client.js';
import type { RequestContext, ResponseContext } from '../../../src/http/http-client.js';
import type { AuthProvider } from '../../../src/auth/types.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockAuth: AuthProvider = {
  getSession: async () => ({ accessToken: 'test-token' }),
};

describe('HttpClient middleware', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
  });

  it('calls onRequest middleware before fetch', async () => {
    const onRequest = vi.fn();
    const client = new HttpClient({
      apiUrl: 'https://api.example.com',
      authProvider: mockAuth,
      onRequest: [onRequest],
    });

    await client.request('/test');

    expect(onRequest).toHaveBeenCalledTimes(1);
    const ctx: RequestContext = onRequest.mock.calls[0][0];
    expect(ctx.method).toBe('GET');
    expect(ctx.path).toBe('/test');
    expect(ctx.url).toBe('https://api.example.com/test');
    expect(ctx.headers['Authorization']).toBe('Bearer test-token');
  });

  it('calls onResponse middleware after successful fetch', async () => {
    const onResponse = vi.fn();
    const client = new HttpClient({
      apiUrl: 'https://api.example.com',
      authProvider: mockAuth,
      onResponse: [onResponse],
    });

    await client.request('/test');

    expect(onResponse).toHaveBeenCalledTimes(1);
    const ctx: ResponseContext = onResponse.mock.calls[0][0];
    expect(ctx.status).toBe(200);
    expect(ctx.durationMs).toBeGreaterThanOrEqual(0);
    expect(ctx.request.path).toBe('/test');
  });

  it('onRequest can modify headers', async () => {
    const addTraceId = (ctx: RequestContext) => {
      ctx.headers['X-Trace-Id'] = 'trace-123';
    };
    const client = new HttpClient({
      apiUrl: 'https://api.example.com',
      authProvider: mockAuth,
      onRequest: [addTraceId],
    });

    await client.request('/test');

    const fetchHeaders = mockFetch.mock.calls[0][1].headers;
    expect(fetchHeaders['X-Trace-Id']).toBe('trace-123');
  });

  it('runs multiple middleware in order', async () => {
    const order: string[] = [];
    const first = () => { order.push('first'); };
    const second = () => { order.push('second'); };

    const client = new HttpClient({
      apiUrl: 'https://api.example.com',
      authProvider: mockAuth,
      onRequest: [first, second],
    });

    await client.request('/test');

    expect(order).toEqual(['first', 'second']);
  });

  it('does not call onResponse on error', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'bad' }, 400));
    const onResponse = vi.fn();
    const client = new HttpClient({
      apiUrl: 'https://api.example.com',
      authProvider: mockAuth,
      onResponse: [onResponse],
    });

    await expect(client.request('/test')).rejects.toThrow();
    expect(onResponse).not.toHaveBeenCalled();
  });
});
