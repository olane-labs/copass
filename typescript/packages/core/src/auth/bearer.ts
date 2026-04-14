import type { AuthProvider, SessionContext } from './types.js';
import { createSessionToken } from '../crypto/session-token.js';

/**
 * Auth provider for raw Bearer JWT authentication.
 *
 * The caller provides a JWT directly and is responsible for refreshing it.
 * If an encryption key is provided, a session token is derived automatically.
 */
export class BearerAuthProvider implements AuthProvider {
  private readonly token: string;
  private readonly encryptionKey?: string;
  private cachedSessionToken?: string;

  constructor(token: string, encryptionKey?: string) {
    this.token = token;
    this.encryptionKey = encryptionKey;
  }

  async getSession(): Promise<SessionContext> {
    let sessionToken: string | undefined;

    if (this.encryptionKey) {
      if (!this.cachedSessionToken) {
        this.cachedSessionToken = await createSessionToken(this.encryptionKey, this.token);
      }
      sessionToken = this.cachedSessionToken;
    }

    return { accessToken: this.token, sessionToken };
  }
}
