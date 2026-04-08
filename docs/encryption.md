# Encryption Protocol

The Copass API supports client-side encryption of request payloads using AES-256-GCM. This document specifies the exact protocol that all language SDKs must implement.

## Overview

```
Master Key (user secret)
    │
    ▼ HKDF-SHA256
Data Encryption Key (DEK)
    │
    ├──▶ AES-256-GCM encrypt payload → { encrypted_text, iv, tag }
    │
    └──▶ Wrap DEK with access token → session_token (sent as header)
```

## Key Derivation

### DEK from Master Key

The Data Encryption Key is derived from the user's master key using HKDF-SHA256:

```
DEK = HKDF-SHA256(
  ikm:  master_key (UTF-8 bytes),
  salt: "olane-twin-brain-dek-v1" (UTF-8 bytes),
  info: "olane-dek" (UTF-8 bytes),
  len:  32 bytes
)
```

### Session Token (DEK Wrapping)

The DEK is wrapped for transport using an access-token-derived key:

**Step 1:** Derive the wrap key from the access token:
```
wrap_key = HKDF-SHA256(
  ikm:  access_token (UTF-8 bytes),
  salt: "olane-session-wrap-v1" (UTF-8 bytes),
  info: "olane-wrap" (UTF-8 bytes),
  len:  32 bytes
)
```

**Step 2:** Encrypt the DEK with the wrap key using AES-256-GCM:
```
iv = random 12 bytes
{ ciphertext, tag } = AES-256-GCM-encrypt(key=wrap_key, iv=iv, plaintext=DEK)
```

**Step 3:** Concatenate and base64-encode:
```
session_token = base64(iv[12] || ciphertext[32] || tag[16])
```

The session token is sent as the `X-Encryption-Token` header.

## Payload Encryption

To encrypt a request payload field (e.g., `text`):

**Step 1:** Generate a random 12-byte IV.

**Step 2:** Encrypt the plaintext with AES-256-GCM:
```
{ ciphertext, tag } = AES-256-GCM-encrypt(key=DEK, iv=iv, plaintext=text_bytes)
```

**Step 3:** Base64-encode all components:
```json
{
  "encrypted_text": base64(ciphertext),
  "encryption_iv": base64(iv),
  "encryption_tag": base64(tag)
}
```

These fields replace the plaintext `text` field in the request body.

## Crypto Constants

All SDKs MUST use these exact constants (see also `spec/crypto-constants.md`):

| Constant | Value (UTF-8) | Used For |
|----------|---------------|----------|
| `WRAP_HKDF_SALT` | `olane-session-wrap-v1` | Deriving wrap key from access token |
| `WRAP_HKDF_INFO` | `olane-wrap` | Deriving wrap key from access token |
| `DEK_HKDF_SALT` | `olane-twin-brain-dek-v1` | Deriving DEK from master key |
| `DEK_HKDF_INFO` | `olane-dek` | Deriving DEK from master key |

## Algorithm Parameters

| Parameter | Value |
|-----------|-------|
| Key derivation | HKDF-SHA256 |
| Encryption | AES-256-GCM |
| Key length | 256 bits (32 bytes) |
| IV length | 96 bits (12 bytes) |
| Auth tag length | 128 bits (16 bytes) |
| Encoding | Base64 (standard, with padding) |

## When Encryption is Required

Encryption is optional for most endpoints. When provided:
- The `X-Encryption-Token` header enables the server to decrypt
- Request bodies use `encrypted_text` instead of `text`
- The server decrypts before processing

Endpoints that never require encryption: project status, entity listing, usage, API key management.

## Reference Implementations

- **TypeScript:** `o-network-cli/src/crypto/` (Node.js `crypto` module)
- **Python:** `frame_graph/crypto_constants.py` + `frame_graph/api/utils/session_token.py`
