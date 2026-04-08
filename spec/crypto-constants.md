# Crypto Constants

Every language SDK MUST use these exact byte values for HKDF key derivation. A mismatch in any constant will cause decryption failures on the server.

## Session Token Wrapping

Used to derive the wrap key from the Supabase access token, which then encrypts the DEK for transport.

| Constant | String Value | Encoding |
|----------|-------------|----------|
| `WRAP_HKDF_SALT` | `olane-session-wrap-v1` | UTF-8 |
| `WRAP_HKDF_INFO` | `olane-wrap` | UTF-8 |

## DEK Derivation

Used to derive the Data Encryption Key from the user's master key.

| Constant | String Value | Encoding |
|----------|-------------|----------|
| `DEK_HKDF_SALT` | `olane-twin-brain-dek-v1` | UTF-8 |
| `DEK_HKDF_INFO` | `olane-dek` | UTF-8 |

## Reference Implementations

- **TypeScript:** `o-network-cli/src/crypto/constants.ts`
- **Python:** `frame_graph/crypto_constants.py`

## Verification

To verify your implementation, derive a wrap key from a known access token and compare against the reference implementations. The HKDF output must be byte-identical across all SDKs.
