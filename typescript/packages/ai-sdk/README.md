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

```ts
import { CopassClient } from '@copass/core';
import { copassTools, createWindowTracker } from '@copass/ai-sdk';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const copass = new CopassClient({
  auth: { type: 'bearer', token: process.env.COPASS_API_KEY! },
});
const sandbox_id = process.env.COPASS_SANDBOX_ID!;
const window = await copass.contextWindow.create({ sandbox_id });
const tracker = createWindowTracker({ window });

const userMessage = 'what do we know about checkout retry behavior?';
await tracker.recordUserTurn(userMessage);

const { text } = await generateText({
  model: anthropic('claude-opus-4-7'),
  tools: copassTools({ client: copass, sandbox_id, window }),
  onStepFinish: tracker.onStepFinish,
  maxSteps: 5,
  prompt: userMessage,
});

console.log(text);
```

If it worked, the answer cites concepts from whatever you ingested. Keep the same `window` and `tracker` across turns — follow-up calls won't re-surface items the agent already used.

## Window auto-tracking

Vercel AI SDK's `onStepFinish` fires after each internal agent step with `response.messages` — the assistant and tool messages generated during that step. `createWindowTracker(...)` returns a handler that mirrors those into the `ContextWindow`, de-duplicated against what's already there.

The user's initial message isn't in `onStepFinish` (it's in `prompt` / `messages` going *into* the call), so capture it explicitly with `tracker.recordUserTurn(text)` before you call `generateText`. Safe to call repeatedly — the tracker de-duplicates.

Tool results (`role: 'tool'`) are skipped by default since they're usually retrieval noise; opt in with `createWindowTracker({ window, includeToolMessages: true })` if you want them tracked.

## Why this, not the raw API

- **LLM chooses the retrieval shape.** You expose three tools; Claude picks `discover` for exploration, `interpret` for drilling into picked items, or `search` for a direct answer.
- **Window-aware automatically** — when you pair `copassTools` with `createWindowTracker`. Without the tracker, retrieval sees an empty history.
- **Trimmed response shapes.** Tools return only what the model needs (`{header, items, next_steps}` / `{brief}` / `{answer}`) — no sandbox/project echoes that waste tokens.

## Tools

| Tool | When the LLM calls it |
|---|---|
| `discover` | "What's relevant?" — ranked menu of pointers |
| `interpret` | "Tell me about these specific items." — brief pinned to canonical_ids |
| `search` | "Answer this directly." — full synthesized answer |

## Related

- [`@copass/core`](../core) — client SDK
- [`@copass/langchain`](../langchain), [`@copass/mastra`](../mastra), [`copass-pydantic-ai`](../../python/copass-pydantic-ai) — same shape for other frameworks
- [`@copass/mcp`](../mcp) — standalone MCP server for Claude Code / Desktop / Cursor

## License

MIT
