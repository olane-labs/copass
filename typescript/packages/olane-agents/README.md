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

## Install

```bash
pnpm add @copass/olane-agents @copass/core
```

## License

MIT © Olane Inc.
