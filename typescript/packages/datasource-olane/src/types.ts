export interface OlaneTokenManagerOptions {
  /** Current Supabase access token (seeded on first call to acquireToken). */
  accessToken: string;
  /** Supabase refresh token; used to acquire fresh access tokens. */
  refreshToken: string;
  /** Full URL of the Supabase token endpoint, e.g. `https://<proj>.supabase.co/auth/v1/token?grant_type=refresh_token`. */
  tokenEndpoint: string;
  /** Extra headers to include on every refresh (e.g. `{ apikey: SUPABASE_ANON_KEY }`). */
  headers?: Record<string, string>;
  /** Epoch seconds when the seed access token expires. Optional. */
  expiresAt?: number;
  /** How many ms of headroom to trigger a refresh before expiry. */
  refreshBufferMs?: number;
}

export interface WorldRecord {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  supportedTypes: string[];
  members: unknown[];
  createdAt: string;
}

export interface WorldAddressEntry {
  address: string;
  type: string;
  registeredAt: string;
}

export interface WorldFile {
  config: WorldRecord;
  addresses: WorldAddressEntry[];
}

export interface CreateWorldOptions {
  name: string;
  description?: string;
  icon?: string;
  /** Defaults to `['filepath']`. */
  supportedTypes?: string[];
}

export interface StartLocalOsOptions {
  /** OS instance name (usually the caller's Copass ID). */
  instanceName: string;
  /** Port to listen on; auto-assigns starting at 4999 if omitted. */
  port?: number;
  /** Skip the network-wide index advertisement. Defaults to `true`. */
  noIndexNetwork?: boolean;
  /** Path to the CLI entrypoint used to respawn in `_run` mode. Defaults to `process.argv[1]`. */
  cliEntry?: string;
  /** Directory to write logs into. Defaults to `<DEFAULT_CONFIG_PATH>/logs`. */
  logsDir?: string;
  /** Max bytes before rotating `os.log` → `os.log.1`. Defaults to 10 MB. */
  logMaxBytes?: number;
  /** Extra env vars to set on the spawned child. */
  env?: Record<string, string>;
  /** How long to wait after spawn before checking status. Defaults to 2000 ms. */
  startupWaitMs?: number;
}

export interface StartLocalOsResult {
  instanceName: string;
  pid?: number;
  port?: number;
  peerId?: string;
  logFile: string;
  /** True if the process is responding on `statusOS` within `startupWaitMs`. */
  alive: boolean;
}

export interface RunLocalOsOptions {
  instanceName: string;
  port?: number;
  noIndexNetwork?: boolean;
  /** Optional pre-built token manager. If omitted, no token manager is wired into the OS. */
  tokenManager?: unknown;
}

export interface CreateAddressResult {
  /** The o:// address value. */
  address: string;
  /** Worlds in this OS (used for duplicate detection + UX selection). */
  worlds: Array<{ id: string; name: string; file: string }>;
  /** Set when the current cwd is already registered in one of the worlds. */
  duplicateInWorld?: { id: string; name: string };
}
