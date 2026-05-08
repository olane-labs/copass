import { BaseResource } from './base.js';
import type {
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  ApiKeyInfo,
  RevokeApiKeyResponse,
} from '../types/api-keys.js';

/**
 * API Keys resource — manage user-wide API keys.
 *
 * Connection-scoped keys are issued separately via
 * ``POST /sandboxes/{id}/connections/{connection_id}/api-keys`` —
 * see ``SandboxConnectionsResource.spawnApiKey``.
 */
export class ApiKeysResource extends BaseResource {
  async create(request: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    return this.post<CreateApiKeyResponse>('/api/v1/api-keys', request);
  }

  async list(): Promise<ApiKeyInfo[]> {
    return this.get<ApiKeyInfo[]>('/api/v1/api-keys');
  }

  async revoke(keyId: string): Promise<RevokeApiKeyResponse> {
    return this.delete<RevokeApiKeyResponse>(`/api/v1/api-keys/${keyId}`);
  }
}
