/**
 * Client-side session token creation.
 *
 * Wraps the DEK (derived from copass_encryption_key) with a key derived from
 * the access token, producing an opaque base64 session token.
 *
 * Token format: base64(iv[12] + encrypted_dek[32] + tag[16])
 *
 * The backend API unwraps this using the same access token from the
 * Authorization header.
 */

import crypto from 'node:crypto';
import { WRAP_HKDF_SALT, WRAP_HKDF_INFO, DEK_HKDF_SALT, DEK_HKDF_INFO } from './constants.js';

function hkdfDerive(ikm: string, salt: string, info: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.hkdf(
      'sha256',
      Buffer.from(ikm, 'utf-8'),
      Buffer.from(salt, 'utf-8'),
      Buffer.from(info, 'utf-8'),
      32,
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(Buffer.from(derivedKey));
      },
    );
  });
}

/**
 * Derive the DEK from a master key using HKDF-SHA256.
 */
export function deriveDek(masterKey: string): Promise<Buffer> {
  return hkdfDerive(masterKey, DEK_HKDF_SALT, DEK_HKDF_INFO);
}

/**
 * Derive the wrap key from an access token using HKDF-SHA256.
 */
export function deriveWrapKey(accessToken: string): Promise<Buffer> {
  return hkdfDerive(accessToken, WRAP_HKDF_SALT, WRAP_HKDF_INFO);
}

/**
 * Create an opaque session token by wrapping the DEK with the access token.
 *
 * Steps:
 * 1. Derive DEK from masterKey via HKDF
 * 2. Derive wrapKey from accessToken via HKDF
 * 3. AES-256-GCM encrypt DEK with wrapKey
 * 4. Return base64(iv + encrypted_dek + tag)
 */
export async function createSessionToken(
  masterKey: string,
  accessToken: string,
): Promise<string> {
  const dek = await deriveDek(masterKey);
  const wrapKey = await deriveWrapKey(accessToken);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', wrapKey, iv);

  const encryptedDek = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Token format: iv (12) + encrypted_dek (32) + tag (16) = 60 bytes
  return Buffer.concat([iv, encryptedDek, tag]).toString('base64');
}
