# @copass/langchain

**Copass retrieval as LangChain tools.** The LLM picks `discover` (menu of relevant items), `search` (synthesized answer), or `get_origin` (map canonical_ids to source files) — you don't write the tool-calling loop. `interpret` is exposed for back-compat but legacy; prefer `search` for drill-in.

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
npm install @copass/langchain @copass/core @langchain/core @langchain/anthropic @langchain/langgraph zod
```

## Quickstart

```ts
import { CopassClient } from '@copass/core';
import { createCopassAgent } from '@copass/langchain';
import { ChatAnthropic } from '@langchain/anthropic';

const copass = new CopassClient({
  auth: { type: 'bearer', token: process.env.COPASS_API_KEY! },
});
const sandbox_id = process.env.COPASS_SANDBOX_ID!;
const window = await copass.contextWindow.create({ sandbox_id });

const agent = createCopassAgent({
  client: copass,
  sandbox_id,
  window,
  llm: new ChatAnthropic({ model: 'claude-opus-4-7' }),
});

const result = await agent.invoke({
  messages: [{ role: 'user', content: 'what do we know about checkout retry behavior?' }],
});

console.log(result.messages.at(-1)?.content);
```

That's the whole API. `createCopassAgent` returns a standard LangChain `Runnable`, so `.invoke()` / `.stream()` / `.streamEvents()` / `.batch()` / `.pipe()` all work as normal. Pass the same `window` to the next turn and retrieval stays window-aware automatically — no callbacks, no trackers, no glue code on your side.

Run twice with the same `window` — the second call won't re-surface items the agent already used.

## Tools

The agent has the Copass retrieval tools in its toolbelt; the LLM picks one per turn:

| Tool | When the LLM calls it |
|---|---|
| `discover` | "What's relevant?" — ranked menu of pointers |
| `search` | "Tell me about X" / "Answer this." — synthesized answer (canonical drill-in) |
| `get_origin` | "Where does this live?" — maps canonical_ids from `discover` to source files. Cheap, no LLM. |
| `interpret` | Legacy — brief pinned to canonical_ids. Prefer `search` for drill-in. |

Add your own tools via the `tools` option — they'll be mixed in alongside the Copass four:

```ts
const agent = createCopassAgent({
  client: copass,
  sandbox_id,
  window,
  llm,
  tools: [myWeatherTool, myCalendarTool],
});
```

## Why this, not the raw API

- **One call, zero plumbing.** `createCopassAgent` pre-wires the tools, the `createReactAgent` setup, and the window-auto-tracking callback. You don't learn LangChain callbacks to get working window-aware retrieval.
- **Still a standard Runnable.** The returned agent is a LangChain `Runnable` — it composes with chains, routers, and LangGraph nodes just like anything else.
- **LLM chooses the retrieval shape.** `discover` for a menu of relevant items, `search` for a synthesized answer. `interpret` is wired for back-compat (legacy — prefer `search`).

## Advanced: using the primitives directly

`createCopassAgent` is a thin composition. If you need custom agent plumbing — different executor, hand-tuned prompt node, multiple models — use the three exported primitives directly:

```ts
import { copassTools, CopassWindowCallback } from '@copass/langchain';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

const tools = copassTools({ client: copass, sandbox_id, window });
const agent = createReactAgent({
  llm,
  tools: [tools.discover, tools.interpret, tools.search],
});

await agent.invoke(
  { messages: [...] },
  { callbacks: [new CopassWindowCallback({ window })] },
);
```

**Why the callback exists.** LangGraph.js (unlike Python LangGraph) doesn't have an `InjectedState` annotation that lets tools read the conversation messages directly. `CopassWindowCallback` hooks `handleChatModelStart` — which fires before every chat model invocation with the full message history — and mirrors new turns into the `ContextWindow`. The dedup set is seeded from `window.getTurns()` so no message is added twice.

`ToolMessage`s are skipped by default since they're usually retrieval noise; set `includeToolMessages: true` to include them.

## Conversation metadata

The LangChain callback delegates to `ContextWindow.addTurn`, so any
`participants` configured on the underlying window flow through
automatically — no LangChain-specific wiring needed:

```typescript
const window = await client.contextWindow.create({
  sandbox_id,
  participants: ['User', 'agent:support-bot'],   // roster set once
});
```

Set a per-turn `name` on the `ChatMessage` for richer per-turn speaker
provenance. See [`@copass/core`](../core) for the full envelope
surface (`speaker`, `participants`, `occurred_at`, free-form
`source_type`).

## Related

- [`@copass/core`](../core) — client SDK
- [`@copass/ai-sdk`](../ai-sdk), [`@copass/mastra`](../mastra), [`copass-pydantic-ai`](../../python/copass-pydantic-ai) — same shape for other frameworks
- [`@copass/mcp`](../mcp) — standalone MCP server for Claude Code / Desktop / Cursor

## License

MIT
