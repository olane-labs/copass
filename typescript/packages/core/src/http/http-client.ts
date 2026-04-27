/**
 * Internal HTTP client for the Copass API.
 *
 * Handles auth header injection, encryption header, retry, error normalization,
 * and request/response middleware hooks.
 */

import type { AuthProvider } from '../auth/types.js';
import type { EncryptedPayload } from '../crypto/encryption.js';
import type { RetryConfig } from '../types/common.js';
import { CopassApiError } from './errors.js';
import { retryWithBackoff } from './retry.js';

/** Metadata about a request, passed to middleware hooks. */
export interface RequestContext {
  method: string;
  path: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** Metadata about a response, passed to middleware hooks. */
export interface ResponseContext {
  request: RequestContext;
  status: number;
  durationMs: number;
}

/**
 * Middleware hook called before each request.
 * Can modify the RequestContext (e.g., add headers, log).
 */
export type RequestMiddleware = (ctx: RequestContext) => void | Promise<void>;

/**
 * Middleware hook called after each successful response.
 */
export type ResponseMiddleware = (ctx: ResponseContext) => void | Promise<void>;

export interface HttpClientOptions {
  apiUrl: string;
  authProvider: AuthProvider;
  retry?: RetryConfig;
  /** Middleware hooks called before each request. */
  onRequest?: RequestMiddleware[];
  /** Middleware hooks called after each successful response. */
  onResponse?: ResponseMiddleware[];
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Raw bytes body — caller must also set headers['Content-Type']. Bypasses JSON serialization. */
  rawBody?: Uint8Array | ArrayBuffer | Blob;
  /** When true, parse the response as raw bytes instead of JSON. */
  rawResponse?: boolean;
  encryptedPayload?: EncryptedPayload;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  /**
   * Cancellation signal. When aborted, the underlying `fetch` is
   * cancelled — for streaming requests this closes the SSE connection,
   * which the server detects and uses to mark the run cancelled.
   * Without a signal, breaking out of the iterator only releases the
   * reader lock; the TCP connection stays open until GC.
   */
  signal?: AbortSignal;
}

export class HttpClient {
  private readonly apiUrl: string;
  private readonly authProvider: AuthProvider;
  private readonly retryConfig?: RetryConfig;
  private readonly onRequest: RequestMiddleware[];
  private readonly onResponse: ResponseMiddleware[];

  constructor(options: HttpClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.authProvider = options.authProvider;
    this.retryConfig = options.retry;
    this.onRequest = options.onRequest ?? [];
    this.onResponse = options.onResponse ?? [];
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, rawBody, rawResponse, encryptedPayload, query, headers: extraHeaders, signal } = options;

    const session = await this.authProvider.getSession();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.accessToken}`,
      ...extraHeaders,
    };

    if (rawBody === undefined && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }

    if (session.sessionToken) {
      headers['X-Encryption-Token'] = session.sessionToken;
    }

    let requestBody: string | Uint8Array | ArrayBuffer | Blob | undefined;
    if (rawBody !== undefined) {
      requestBody = rawBody;
    } else if (encryptedPayload && body) {
      requestBody = JSON.stringify({ ...(body as Record<string, unknown>), ...encryptedPayload });
    } else if (body !== undefined) {
      requestBody = JSON.stringify(body);
    }

    let url = `${this.apiUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, value);
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const ctxBodyForMiddleware =
      typeof requestBody === 'string' || requestBody === undefined ? requestBody : '<binary>';
    const ctx: RequestContext = { method, path, url, headers, body: ctxBodyForMiddleware };
    for (const mw of this.onRequest) {
      await mw(ctx);
    }

