# @copass/agent-router

High-level Copass agent SDK. Wraps `@copass/core` to give you:

- **`router.run({...})`** — typed async-iterator over agent events (SSE under the hood)
- **`router.integrations.connect('github', ...)`** — one-call OAuth flow with browser redirect + webhook/reconcile polling
- **`router.integrations.{list,disconnect,reconcile,catalog}`** — convenience wrappers

## Install

```bash
npm add @copass/agent-router @copass/core
```

## Quickstart

```typescript
import { AgentRouter } from '@copass/agent-router';
import open from 'open';

const router = new AgentRouter({
  auth: { type: 'api-key', key: process.env.COPASS_API_KEY! },
  sandboxId: 'sb_...',
});

// 1) Connect an integration (works end-to-end from a terminal)
const { connection } = await router.integrations.connect('github', {
  scope: 'user',
  onConnectUrl: (url) => open(url),
});
console.log('connected:', connection.app, connection.name);

// 2) Run an agent
for await (const event of router.run({
  provider: 'anthropic',
  model: 'claude-opus-4-7',
  system: 'You are a helpful agent.',
  message: 'Summarize my latest GitHub issues.',
  endUserId: 'u-123',
})) {
  if (event.type === 'text') process.stdout.write(event.text);
  if (event.type === 'finish') console.log('\n[done]', event.stop_reason);
}
```

## Webapp usage

The OAuth listener in `runConnectFlow` uses `node:http` and therefore only runs in Node. In browsers, call `router.client.integrations.connect(...)` directly and handle the redirect via `window.open` + `BroadcastChannel` or polling.

## License

MIT.
