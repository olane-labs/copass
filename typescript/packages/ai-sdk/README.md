# @copass/ai-sdk

**Copass retrieval as Vercel AI SDK tools.** The LLM decides whether to `discover`, `interpret`, or `search` — you don't write the tool-calling loop.

## Prerequisites

Install the Copass CLI and bootstrap your account:

```bash
npm install -g @copass/cli
copass login                             # email OTP
copass setup                             # creates a sandbox, writes .olane/refs.json
copass apikey create --name my-app       # prints an olk_... key — shown once, save it
```

| Output | Use as |
|---|---|
| `olk_...` key printed by `copass apikey create` | `COPASS_API_KEY` |
| `sandbox_id` in `./.olane/refs.json` | `COPASS_SANDBOX_ID` |
| `project_id` in `./.olane/refs.json` (optional) | `COPASS_PROJECT_ID` |

Ingest some content so retrieval has something to return:

```bash
copass ingest path/to/file.md
# or pipe stdin:  echo "some decision or note" | copass ingest -
```

## Install

```bash
npm install @copass/ai-sdk @copass/core ai @ai-sdk/anthropic zod
```

## Quickstart

The Copass-specific code is four lines. Everything else is vanilla Vercel AI SDK you'd write even without Copass.

```ts
import { CopassClient } from '@copass/core';
import { copassTools } from '@copass/ai-sdk';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

// ── Copass (the entire integration) ──
const copass = new CopassClient({
  auth: { type: 'api-key', key: process.env.COPASS_API_KEY! },
});
const window = await copass.contextWindow.create({
  sandbox_id: process.env.COPASS_SANDBOX_ID!,
});

// ── Standard Vercel AI SDK call — only `tools:` is new ──
const { text } = await generateText({
  model: anthropic('claude-opus-4-7'),
  tools: copassTools({ client: copass, sandbox_id: window.sandboxId, window }),
  maxSteps: 5,
  prompt: 'what do we know about checkout retry behavior?',
});

console.log(text);
```

**What Copass is actually doing:**

- `new CopassClient({ auth })` — authenticated REST client.
- `contextWindow.create(...)` — opens an ephemeral data source for this conversation.
- `copassTools({ ... })` — returns `discover` / `interpret` / `search` tools Claude can invoke autonomously. The `window` argument makes each retrieval window-aware at the server level.

Everything else — `generateText`, `model:`, `maxSteps:`, `prompt:` — is vanilla Vercel AI SDK.

## Multi-turn: `createWindowTracker`

The quickstart above runs one turn. For a multi-turn conversation where turn 2 retrieval should know what turn 1 surfaced, wrap with `createWindowTracker`:

```ts
import { copassTools, createWindowTracker } from '@copass/ai-sdk';

const tracker = createWindowTracker({ window });

// Per turn:
const userMessage = '...';
await tracker.recordUserTurn(userMessage);

const { text } = await generateText({
  model,
  tools: copassTools({ client: copass, sandbox_id: window.sandboxId, window }),
  onStepFinish: tracker.onStepFinish,   // auto-mirror assistant + tool messages
  prompt: userMessage,
});
```

Three additions:

1. `const tracker = createWindowTracker({ window })` at setup.
2. `tracker.recordUserTurn(msg)` before each `generateText` — the user's message isn't in `onStepFinish` (it's the input), so capture it explicitly. Idempotent; safe to call redundantly.
3. `onStepFinish: tracker.onStepFinish` on the `generateText` call — Vercel AI SDK's standard step-finish hook; the tracker mirrors each step's `response.messages` into the window, deduplicated.

Tool messages (role: `'tool'`) are skipped by default since they're usually retrieval noise. Opt in with `createWindowTracker({ window, includeToolMessages: true })` if you want them tracked.

## Why this, not the raw API

- **LLM chooses the retrieval shape.** You expose three tools; Claude picks `discover` for exploration, `interpret` for drilling into picked items, or `search` for a direct answer.
- **Window-aware retrieval.** Each retrieval call carries the `window` argument so the server knows which items have already been surfaced in this conversation. Add `createWindowTracker` (above) to get automatic cross-turn awareness.
- **Trimmed response shapes.** Tools return only what the model needs (`{header, items, next_steps}` / `{brief}` / `{answer}`) — no sandbox/project echoes that waste tokens.

## Tools

| Tool | When the LLM calls it |
|---|---|
| `discover` | "What's relevant?" — ranked menu of pointers |
| `interpret` | "Tell me about these specific items." — brief pinned to canonical_ids |
| `search` | "Answer this directly." — full synthesized answer |

## Conversation metadata

When you mirror turns into a `ContextWindow`, set the conversation
roster once at construction so it rides on every turn:

```typescript
const window = await client.contextWindow.create({
  sandbox_id,
  participants: ['User', 'agent:support-bot'],
});

await window.addTurn({
  role: 'user',
  content: 'Hey, did you finish the report?',
  name: 'Alice',  // → envelope `speaker`
});
```

See [`@copass/core`](../core) for the full envelope surface
(`speaker`, `participants`, `occurred_at`, free-form `source_type`).

## Related

- [`@copass/core`](../core) — client SDK
- [`@copass/langchain`](../langchain), [`@copass/mastra`](../mastra), [`copass-pydantic-ai`](../../python/copass-pydantic-ai) — same shape for other frameworks
- [`@copass/mcp`](../mcp) — standalone MCP server for Claude Code / Desktop / Cursor

## License

MIT
