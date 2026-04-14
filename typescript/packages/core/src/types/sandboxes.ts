export type SandboxTier = 'free' | 'pro' | 'enterprise';
export type SandboxStatus = 'active' | 'suspended' | 'archived';
export type SandboxStorageProvider = 'platform_s3' | 'custom_s3';

export interface SandboxLimits {
  max_data_sources: number;
  max_projects: number;
  max_storage_bytes: number;
  [key: string]: unknown;
}

export interface Sandbox {
  sandbox_id: string;
  user_id: string;
  owner_id: string;
  name: string;
  tier: SandboxTier;
  status: SandboxStatus;
  storage_provider_type: SandboxStorageProvider;
  limits: SandboxLimits;
  metadata: Record<string, unknown>;
  created_at?: string;
}

export interface CreateSandboxRequest {
  name: string;
  owner_id: string;
  tier?: SandboxTier;
  metadata?: Record<string, unknown>;
}

export interface UpdateSandboxRequest {
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface ListSandboxesOptions {
  status?: SandboxStatus;
  owner_id?: string;
}

export interface SandboxListResponse {
  sandboxes: Sandbox[];
  count: number;
}

export interface StatusResponse {
  success: boolean;
  message?: string;
}
