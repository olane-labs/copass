import type {
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  ApiKeyInfo,
} from '../types/api-keys.js';

/**
 * API Keys resource — manage API keys.
 *
 * Endpoints: POST /api-keys, GET /api-keys, DELETE /api-keys/{id}
 */
export interface ApiKeysResource {
  /** Create a new API key. The raw key is only returned once. */
  create(request: CreateApiKeyRequest): Promise<CreateApiKeyResponse>;

  /** List API keys (masked). */
  list(): Promise<ApiKeyInfo[]>;

  /** Revoke an API key. */
  revoke(keyId: string): Promise<void>;
}
