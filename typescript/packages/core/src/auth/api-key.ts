import type { AuthProvider, SessionContext } from './types.js';

/**
 * Auth provider for API key authentication.
 *
 * API keys (olk_ prefix) are long-lived and sent directly as Bearer tokens.
 * No session token is generated since API keys don't support DEK wrapping.
 */
export class ApiKeyAuthProvider implements AuthProvider {
  private readonly key: string;

  constructor(key: string) {
    this.key = key;
  }

  async getSession(): Promise<SessionContext> {
    return { accessToken: this.key };
  }
}
