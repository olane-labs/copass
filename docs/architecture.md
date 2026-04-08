# SDK Architecture

The Copass harness SDK is organized in four layers. Each language implementation follows this same structure.

## Layer Diagram

```
┌─────────────────────────────────────────────┐
│  CopassClient                               │  ← Public entry point
│  Composes resources with shared auth/config  │
├─────────────────────────────────────────────┤
│  Resources                                   │  ← One per API domain
│  extraction · cosync · matrix · projects     │
│  entities · plans · users · api-keys · usage │
├─────────────────────────────────────────────┤
│  HTTP Layer                                  │  ← Transport
│  Fetch-based client · retry · errors         │
├─────────────────────────────────────────────┤
│  Crypto Layer                                │  ← Security
│  AES-256-GCM · HKDF key derivation          │
│  Session token wrapping                      │
├─────────────────────────────────────────────┤
│  Auth Layer                                  │  ← Identity
│  API key · Bearer JWT · Supabase OTP         │
└─────────────────────────────────────────────┘
```

## CopassClient

The top-level entry point. Consumers create a single client instance and access backend services through typed resource properties.

```typescript
const client = new CopassClient({
  auth: { type: 'api-key', key: 'olk_...' },
  encryptionKey: 'optional-master-key',
});

await client.matrix.query({ query: '...' });
await client.cosync.score({ canonical_ids: ['...'] });
```

### Design: Stripe-style resource pattern

Each backend API domain is exposed as a resource object on the client. Resources are thin wrappers that:

1. Accept typed request parameters
2. Delegate to the shared HTTP client
3. Return typed response objects
4. Throw typed errors (`CopassApiError`)

This pattern scales cleanly -- adding a new API domain means adding one resource class and one types file.

## Resource Layer

Each resource maps to a group of related backend endpoints:

| Resource | Endpoints | Purpose |
|----------|-----------|---------|
| `extraction` | `/extract`, `/extract/code`, `/extract/file`, `/extract/jobs/*` | Ingest code, text, files |
| `cosync` | `/cosync` | Knowledge confidence scoring |
| `plans` | `/plans/cosync` | Plan-level knowledge scoring (v2) |
| `matrix` | `/matrix/query` | Natural language search |
| `projects` | `/projects/*` | Project registration and status |
| `entities` | `/users/me/canonical-entities/*` | Canonical entity management |
| `users` | `/users/me/profile` | User profile management |
| `apiKeys` | `/api-keys/*` | API key CRUD |
| `usage` | `/usage`, `/usage/balance` | Token consumption tracking |

## HTTP Layer

The internal HTTP client handles:

- **Auth header injection** -- `Authorization: Bearer <token>` from the configured auth provider
- **Encryption header** -- `X-Encryption-Token: <session-token>` when encryption is configured
- **Retry with backoff** -- Configurable exponential/linear/fixed backoff for transient failures
- **Error normalization** -- HTTP errors become typed `CopassApiError` instances with status, body, and request context
- **Content negotiation** -- JSON for most requests, multipart/form-data for file uploads

The HTTP layer uses the platform's native `fetch` (Node 18+, browsers, Deno, Cloudflare Workers).

## Crypto Layer

Implements the Copass encryption protocol (see [encryption.md](./encryption.md)):

- **AES-256-GCM** encryption/decryption for request payloads
- **HKDF-SHA256** key derivation for DEK and session token wrapping
- **Session token creation** -- wraps the DEK with an access-token-derived key

The crypto layer uses only platform-native crypto (`node:crypto` in Node.js, `SubtleCrypto` in browsers).

## Auth Layer

Three authentication strategies:

1. **API Key** -- simplest; pass `olk_` prefixed key as Bearer token
2. **Bearer JWT** -- pass a Supabase JWT directly (caller manages refresh)
3. **Supabase OTP** -- managed auth with automatic token refresh (email/phone OTP flow)

See [authentication.md](./authentication.md) for details on each flow.

## Design Principles

1. **No filesystem access in core** -- Configuration is passed via constructor, not read from disk. A separate utility can load `.olane/config.json` for Node.js environments.
2. **Minimal dependencies** -- Only `zod` for schema validation. Everything else uses platform built-ins.
3. **Environment agnostic** -- Works in Node.js, browsers, Deno, and edge runtimes.
4. **Encryption is optional** -- Endpoints that don't require encrypted payloads work without an encryption key.
5. **Typed end-to-end** -- Every request and response has TypeScript types. Errors are typed too.
