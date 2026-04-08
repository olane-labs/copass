# copass-harness

Open-source client SDK for the [Copass](https://copass.id) knowledge graph platform. Provides typed, multi-language libraries for authentication, encrypted ingestion, knowledge scoring, and natural language querying.

## Language SDKs

| Language | Package | Status |
|----------|---------|--------|
| TypeScript | [`@copass/harness`](./typescript/) | In development |
| Python | [`copass-harness`](./python/) | Planned |

## Quick Start (TypeScript)

```bash
npm install @copass/harness
```

```typescript
import { CopassClient } from '@copass/harness';

const client = new CopassClient({
  auth: { type: 'api-key', key: 'olk_your_api_key' },
});

// Natural language search
const result = await client.matrix.query({ query: 'How does authentication work?' });

// Knowledge scoring
const score = await client.cosync.score({ canonical_ids: ['entity-uuid'] });

// Code ingestion
await client.extraction.extractCode({
  code: 'function hello() { return "world"; }',
  language: 'typescript',
});
```

## Documentation

- [Architecture](./docs/architecture.md) -- SDK layered design
- [API Surface](./docs/api-surface.md) -- Complete backend endpoint catalog
- [Authentication](./docs/authentication.md) -- Auth flows (API key, JWT, Supabase OTP)
- [Encryption](./docs/encryption.md) -- AES-256-GCM protocol and key derivation
- [Getting Started](./docs/getting-started.md) -- Installation and first steps

## Repository Structure

```
copass-harness/
  docs/          Language-agnostic documentation
  spec/          Shared contracts (crypto constants, API specs)
  typescript/    TypeScript SDK
  python/        Python SDK (planned)
  examples/      Usage examples per language
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

MIT -- see [LICENSE](./LICENSE).
