/** Request to create a new API key. */
export interface CreateApiKeyRequest {
  name: string;
  expires_in_days?: number;
}

/** Response from creating an API key (raw key shown only once). */
export interface CreateApiKeyResponse {
  id: string;
  name: string;
  key: string;
  key_prefix: string;
  created_at: string;
  expires_at?: string;
  jwt_expires_at?: string;
  warning?: string;
}

/** API key info (masked). One row of the list response. */
export interface ApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  expires_at?: string;
  jwt_expires_at?: string;
  last_used_at?: string;
  use_count?: number;
  created_at: string;
  is_expired?: boolean;
  jwt_needs_refresh?: boolean;
}

/** Response from revoking an API key. */
export interface RevokeApiKeyResponse {
  revoked: boolean;
  id: string;
  name: string;
}
