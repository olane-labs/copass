# Getting Started

## Installation

### TypeScript / Node.js

```bash
npm install @copass/harness
```

Requires Node.js >= 18.0.0 (for native `fetch`).

## Create a Client

The simplest way to get started is with an API key:

```typescript
import { CopassClient } from '@copass/harness';

const client = new CopassClient({
  auth: { type: 'api-key', key: 'olk_your_api_key' },
});
```

### With encryption (for ingestion endpoints)

```typescript
const client = new CopassClient({
  auth: { type: 'api-key', key: 'olk_your_api_key' },
  encryptionKey: 'your-master-key',
});
```

### Custom API URL

```typescript
const client = new CopassClient({
  apiUrl: 'https://your-instance.example.com',
  auth: { type: 'api-key', key: 'olk_your_api_key' },
});
```

## Common Operations

### Ask a question (Matrix query)

```typescript
const result = await client.matrix.query({
  query: 'How does the authentication system work?',
});

console.log(result.answer);
```

### Score knowledge confidence (Cosync)

```typescript
const score = await client.cosync.score({
  canonical_ids: ['entity-uuid-here'],
});

console.log(score.aggregate_score); // 0.0 - 1.0
console.log(score.tier);            // 'safe' | 'review' | 'caution' | 'critical'
```

### Ingest code

```typescript
const result = await client.extraction.extractCode({
  code: readFileSync('src/auth.ts', 'utf-8'),
  language: 'typescript',
  file_path: 'src/auth.ts',
  project_id: 'your-project-id',
});

console.log(`Created ${result.event_count} events`);
```

### Register a project

```typescript
await client.projects.register({
  project_path: '/path/to/your/project',
  project_name: 'my-project',
  indexing_mode: 'full',
});
```

### Search entities

```typescript
const results = await client.entities.list();
```

## Error Handling

All API errors throw a `CopassApiError`:

```typescript
import { CopassApiError } from '@copass/harness';

try {
  await client.matrix.query({ query: '...' });
} catch (error) {
  if (error instanceof CopassApiError) {
    console.error(error.status);  // HTTP status code
    console.error(error.message); // Error message
    console.error(error.body);    // Raw error body
  }
}
```

## Next Steps

- [Architecture](./architecture.md) -- Understand the SDK design
- [API Surface](./api-surface.md) -- Full endpoint reference
- [Authentication](./authentication.md) -- Auth flow details
- [Encryption](./encryption.md) -- Encryption protocol for ingestion
