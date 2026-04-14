/**
 * AES-256-GCM encryption for request payloads.
 */

import crypto from 'node:crypto';

export interface EncryptedPayload {
  encrypted_text: string;
  encryption_iv: string;
  encryption_tag: string;
}

/**
 * Encrypt plaintext with AES-256-GCM, returning base64-encoded fields
 * suitable for inclusion in API request bodies.
 */
export function encryptAesGcm(plaintext: string, dek: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted_text: encrypted.toString('base64'),
    encryption_iv: iv.toString('base64'),
    encryption_tag: tag.toString('base64'),
  };
}

/**
 * Decrypt an AES-256-GCM encrypted payload.
 */
export function decryptAesGcm(payload: EncryptedPayload, dek: Buffer): string {
  const iv = Buffer.from(payload.encryption_iv, 'base64');
  const tag = Buffer.from(payload.encryption_tag, 'base64');
  const encrypted = Buffer.from(payload.encrypted_text, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
}
