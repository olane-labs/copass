import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseAuthProvider } from '../../../src/auth/supabase.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseOptions = {
  supabaseUrl: 'https://auth.example.com',
  supabaseAnonKey: 'test-anon-key',
};

describe('SupabaseAuthProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('sendOtp', () => {
    it('sends OTP to the correct endpoint', async () => {
      mockFetch.mockResolvedValue(jsonResponse({}));
      const provider = new SupabaseAuthProvider(baseOptions);

      await provider.sendOtp('user@example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.example.com/auth/v1/otp',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'user@example.com' }),
        }),
      );
    });

    it('includes apikey header', async () => {
      mockFetch.mockResolvedValue(jsonResponse({}));
      const provider = new SupabaseAuthProvider(baseOptions);

      await provider.sendOtp('user@example.com');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.apikey).toBe('test-anon-key');
    });

    it('throws on failure', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'rate limited' }, 429));
      const provider = new SupabaseAuthProvider(baseOptions);

      await expect(provider.sendOtp('user@example.com')).rejects.toThrow('Failed to send OTP');
    });
  });

  describe('verifyOtp', () => {
    const mockSession = {
      access_token: 'jwt-token-123',
      refresh_token: 'refresh-456',
      expires_in: 3600,
      user: { id: 'user-id-789', email: 'user@example.com' },
    };

    it('verifies OTP and returns session', async () => {
      mockFetch.mockResolvedValue(jsonResponse(mockSession));
      const provider = new SupabaseAuthProvider(baseOptions);

      const session = await provider.verifyOtp('user@example.com', '123456');

      expect(session.access_token).toBe('jwt-token-123');
      expect(session.user.id).toBe('user-id-789');
      expect(provider.isAuthenticated).toBe(true);
    });

    it('calls onTokensChanged callback', async () => {
      mockFetch.mockResolvedValue(jsonResponse(mockSession));
      const onTokensChanged = vi.fn();
      const provider = new SupabaseAuthProvider({ ...baseOptions, onTokensChanged });

      await provider.verifyOtp('user@example.com', '123456');

      expect(onTokensChanged).toHaveBeenCalledWith({
        access_token: 'jwt-token-123',
        refresh_token: 'refresh-456',
      });
    });

    it('throws on invalid OTP', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'invalid' }, 401));
      const provider = new SupabaseAuthProvider(baseOptions);

      await expect(provider.verifyOtp('user@example.com', 'wrong')).rejects.toThrow(
        'OTP verification failed',
      );
    });
  });

  describe('getSession', () => {
    it('throws when not authenticated', async () => {
      const provider = new SupabaseAuthProvider(baseOptions);
      await expect(provider.getSession()).rejects.toThrow('Not authenticated');
    });

    it('returns session context after login', async () => {
      const mockSession = {
        access_token: 'jwt-123',
        refresh_token: 'refresh-456',
        expires_in: 3600,
        user: { id: 'uid' },
      };
      mockFetch.mockResolvedValue(jsonResponse(mockSession));
      const provider = new SupabaseAuthProvider(baseOptions);

      await provider.verifyOtp('user@example.com', '123456');
      const ctx = await provider.getSession();

      expect(ctx.accessToken).toBe('jwt-123');
      expect(ctx.userId).toBe('uid');
    });

    it('generates session token with encryption key', async () => {
      const mockSession = {
        access_token: 'jwt-123',
        refresh_token: 'refresh-456',
        expires_in: 3600,
        user: { id: 'uid' },
      };
      mockFetch.mockResolvedValue(jsonResponse(mockSession));
      const provider = new SupabaseAuthProvider({
        ...baseOptions,
        encryptionKey: 'my-master-key',
      });

      await provider.verifyOtp('user@example.com', '123456');
      const ctx = await provider.getSession();

      expect(ctx.sessionToken).toBeDefined();
      expect(ctx.sessionToken).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });
  });

  describe('refreshSession', () => {
    it('refreshes tokens', async () => {
      const initialSession = {
        access_token: 'old-jwt',
        refresh_token: 'old-refresh',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) - 100, // expired
        user: { id: 'uid' },
      };
      const refreshedSession = {
        access_token: 'new-jwt',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        user: { id: 'uid' },
      };

      const provider = new SupabaseAuthProvider(baseOptions);
      provider.setSession(initialSession);

      mockFetch.mockResolvedValue(jsonResponse(refreshedSession));

      // getSession should auto-refresh since token is expired
      const ctx = await provider.getSession();
      expect(ctx.accessToken).toBe('new-jwt');
    });

    it('throws when no refresh token', async () => {
      const provider = new SupabaseAuthProvider(baseOptions);
      await expect(provider.refreshSession()).rejects.toThrow('No refresh token');
    });
  });

  describe('setSession', () => {
    it('sets session from stored tokens', async () => {
      const provider = new SupabaseAuthProvider(baseOptions);
      provider.setSession({
        access_token: 'stored-jwt',
        refresh_token: 'stored-refresh',
        expires_in: 3600,
        user: { id: 'uid' },
      });

      expect(provider.isAuthenticated).toBe(true);
      expect(provider.userId).toBe('uid');
    });
  });
});
