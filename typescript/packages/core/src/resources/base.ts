/**
 * Base resource class.
 *
 * Owns the shared HttpClient reference and provides typed convenience methods
 * for common HTTP operations. All resource classes extend this.
 *
 * Mirrors the matrix architecture's principle: "shared logic lives in the base class."
 */

import type { HttpClient, RequestOptions } from '../http/http-client.js';

export abstract class BaseResource {
  constructor(protected readonly http: HttpClient) {}

  /** POST a typed request body and return a typed response. */
  protected post<TRes>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<TRes> {
    return this.http.request<TRes>(path, { ...options, method: 'POST', body });
  }

  /** GET a typed response, with optional query parameters. */
  protected get<TRes>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<TRes> {
    return this.http.request<TRes>(path, { ...options, method: 'GET' });
  }

  /** PATCH a typed request body and return a typed response. */
  protected patch<TRes>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<TRes> {
    return this.http.request<TRes>(path, { ...options, method: 'PATCH', body });
  }

  /** DELETE a resource. */
  protected delete(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<unknown> {
    return this.http.request(path, { ...options, method: 'DELETE' });
  }
}
