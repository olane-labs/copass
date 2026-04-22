# @copass/mastra

**Copass retrieval as Mastra tools.** The LLM decides whether to `discover`, `interpret`, or `search` — you don't write the tool-calling loop.

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
npm install @copass/mastra @copass/core @mastra/core @ai-sdk/anthropic zod
```

## Quickstart

```ts
import { CopassClient } from '@copass/core';
import { copassTools, createWindowTracker } from '@copass/mastra';
import { Agent } from '@mastra/core/agent';
import { anthropic } from '@ai-sdk/anthropic';

const copass = new CopassClient({
  auth: { type: 'bearer', token: process.env.COPASS_API_KEY! },
});
const sandbox_id = process.env.COPASS_SANDBOX_ID!;
const window = await copass.contextWindow.create({ sandbox_id });
const tracker = createWindowTracker({ window });
const tools = copassTools({ client: copass, sandbox_id, window });

const agent = new Agent({
  name: 'support-bot',
  instructions: 'Answer questions using the knowledge graph.',
  model: anthropic('claude-opus-4-7'),
  tools,
});

const userMessage = 'what do we know about checkout retry behavior?';
await tracker.recordUserTurn(userMessage);

const response = await agent.generate(userMessage, {
  onStepFinish: tracker.onStepFinish,
  maxSteps: 5,
});
console.log(response.text);
```

If it worked, the answer cites concepts from whatever you ingested. Keep the same `window` and `tracker` across turns — follow-up calls won't re-surface items the agent already used.

## Window auto-tracking

Mastra's `agent.generate()` / `agent.stream()` fire `onStepFinish` after each internal step with `response.messages` — the assistant and tool messages generated during that step. `createWindowTracker(...)` returns a handler that mirrors those into the `ContextWindow`, de-duplicated against what's already there.

The user's initial message isn't in `onStepFinish` (it's the input going *into* the call), so capture it explicitly with `tracker.recordUserTurn(text)` before `agent.generate()`. Safe to call repeatedly — the tracker de-duplicates.

Tool results (`role: 'tool'`) are skipped by default; opt in with `createWindowTracker({ window, includeToolMessages: true })` if you want them tracked.

## Why this, not the raw API

- **LLM chooses the retrieval shape.** Three tools; the model picks the right one per turn.
- **Window-aware automatically** — when paired with `createWindowTracker`. Without the tracker, retrieval sees an empty history.
- **Mastra-native tool shape.** Drop the returned `{ discover, interpret, search }` object straight into any agent config.

## Tools

| Tool | When the LLM calls it |
|---|---|
| `discover` | "What's relevant?" — ranked menu of pointers |
| `interpret` | "Tell me about these specific items." — brief pinned to canonical_ids |
| `search` | "Answer this directly." — full synthesized answer |

## Related

- [`@copass/core`](../core) — client SDK
- [`@copass/ai-sdk`](../ai-sdk), [`@copass/langchain`](../langchain), [`copass-pydantic-ai`](../../python/copass-pydantic-ai) — same shape for other frameworks
- [`@copass/mcp`](../mcp) — standalone MCP server for Claude Code / Desktop / Cursor

## License

MIT
