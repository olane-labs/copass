export interface VaultStoreOptions {
  /** Encrypt the object before storing (requires encryption session). */
  encrypt?: boolean;
  /** Skip the write if identical content already exists in this sandbox. */
  deduplicate?: boolean;
  /** Content-Type to persist alongside the object. Defaults to application/octet-stream. */
  contentType?: string;
}

export interface VaultStoreResponse {
  key: string;
  full_key: string;
  size_bytes: number;
  encrypted: boolean;
  deduplicated?: boolean;
  is_duplicate?: boolean;
  content_hash?: string;
}

export interface VaultListOptions {
  prefix?: string;
  maxKeys?: number;
}

export interface VaultListResponse {
  keys: string[];
  count: number;
}

export interface VaultRetrieveOptions {
  /** If true (default), server decrypts before returning. Set to false to receive ciphertext. */
  decrypt?: boolean;
}
