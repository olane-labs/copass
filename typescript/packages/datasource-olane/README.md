# @copass/datasource-olane

Olane OS data source driver for [Copass](https://copass.id).

Provides the library primitives that manage local Olane OS instances:
- Supabase-backed `oTokenManager` construction
- Start / stop / status for detached OS child processes
- Worlds CRUD (disk-backed)
- Address book management
- Instance-level Copass ID persistence

Peer-depends on `@copass/core`. Callers are expected to own the UX layer
(prompts, spinners, output formatting) and feed this package through plain
function calls.

## Installation

```bash
pnpm add @copass/datasource-olane @copass/core
```

## Usage

### Token manager

```ts
import { createOlaneTokenManager } from '@copass/datasource-olane';

const tm = createOlaneTokenManager({
  accessToken:  session.access_token,
  refreshToken: session.refresh_token,
  tokenEndpoint: `https://${projectId}.supabase.co/auth/v1/token?grant_type=refresh_token`,
  headers:      { apikey: SUPABASE_ANON_KEY },
  expiresAt:    session.expires_at,
});
```

### Start / stop a local instance

```ts
import {
  startLocalOsInstance,
  stopLocalOsInstance,
  statusLocalOsInstance,
  listLocalOsInstances,
} from '@copass/datasource-olane';

const result = await startLocalOsInstance({
  instanceName: 'my-copass-id',
  port: 4999,
  cliEntry: path.resolve('./dist/index.js'), // entry that handles `os _run`
});

const status = await statusLocalOsInstance('my-copass-id');
const stopped = await stopLocalOsInstance('my-copass-id');
const all = await listLocalOsInstances();
```

### Worlds

```ts
import {
  createLocalWorld,
  listLocalWorlds,
  hasAnyLocalWorld,
  registerWorldAddress,
  listWorldFilepaths,
} from '@copass/datasource-olane';

if (!(await hasAnyLocalWorld('my-copass-id'))) {
  await createLocalWorld('my-copass-id', { name: 'my-world' });
}

await registerWorldAddress('my-copass-id', 'my-world', process.cwd());
```

### Address book

```ts
import {
  createAddressForInstance,
  loadAddressBookEntries,
  addToAddressBook,
  removeFromAddressBook,
} from '@copass/datasource-olane';

const { address, worlds, duplicateInWorld } = await createAddressForInstance(
  'my-copass-id',
  'my-service',
);
// → caller decides via its own UX whether to register in a world
```

### Identity

```ts
import { getInstanceCopassId, setInstanceCopassId } from '@copass/datasource-olane';

await setInstanceCopassId('my-copass-id', 'my-copass-id');
const current = await getInstanceCopassId('my-copass-id');
```

## Design

This package is strictly the *data plane* for Olane OS. UX concerns (prompts,
spinners, chalk, process.exit codes) live in the consumer — the official
consumer is `@olane/o-cli`, which provides the `olane os …` command tree.

## License

MIT
