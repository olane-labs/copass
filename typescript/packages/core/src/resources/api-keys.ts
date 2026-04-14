import { BaseResource } from './base.js';
import type {
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  ApiKeyInfo,
} from '../types/api-keys.js';

/**
 * API Keys resource — manage API keys.
 */
export class ApiKeysResource extends BaseResource {
  async create(request: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    return this.post<CreateApiKeyResponse>('/api/v1/api-keys', request);
  }

  async list(): Promise<ApiKeyInfo[]> {
    return this.get<ApiKeyInfo[]>('/api/v1/api-keys');
  }

  async revoke(keyId: string): Promise<void> {
    await this.delete(`/api/v1/api-keys/${keyId}`);
  }
}
