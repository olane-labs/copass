import { oTokenManager, RefreshTokenProvider } from '@olane/o-core';
import type { OlaneTokenManagerOptions } from './types.js';

/**
 * Build an `oTokenManager` from a live Supabase session.
 *
 * Uses the "seeding" pattern: the first call to `acquireToken` returns the
 * supplied access token as-is; subsequent calls hit the token endpoint with
 * the refresh token. This mirrors the pattern used by Olane cloud lambdas.
 *
 * @example
 * ```ts
 * const tm = createOlaneTokenManager({
 *   accessToken:  session.access_token,
 *   refreshToken: session.refresh_token,
 *   tokenEndpoint: `https://${projectId}.supabase.co/auth/v1/token?grant_type=refresh_token`,
 *   headers: { apikey: SUPABASE_ANON_KEY },
 *   expiresAt: session.expires_at,
 * });
 * ```
 */
export function createOlaneTokenManager(options: OlaneTokenManagerOptions): oTokenManager {
  const {
    accessToken,
    refreshToken,
    tokenEndpoint,
    headers,
    expiresAt,
    refreshBufferMs = 60_000,
  } = options;

  const refreshProvider = new RefreshTokenProvider({
    tokenEndpoint,
    refreshToken,
    headers,
  });

  let seeded = false;
  const seedingProvider = {
    async acquireToken() {
      if (!seeded) {
        seeded = true;
        return { token: accessToken, expiresAt };
      }
      return refreshProvider.acquireToken();
    },
    updateRefreshToken(token: string) {
      refreshProvider.updateRefreshToken(token);
    },
  };

  return new oTokenManager({
    provider: seedingProvider,
    autoRefresh: true,
    refreshBufferMs,
  });
}
