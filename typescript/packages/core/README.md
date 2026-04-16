# @copass/harness

TypeScript client SDK for the [Copass](https://copass.id) knowledge graph platform.

## Installation

```bash
npm install @copass/harness
```

Requires Node.js >= 18.0.0.

## Usage

```typescript
import { CopassClient } from '@copass/harness';

const client = new CopassClient({
  auth: { type: 'api-key', key: 'olk_your_api_key' },
});

// Natural language search
const result = await client.matrix.query({
  query: 'How does authentication work?',
});

// Ingestion (auto-resolves caller's primary sandbox + default project)
const job = await client.ingest.text({
  text: 'const x = 1;',
  source_type: 'code',
});
const status = await client.ingest.getJob(job.job_id);
```

## Documentation

See the [main documentation](../docs/) for architecture, API reference, and guides.

## License

MIT
