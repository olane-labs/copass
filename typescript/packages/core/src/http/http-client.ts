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
  encryptedPayload?: EncryptedPayload;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
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
    const { method = 'GET', body, encryptedPayload, query, headers: extraHeaders } = options;

    const session = await this.authProvider.getSession();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
      ...extraHeaders,
    };

    if (session.sessionToken) {
      headers['X-Encryption-Token'] = session.sessionToken;
    }

    let requestBody: string | undefined;
    if (encryptedPayload && body) {
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

    const ctx: RequestContext = { method, path, url, headers, body: requestBody };
    for (const mw of this.onRequest) {
      await mw(ctx);
    }

    return retryWithBackoff(async () => {
      const start = Date.now();
      const response = await fetch(ctx.url, {
        method: ctx.method,
        headers: ctx.headers,
        body: ctx.body,
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

      return response.json() as Promise<T>;
    }, this.retryConfig);
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