    return retryWithBackoff(async () => {
      const start = Date.now();
      const response = await fetch(ctx.url, {
        method: ctx.method,
        headers: ctx.headers,
        body: (requestBody ?? undefined) as BodyInit | undefined,
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        let errorBody: unknown;
        try {
          errorBody = JSON.parse(text);
        } catch {
          errorBody = text;
        }
        throw new CopassApiError(
          `API request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorBody,
          path,
        );
      }

      for (const mw of this.onResponse) {
        await mw({ request: ctx, status: response.status, durationMs: Date.now() - start });
      }

      if (rawResponse) {
        const buf = await response.arrayBuffer();
        return new Uint8Array(buf) as unknown as T;
      }
      if (response.status === 204) {
        return undefined as unknown as T;
      }
      return response.json() as Promise<T>;
    }, this.retryConfig);
  }

  /**
   * Open a streaming request — returns the raw `Response` so the
   * caller can consume `response.body` directly (typically with
   * `parseSSE` from `util/sse.ts`).
   *
   * Differences from `request()`:
   *   * **No retry**. Mid-stream retries would replay turns server-
   *     side and confuse the consumer; if the connection drops, the
   *     caller decides whether to reopen with a fresh `session_id`.
   *   * **No JSON parsing** of the response body — the caller owns it.
   *   * **`Accept: text/event-stream`** is set so the server picks
   *     the SSE content negotiation branch where it has one.
   *   * The `4xx`/`5xx` body is consumed for the error message
   *     (matches `request()`'s behavior).
   */
  async streamRequest(
    path: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    const { method = 'POST', body, rawBody, query, headers: extraHeaders, signal } = options;

    const session = await this.authProvider.getSession();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.accessToken}`,
      Accept: 'text/event-stream',
      ...extraHeaders,
    };
    if (rawBody === undefined && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (session.sessionToken) {
      headers['X-Encryption-Token'] = session.sessionToken;
    }

    let requestBody: string | Uint8Array | ArrayBuffer | Blob | undefined;
    if (rawBody !== undefined) {
      requestBody = rawBody;
    } else if (body !== undefined) {
      requestBody = JSON.stringify(body);
    }

    let url = `${this.apiUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) params.set(k, v);
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const ctxBodyForMiddleware =
      typeof requestBody === 'string' || requestBody === undefined ? requestBody : '<binary>';
    const ctx: RequestContext = { method, path, url, headers, body: ctxBodyForMiddleware };
    for (const mw of this.onRequest) {
      await mw(ctx);
    }

    const start = Date.now();
    const response = await fetch(ctx.url, {
      method: ctx.method,
      headers: ctx.headers,
      body: (requestBody ?? undefined) as BodyInit | undefined,
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let errorBody: unknown;
      try {
        errorBody = JSON.parse(text);
      } catch {
        errorBody = text;
      }
      throw new CopassApiError(
        `Stream request failed: ${response.status} ${response.statusText}`,
        response.status,
        errorBody,
        path,
      );
    }

    for (const mw of this.onResponse) {
      await mw({ request: ctx, status: response.status, durationMs: Date.now() - start });
    }
    return response;
  }

  async uploadFile(
    path: string,
    file: Blob,
    fields: Record<string, string> = {},
    fileName?: string,
  ): Promise<unknown> {
    const session = await this.authProvider.getSession();

    const formData = new FormData();
    formData.append('file', file, fileName ?? 'file');
    for (const [key, value] of Object.entries(fields)) {
      formData.append(key, value);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.accessToken}`,
    };

    if (session.sessionToken) {
      headers['X-Encryption-Token'] = session.sessionToken;
    }

    const url = `${this.apiUrl}${path}`;
    const ctx: RequestContext = { method: 'POST', path, url, headers };
    for (const mw of this.onRequest) {
      await mw(ctx);
    }

    return retryWithBackoff(async () => {
      const start = Date.now();
      const response = await fetch(ctx.url, {
        method: 'POST',
        headers: ctx.headers,
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        let errorBody: unknown;
        try {
          errorBody = JSON.parse(text);
        } catch {
          errorBody = text;
        }
        throw new CopassApiError(
          `File upload failed: ${response.status} ${response.statusText}`,
          response.status,
          errorBody,
          path,
        );
      }

      for (const mw of this.onResponse) {
        await mw({ request: ctx, status: response.status, durationMs: Date.now() - start });
      }

      return response.json();
    }, this.retryConfig);
  }
}
