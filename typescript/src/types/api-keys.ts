/** Request to create a new API key. */
export interface CreateApiKeyRequest {
  name: string;
  expires_in_days?: number;
}

/** Response from creating an API key (raw key shown only once). */
export interface CreateApiKeyResponse {
  key_id: string;
  key: string;
  name: string;
  created_at: string;
}

/** API key info (masked). */
export interface ApiKeyInfo {
  key_id: string;
  name: string;
  prefix: string;
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
}
