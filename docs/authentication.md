# Authentication

The Copass API supports three authentication methods. All methods result in a Bearer token sent in the `Authorization` header.

## API Key Authentication

The simplest method. Create an API key via the dashboard or API, then pass it directly.

```typescript
const client = new CopassClient({
  auth: { type: 'api-key', key: 'olk_your_api_key_here' },
});
```

**How it works:**
1. API keys have the `olk_` prefix
2. Sent as `Authorization: Bearer olk_...`
3. Server validates via bcrypt hash comparison
4. No refresh needed -- keys are long-lived (configurable expiry)

**Best for:** Server-side applications, CI/CD pipelines, scripts.

## Bearer JWT Authentication

Pass a Supabase JWT token directly. You manage token lifecycle.

```typescript
const client = new CopassClient({
  auth: { type: 'bearer', token: supabaseAccessToken },
});
```

**How it works:**
1. JWT from Supabase auth is sent as `Authorization: Bearer <jwt>`
2. Server validates via JWKS (Supabase public keys)
3. Token contains `sub` claim (user_id)
4. Short-lived (~1 hour) -- caller must refresh

**Best for:** Applications that already use Supabase auth.

## Supabase OTP Authentication (Planned)

Managed authentication with automatic token refresh. The SDK handles the full OTP flow.

```typescript
const client = new CopassClient({
  auth: { type: 'supabase', email: 'user@example.com' },
});

// SDK sends OTP, prompts for code, manages refresh
await client.auth.login();
```

**Flow:**
1. SDK sends OTP to email/phone via Supabase GoTrue API
2. User provides the 6-digit code
3. SDK exchanges code for session (access_token + refresh_token)
4. SDK automatically refreshes before expiry

**Best for:** CLI tools, interactive applications.

## Encryption Header

For endpoints that accept encrypted payloads, an additional header is required:

```
X-Encryption-Token: <base64-session-token>
```

The session token is created by wrapping the Data Encryption Key (DEK) with an access-token-derived key. See [encryption.md](./encryption.md) for the full protocol.

This header is automatically set by the SDK when `encryptionKey` is provided:

```typescript
const client = new CopassClient({
  auth: { type: 'api-key', key: 'olk_...' },
  encryptionKey: 'your-master-key',
});
```

## Auth Resolution

The SDK resolves auth configuration to HTTP headers on every request:

| Auth Type | `Authorization` Header | Refresh |
|-----------|----------------------|---------|
| `api-key` | `Bearer olk_...` | None needed |
| `bearer` | `Bearer <jwt>` | Caller manages |
| `supabase` | `Bearer <jwt>` | Auto-refresh |
