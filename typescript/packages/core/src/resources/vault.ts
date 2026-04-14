import { BaseResource } from './base.js';
import type {
  VaultStoreOptions,
  VaultStoreResponse,
  VaultListOptions,
  VaultListResponse,
  VaultRetrieveOptions,
} from '../types/vault.js';
import type { StatusResponse } from '../types/sandboxes.js';

const base = (sandboxId: string) => `/api/v1/storage/sandboxes/${sandboxId}/vault`;

function encodeKey(key: string): string {
  // Preserve `/` as path separator; encode everything else. The server matches /{key:path}.
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Vault resource — encrypted object storage scoped to a sandbox.
 *
 * Stores raw bytes under an arbitrary key path. Supports optional per-object
 * encryption (requires an encryption session) and content-hash deduplication.
 */
export class VaultResource extends BaseResource {
  async store(
    sandboxId: string,
    key: string,
    data: Uint8Array | ArrayBuffer | Blob,
    options: VaultStoreOptions = {},
  ): Promise<VaultStoreResponse> {
    return this.http.request<VaultStoreResponse>(
      `${base(sandboxId)}/${encodeKey(key)}`,
      {
        method: 'PUT',
        rawBody: data,
        headers: { 'Content-Type': options.contentType ?? 'application/octet-stream' },
        query: {
          encrypt: options.encrypt ? 'true' : undefined,
          deduplicate: options.deduplicate ? 'true' : undefined,
        },
      },
    );
  }

  async retrieve(
    sandboxId: string,
    key: string,
    options: VaultRetrieveOptions = {},
  ): Promise<Uint8Array> {
    return this.http.request<Uint8Array>(`${base(sandboxId)}/${encodeKey(key)}`, {
      method: 'GET',
      rawResponse: true,
      query: { decrypt: options.decrypt === false ? 'false' : undefined },
    });
  }

  async del(sandboxId: string, key: string): Promise<StatusResponse> {
    return this.delete<StatusResponse>(`${base(sandboxId)}/${encodeKey(key)}`);
  }

  async list(sandboxId: string, options: VaultListOptions = {}): Promise<VaultListResponse> {
    return this.get<VaultListResponse>(base(sandboxId), {
      query: {
        prefix: options.prefix,
        max_keys: options.maxKeys !== undefined ? String(options.maxKeys) : undefined,
      },
    });
  }
}
