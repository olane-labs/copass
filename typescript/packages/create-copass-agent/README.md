# create-copass-agent

**Scaffold a Copass-backed agent in three copy-pasteable steps.** Hono server + [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript) + [`@copass/mcp`](https://www.npmjs.com/package/@copass/mcp) + an embedded chat UI. Open `http://localhost:3000` and start chatting.

## Quick start

### 1. Bootstrap Copass (once, ~60 s)

```bash
npm install -g @copass/cli
copass login                             # email OTP
copass setup                             # writes .olane/refs.json to your current directory
copass apikey create --name my-app       # prints an olk_... key — shown once, save it
copass ingest README.md                  # give retrieval something real to work with
```

`copass setup` creates a sandbox and drops `.olane/refs.json` next to wherever you ran it — remember this location, the scaffolder walks up to find it. `copass apikey create` prints a long-lived `olk_...` key that the agent uses to authenticate to Copass; copy it somewhere safe, it's only shown once.

### 2. Scaffold + start (~60 s)

```bash
npx create-copass-agent my-app
cd my-app
# .env is auto-populated with COPASS_SANDBOX_ID + COPASS_PROJECT_ID from
# ../.olane/refs.json. You fill in the two secrets by hand:
echo "COPASS_API_KEY=olk_your_key_from_step_1" >> .env
echo "ANTHROPIC_API_KEY=sk-ant-your-key" >> .env   # https://console.anthropic.com
npm install
npm run dev
```

### 3. Chat

Open **[http://localhost:3000](http://localhost:3000)** in your browser. You get a minimal chat UI that posts to the Hono server, keeps `threadId` in localStorage, and reconnects to the same Context Window on refresh.

Or hit it from the terminal:

```bash
curl -s -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"what do we know from the README I just ingested?"}'
```

Expected response shape:

```json
{ "threadId": "ds_abc...", "answer": "Based on the README, this project..." }
```

Pass the `threadId` back on follow-up calls to keep retrieval window-aware.

## What gets scaffolded

```
my-app/
├── src/
│   ├── index.ts       # Hono server: GET / (chat UI), POST /chat, threadId↔sessionId map
│   ├── agent.ts       # query() from Claude Agent SDK + @copass/mcp subprocess config
│   ├── copass.ts      # CopassClient singleton + createThread() helper
│   └── chat-ui.ts     # Vanilla HTML/CSS/JS chat page served at GET /
├── package.json
├── tsconfig.json
├── .env               # auto-populated from CLI config at scaffold time
├── .env.example       # reference only
├── .gitignore
└── README.md
```

~300 lines of source across four files. Everything editable.

## Architecture

```
Browser (embedded chat UI)
    ▼  POST /chat { message, threadId? }
┌────────────────────────────────────┐
│ Hono server  (src/index.ts)        │
│  ├─ create Context Window (first)  │ ◀── @copass/core
│  └─ run agent turn                 │
└──────────┬─────────────────────────┘
           │
           ▼
┌────────────────────────────────────┐
│ Claude Agent SDK  (src/agent.ts)   │ ◀── @anthropic-ai/claude-agent-sdk
│  • agent loop, tool calling        │
│  • session persistence (resume)    │
└──────────┬─────────────────────────┘
           │ stdio MCP
           ▼
┌────────────────────────────────────┐
│ @copass/mcp (subprocess per turn)  │
│  COPASS_CONTEXT_WINDOW_ID=ds_…     │ ◀── auto-attached on startup
│  tools: discover / interpret /     │
│         search / context_window_* /│
│         ingest                     │
└────────────────────────────────────┘
```

## Going further

- **Swap in a polished React UI.** Delete `src/chat-ui.ts` and wire [Assistant UI](https://assistant-ui.com) (open-source React, MIT, pluggable runtime) or [Vercel AI SDK UI](https://sdk.vercel.ai). Point it at `POST /chat`; backend stays unchanged.
- **Streaming.** The `query()` result already streams via AsyncGenerator — in `src/index.ts`, swap the `join('')` for an SSE response and the embedded UI can render chunks as they arrive.
- **More tools.** Flip `tools: []` to `tools: { type: 'preset', preset: 'claude_code' }` in `src/agent.ts` to give the agent Read/Write/Bash/Web on top of Copass. Tighten via `allowedTools`.
- **Production sessions.** Replace the in-memory `threadSessions` Map in `src/index.ts` with Redis / Postgres / your existing store.

## Troubleshooting

### `pnpm install` fails with `ETARGET No matching version found for @copass/core`

The scaffold pins `@copass/core@^0.2.0` and `@copass/mcp@^0.1.0`. If those aren't on npm yet, install fails with `ETARGET`. Until they publish, work from a local checkout — `pnpm link` against a cloned `copass-harness` repo.

### `.env` is missing `COPASS_SANDBOX_ID` / `COPASS_PROJECT_ID`

The scaffolder walks **up** from your project dir looking for `.olane/refs.json` to auto-populate sandbox + project ids. If you scaffolded into a directory whose ancestors don't contain one, auto-populate fails silently.

Fix: run `copass login && copass setup` in the directory **above** your scaffolded project, then either rerun the scaffolder or manually paste:

```bash
jq -r .sandbox_id ../.olane/refs.json           # → COPASS_SANDBOX_ID
jq -r .project_id ../.olane/refs.json           # → COPASS_PROJECT_ID (optional)
```

### `401 Unauthorized` / auth errors from Copass

Your `COPASS_API_KEY` is invalid or missing. The scaffold never auto-populates this — it's a long-lived `olk_...` token you create explicitly with `copass apikey create --name my-app` and paste into `.env`. If you lost the key, create a new one (keys are only shown once at creation time).

### Agent returns "I don't have information about that"

Your Copass sandbox has nothing ingested. Run `copass ingest <file>` before chatting — even `copass ingest README.md` is enough for the agent to start citing real content.

## Stack

- [Hono](https://hono.dev) — lightweight server, Node + edge runtimes
- [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — managed agent loop (same runtime that powers Claude Code)
- [`@copass/mcp`](https://www.npmjs.com/package/@copass/mcp) — MCP server exposing Copass retrieval + Context Window
- [`@copass/core`](https://www.npmjs.com/package/@copass/core) — client SDK for Context Window lifecycle

## Production limitations

**This is starter code.** It's designed to get you from zero to a working agent loop in under two minutes, not to run a production workload. Before you deploy this behind real users, walk through the list below — each item is a deliberate scaffold-level simplification, not a bug.

### State persistence

- **`threadWindows` and `threadSessions` are in-memory `Map`s.** A server restart loses every active thread's session and local turn buffer. Clients that kept their `threadId` from a prior run will fall through to `attachThread(dataSourceId, [])` and retrieval push-down will re-ramp from an empty history — content is still retrievable from the data source, but cross-turn exclusion rebuilds from zero.
- **Fix for prod:** back both maps with Redis / Postgres / Durable Objects / whatever you already use. Serialize `ChatMessage[]` alongside the session id, or call an API the server's keeping fresh.

### Scale

- **Subprocess-per-turn.** Every `POST /chat` spawns a fresh `@copass/mcp` child process via `npx`. Expect ~200–500 ms cold-start overhead per request. Fine for dev and low-volume prod; a concern at real QPS.
  - **Fix for prod:** pre-install `@copass/mcp` locally and change `command: 'npx'` to an absolute path. Or hold the MCP subprocess open across turns (requires reworking the Agent SDK invocation and keeping the MCP process's active window aligned with the HTTP thread).
- **`COPASS_CONTEXT_WINDOW_INITIAL_TURNS` is capped at the last 50 turns.** OS env-var size limits are ~128 KB–1 MB depending on platform; 50 turns of ordinary chat stays well under, but very long conversations silently lose earlier context for push-down exclusion (content still lives in the data source, just doesn't feed the filter).
  - **Fix for prod:** serialize turns to a file path and pass via `COPASS_CONTEXT_WINDOW_INITIAL_TURNS_FILE` (you'd add the env var to `@copass/mcp`), or swap the subprocess model entirely.
- **Non-streaming responses.** `chat()` collects the Agent SDK's AsyncGenerator into a single string and returns JSON. First-token latency shows up as end-to-end latency.
  - **Fix for prod:** swap the JSON response for SSE in `src/index.ts` — the `query()` result already streams per-chunk.

### Security

- **No auth on `POST /chat`.** Anyone who can reach `:3000` can use your `ANTHROPIC_API_KEY` and your Copass sandbox. Hand on the scaffold assumes a localhost-only dev environment.
  - **Fix for prod:** add middleware in `src/index.ts` (Hono has first-party helpers for JWT, API keys, Clerk/Supabase auth).
- **No rate limiting or cost caps.** A runaway prompt (or a malicious caller) can burn an agent loop's `maxTurns: 10` on every request and rack up model spend. The Agent SDK supports `maxBudgetUsd` — not set in the scaffold.
  - **Fix for prod:** add `maxBudgetUsd` in `src/agent.ts` and rate-limit at the HTTP layer.
- **No tenant isolation in the chat UI.** `localStorage` is per-browser; there's no per-user session. Every visitor to the URL shares the same server-side map.

### Observability

- No request logging, no metrics, no tracing. `console.log` + `console.error` only.
- **Fix for prod:** plug in OpenTelemetry or your preferred APM. The Claude Agent SDK surfaces spans out of the box when a collector is configured.

### Window-awareness edge cases

- **First turn after a server restart is not window-aware** (by design — we can't reconstruct the local turn buffer from thin air). Impact is bounded: push-down exclusion rebuilds as new turns accumulate, and all prior content remains retrievable as graph chunks.
- **If the caller ever forgets to pass `threadId`**, the server creates a brand-new Context Window, so the conversation visually continues in the client but the retrieval layer starts fresh. The embedded UI handles this correctly via `localStorage`; custom frontends need to do the same.

### Dependencies

- `@copass/core@^0.2.0` and `@copass/mcp@^0.1.0` may not be on npm yet — see the *Troubleshooting* section above for the workaround.
- The Claude Agent SDK is a beta API (`0.2.x`). Expect breaking changes across minor versions until `1.0`.

## License

MIT
