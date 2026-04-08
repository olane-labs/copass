/**
 * Shared cryptographic constants for session token wrapping and DEK derivation.
 *
 * These values MUST match the server-side constants in frame_graph/crypto_constants.py.
 * See spec/crypto-constants.md for the full specification.
 */

// Session token wrapping (access-token -> wrap key)
export const WRAP_HKDF_SALT = 'olane-session-wrap-v1';
export const WRAP_HKDF_INFO = 'olane-wrap';

// DEK derivation (master key -> data encryption key)
export const DEK_HKDF_SALT = 'olane-twin-brain-dek-v1';
export const DEK_HKDF_INFO = 'olane-dek';
