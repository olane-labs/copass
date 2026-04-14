import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { deriveDek, deriveWrapKey, createSessionToken } from '../../../src/crypto/session-token.js';

describe('HKDF key derivation', () => {
  it('deriveDek produces a 32-byte buffer', async () => {
    const dek = await deriveDek('test-master-key');
    expect(dek).toBeInstanceOf(Buffer);
    expect(dek).toHaveLength(32);
  });

  it('deriveDek is deterministic', async () => {
    const a = await deriveDek('same-key');
    const b = await deriveDek('same-key');
    expect(a.equals(b)).toBe(true);
  });

  it('deriveDek produces different output for different keys', async () => {
    const a = await deriveDek('key-one');
    const b = await deriveDek('key-two');
    expect(a.equals(b)).toBe(false);
  });

  it('deriveWrapKey produces a 32-byte buffer', async () => {
    const wrapKey = await deriveWrapKey('fake-access-token');
    expect(wrapKey).toBeInstanceOf(Buffer);
    expect(wrapKey).toHaveLength(32);
  });

  it('deriveWrapKey is deterministic', async () => {
    const a = await deriveWrapKey('same-token');
    const b = await deriveWrapKey('same-token');
    expect(a.equals(b)).toBe(true);
  });
});

describe('session token', () => {
  it('creates a valid base64 session token', async () => {
    const token = await createSessionToken('master-key', 'access-token');
    expect(token).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('produces a 60-byte token (iv=12 + encrypted_dek=32 + tag=16)', async () => {
    const token = await createSessionToken('master-key', 'access-token');
    const bytes = Buffer.from(token, 'base64');
    expect(bytes).toHaveLength(60);
  });

  it('produces different tokens for different access tokens', async () => {
    const a = await createSessionToken('master-key', 'token-a');
    const b = await createSessionToken('master-key', 'token-b');
    expect(a).not.toBe(b);
  });

  it('produces different tokens each call (random IV)', async () => {
    const a = await createSessionToken('key', 'token');
    const b = await createSessionToken('key', 'token');
    expect(a).not.toBe(b);
  });

  it('session token can be unwrapped with the same access token', async () => {
    const masterKey = 'test-master-key-123';
    const accessToken = 'test-access-token-456';

    const sessionToken = await createSessionToken(masterKey, accessToken);
    const tokenBytes = Buffer.from(sessionToken, 'base64');

    // Parse token: iv(12) + encrypted_dek(32) + tag(16)
    const iv = tokenBytes.subarray(0, 12);
    const encryptedDek = tokenBytes.subarray(12, 44);
    const tag = tokenBytes.subarray(44, 60);

    // Derive the same wrap key
    const wrapKey = await deriveWrapKey(accessToken);

    // Decrypt
    const decipher = crypto.createDecipheriv('aes-256-gcm', wrapKey, iv);
    decipher.setAuthTag(tag);
    const decryptedDek = Buffer.concat([decipher.update(encryptedDek), decipher.final()]);

    // The decrypted DEK should match what deriveDek produces
    const expectedDek = await deriveDek(masterKey);
    expect(decryptedDek.equals(expectedDek)).toBe(true);
  });
});
