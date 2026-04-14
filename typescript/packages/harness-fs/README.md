# @copass/harness-fs

Filesystem ingestion, watching, and indexing for the [Copass](https://copass.id) knowledge graph platform.

Built on top of [`@copass/core`](../core/) — requires a `CopassClient` instance for API communication.

## Installation

```bash
npm install @copass/harness-fs @copass/core
```

## Usage

### Full project indexing

```typescript
import { CopassClient } from '@copass/core';
import { runFullIndex } from '@copass/harness-fs';

const client = new CopassClient({
  auth: { type: 'api-key', key: 'olk_...' },
});

const summary = await runFullIndex(client, {
  projectPath: '/path/to/project',
  onProgress: (msg) => console.log(msg),
});

console.log(`Indexed ${summary.indexed_count} files in ${summary.duration_ms}ms`);
```

### File watching

```typescript
import { ProjectWatchRuntime } from '@copass/harness-fs';

const watcher = new ProjectWatchRuntime(client, {
  projectPath: '/path/to/project',
});

await watcher.start();
// Files are automatically ingested on change
// Call watcher.stop() to shut down
```

### File scanning

```typescript
import { scanProjectFiles, diffFiles } from '@copass/harness-fs';

const files = await scanProjectFiles('/path/to/project');
// Returns Record<relativePath, { mtimeMs, size, sha256 }>
```

## License

MIT
