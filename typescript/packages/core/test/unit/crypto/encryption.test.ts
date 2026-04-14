import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { encryptAesGcm, decryptAesGcm } from '../../../src/crypto/encryption.js';

describe('AES-256-GCM encryption', () => {
  const dek = crypto.randomBytes(32);

  it('encrypts and decrypts plaintext roundtrip', () => {
    const plaintext = 'Hello, Copass knowledge graph!';
    const encrypted = encryptAesGcm(plaintext, dek);
    const decrypted = decryptAesGcm(encrypted, dek);

    expect(decrypted).toBe(plaintext);
  });

  it('returns base64-encoded fields', () => {
    const encrypted = encryptAesGcm('test', dek);

    expect(encrypted.encrypted_text).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(encrypted.encryption_iv).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(encrypted.encryption_tag).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('produces 12-byte IV and 16-byte tag', () => {
    const encrypted = encryptAesGcm('test', dek);

    expect(Buffer.from(encrypted.encryption_iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(encrypted.encryption_tag, 'base64')).toHaveLength(16);
  });

  it('produces different ciphertexts for same plaintext (random IV)', () => {
    const a = encryptAesGcm('same input', dek);
    const b = encryptAesGcm('same input', dek);

    expect(a.encrypted_text).not.toBe(b.encrypted_text);
    expect(a.encryption_iv).not.toBe(b.encryption_iv);
  });

  it('fails to decrypt with wrong key', () => {
    const wrongDek = crypto.randomBytes(32);
    const encrypted = encryptAesGcm('secret', dek);

    expect(() => decryptAesGcm(encrypted, wrongDek)).toThrow();
  });

  it('handles empty string', () => {
    const encrypted = encryptAesGcm('', dek);
    const decrypted = decryptAesGcm(encrypted, dek);
    expect(decrypted).toBe('');
  });

  it('handles unicode text', () => {
    const text = 'Unicode test: \u{1F680} \u{1F30D} \u00E9\u00E8\u00EA';
    const encrypted = encryptAesGcm(text, dek);
    const decrypted = decryptAesGcm(encrypted, dek);
    expect(decrypted).toBe(text);
  });
});
