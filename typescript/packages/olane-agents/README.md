# @copass/olane-agents

Headless library for managing **Olane OS host singletons** plus **per-session
agent broker daemons** on a developer machine. The CLI / MCP / web / any other
front-end consumes this package; the package owns the libp2p plumbing and
the filesystem layout.

## Layering

```
@olane/o-agent           pure olane primitives (AgentNode, AgentRegistryNode, oAgentResolver, types)
@copass/datasource-olane Copass-flavored OS lifecycle (token manager, instance.ts, worlds, address-book)
@copass/olane-agents     ← this package — host-OS daemon model + agent broker glue
@copass/cli              UX/Commander wiring only
```

The cli's `copass os` and `copass olane` subcommands are thin wrappers over
this package's `OlaneOSManager` / `AgentBroker` / `runAgentDaemon`.

## Public surface

```ts
import {
  OlaneOSManager,
  AgentBroker,
  runAgentDaemon,
  withOlaneClient,
} from '@copass/olane-agents';
```

### `OlaneOSManager`

Singleton local Olane OS host with a circuit-relay-v2 server. Wraps
`@copass/datasource-olane`'s `startLocalOsInstance` / `runLocalOs` with the
RelayNode mount that other olane peers dial through.

```ts
const os = new OlaneOSManager({ instanceName: 'brendon' });
await os.start();                   // spawns detached `_run` child + waits
const status = await os.status();   // { running, info }
await os.stop();
```

### `AgentBroker`

Per-session agent daemon lifecycle + RPC against the running OS.

```ts
const broker = new AgentBroker();

// SessionStart-style hook
const session = await broker.register({
  kind: 'claude-code',
  sessionId: '1234',
  user: 'brendon',
  // REQUIRED — absolute path to the front-end binary that exposes
  // `olane _host` and runs `runAgentDaemon`. No implicit fallback to
  // `process.argv[1]` — that's a footgun for non-cli front-ends.
  cliEntry: '/usr/local/bin/copass',
});
// → spawns a detached `runAgentDaemon` child that owns an AgentNode at
//   `o://agent-brendon-claude-code-1234` and stays resident.

await broker.list({ live: true });

// `fromSessionId` is REQUIRED — anonymous sends are not supported.
// The sender's AgentNode._tool_send is the single source of truth for
// envelope construction; clients never fabricate envelopes themselves.
// Register a session daemon first if you need to send.
await broker.send({
  to: session.address,
  fromSessionId: '1234',
  text: 'hello',
});

// Stop hook drains pending inbox messages between Claude turns
const messages = await broker.drain('1234');

// SessionEnd hook
await broker.deregister('1234');
```

### `runAgentDaemon`

The body of the per-session daemon process. The `AgentBroker.register()`
spawn-detached child eventually `await`s this. Exposed so any front-end with
its own binary entrypoint can host the daemon.

```ts
// in your CLI's hidden `_host` subcommand
await runAgentDaemon({
  kind: 'claude-code',
  sessionId: '1234',
  user: 'brendon',
});
```

### `withOlaneClient`

Transient libp2p client helper — boots an `oClientNode` against the running
OS leader, hands the caller a `use(addr, params)` function, tears down on
return. Used internally by `AgentBroker` and exposed for callers that want
to make ad-hoc calls into the OS.

```ts
const data = await withOlaneClient(async (use) => {
  return await use('o://agents', { method: 'list', params: {} });
});
```

### `runOlaneOSHost` (gateway auto-resolution — ADR 0030 Phase 2a)

Body of the detached `os _run` host process. Boots OlaneOS, mounts the
relay + network broker, optionally registers the daemon with a remote
"compute gateway" so external callers (Copass api, web-app) can
discover it.

The minimal seamless command is just:

```bash
copass os start
```

With no env vars set, the daemon resolves its per-user gateway by
POSTing to the Copass api (`POST /api/v1/storage/compute-providers/local/gateway`).
The api lazy-provisions a per-user broker sandbox (E2B-backed, ~2–5s
cold start) and returns the libp2p multiaddr the daemon needs to
register itself.

#### Precedence (highest → lowest)

1. **Explicit option** — `runOlaneOSHost({ gateway: { gatewayMultiaddr, userId } })`
2. **Env vars** — `GATEWAY_MULTIADDR` + `GATEWAY_USER_ID`
   (escape hatch for power users / local dev — the env vars bypass the
   api entirely).
3. **api auto-resolution** — `gateway.autoResolveTransport` supplied.
4. **No registration** — daemon runs locally; not gateway-discoverable.

#### Wiring auto-resolution from a CLI

The library does NOT depend on `@copass/core` directly. Callers that
already construct a `CopassClient` (e.g. via `getSdk()`) adapt it
to the `GatewayAutoResolveTransport` interface:

```ts
import { runOlaneOSHost } from '@copass/olane-agents';
import { getSdk } from './services/sdk.js';

const { client, userId, apiUrl } = await getSdk();

await runOlaneOSHost({
  instanceName: 'brendon',
  gateway: {
    userId,
    autoResolveTransport: {
      apiBaseUrl: apiUrl,
      getAccessToken: async () => {
        // Pull the bearer from the client's auth provider.
        const session = await (client as any)._authProvider?.getSession?.();
        return session?.accessToken ?? null;
      },
    },
  },
});
```

#### Opting out

Set `OLANE_GATEWAY_AUTO_RESOLVE=false` to disable the api auto-resolve
path (env vars still work; falls through to no-registration when
neither is set).

## Install

```bash
pnpm add @copass/olane-agents @copass/core
```

## License

MIT © Olane Inc.
