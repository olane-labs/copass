import { describe, it, expect } from 'vitest';
import { ApiKeyAuthProvider } from '../../../src/auth/api-key.js';
import { BearerAuthProvider } from '../../../src/auth/bearer.js';

describe('ApiKeyAuthProvider', () => {
  it('returns the API key as accessToken', async () => {
    const provider = new ApiKeyAuthProvider('olk_test_key_123');
    const session = await provider.getSession();

    expect(session.accessToken).toBe('olk_test_key_123');
    expect(session.sessionToken).toBeUndefined();
  });
});

describe('BearerAuthProvider', () => {
  it('returns the JWT as accessToken', async () => {
    const provider = new BearerAuthProvider('jwt-token-here');
    const session = await provider.getSession();

    expect(session.accessToken).toBe('jwt-token-here');
    expect(session.sessionToken).toBeUndefined();
  });

  it('generates session token when encryption key provided', async () => {
    const provider = new BearerAuthProvider('jwt-token', 'my-encryption-key');
    const session = await provider.getSession();

    expect(session.accessToken).toBe('jwt-token');
    expect(session.sessionToken).toBeDefined();
    expect(session.sessionToken).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('caches session token across calls', async () => {
    const provider = new BearerAuthProvider('jwt-token', 'my-key');
    const session1 = await provider.getSession();
    const session2 = await provider.getSession();

    expect(session1.sessionToken).toBe(session2.sessionToken);
  });
});
