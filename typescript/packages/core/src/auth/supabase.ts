/**
 * Supabase OTP authentication provider.
 *
 * Implements the Supabase GoTrue OTP flow using raw fetch — no @supabase/supabase-js dependency.
 * Handles: send OTP, verify OTP, refresh tokens, and session token derivation.
 */

import type { AuthProvider, SessionContext } from './types.js';
import { createSessionToken } from '../crypto/session-token.js';

export interface SupabaseAuthOptions {
  /** Supabase project URL (e.g., 'https://auth.copass.com'). */
  supabaseUrl: string;
  /** Supabase publishable anon key. */
  supabaseAnonKey: string;
  /** Master encryption key for session token derivation. Optional. */
  encryptionKey?: string;
  /**
   * Callback to persist tokens after login or refresh.
   * Called with { access_token, refresh_token } whenever tokens change.
   */
  onTokensChanged?: (tokens: { access_token: string; refresh_token: string }) => void | Promise<void>;
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  user: {
    id: string;
    email?: string;
    phone?: string;
  };
}

export class SupabaseAuthProvider implements AuthProvider {
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;
  private readonly encryptionKey?: string;
  private readonly onTokensChanged?: SupabaseAuthOptions['onTokensChanged'];

  private session: SupabaseSession | null = null;
  private cachedSessionToken?: string;
  private cachedForAccessToken?: string;

  constructor(options: SupabaseAuthOptions) {
    this.supabaseUrl = options.supabaseUrl.replace(/\/+$/, '');
    this.supabaseAnonKey = options.supabaseAnonKey;
    this.encryptionKey = options.encryptionKey;
    this.onTokensChanged = options.onTokensChanged;
  }

  /**
   * Send a one-time password to the given email.
   */
  async sendOtp(email: string): Promise<void> {
    const response = await fetch(`${this.supabaseUrl}/auth/v1/otp`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Failed to send OTP: ${response.status} ${body}`);
    }
  }

  /**
   * Verify the OTP code and establish a session.
   * Returns the session with access and refresh tokens.
   */
  async verifyOtp(email: string, otp: string): Promise<SupabaseSession> {
    const response = await fetch(
      `${this.supabaseUrl}/auth/v1/token?grant_type=otp`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ email, token: otp, type: 'email' }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OTP verification failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as SupabaseSession;
    this.session = data;
    this.invalidateSessionTokenCache();
    await this.onTokensChanged?.({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    return data;
  }

  /**
   * Set an existing session (e.g., from stored tokens).
   */
  setSession(session: SupabaseSession): void {
    this.session = session;
    this.invalidateSessionTokenCache();
  }

  /**
   * Refresh the session using the stored refresh token.
   */
  async refreshSession(): Promise<SupabaseSession> {
    if (!this.session?.refresh_token) {
      throw new Error('No refresh token available. Call sendOtp/verifyOtp first.');
    }

    const response = await fetch(
      `${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ refresh_token: this.session.refresh_token }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Token refresh failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as SupabaseSession;
    this.session = data;
    this.invalidateSessionTokenCache();
    await this.onTokensChanged?.({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    return data;
  }

  /**
   * Get the current session, auto-refreshing if expired.
   * Implements the AuthProvider interface.
   */
  async getSession(): Promise<SessionContext> {
    if (!this.session) {
      throw new Error('Not authenticated. Call sendOtp/verifyOtp first.');
    }

    // Auto-refresh if token is expired or about to expire (60s buffer)
    if (this.isExpired()) {
      await this.refreshSession();
    }

    let sessionToken: string | undefined;
    if (this.encryptionKey && this.session) {
      // Cache session token per access token
      if (this.cachedForAccessToken !== this.session.access_token) {
        this.cachedSessionToken = await createSessionToken(
          this.encryptionKey,
          this.session.access_token,
        );
        this.cachedForAccessToken = this.session.access_token;
      }
      sessionToken = this.cachedSessionToken;
    }

    return {
      accessToken: this.session!.access_token,
      sessionToken,
      userId: this.session!.user.id,
    };
  }

  /** Check if the current session has an active token. */
  get isAuthenticated(): boolean {
    return this.session !== null;
  }

  /** Get the current user ID, if authenticated. */
  get userId(): string | undefined {
    return this.session?.user.id;
  }

  private isExpired(): boolean {
    if (!this.session?.expires_at) return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    return nowSeconds >= this.session.expires_at - 60;
  }

  private invalidateSessionTokenCache(): void {
    this.cachedSessionToken = undefined;
    this.cachedForAccessToken = undefined;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey,
    };
  }
}
