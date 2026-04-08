/**
 * Active session context with resolved credentials.
 */
export interface SessionContext {
  /** The access token (JWT or API key) for Authorization header. */
  accessToken: string;
  /** The session token (wrapped DEK) for X-Encryption-Token header. Optional. */
  sessionToken?: string;
  /** User ID extracted from the token. */
  userId?: string;
}

/**
 * Interface for authentication providers.
 *
 * Each auth strategy (API key, bearer, Supabase) implements this interface.
 * The HTTP client calls `getSession()` before each request to get fresh credentials.
 */
export interface AuthProvider {
  /** Get the current session, refreshing if necessary. */
  getSession(): Promise<SessionContext>;
}
