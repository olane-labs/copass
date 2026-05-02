# copass

**Build AI agents grounded in your data — on any provider.** A typed, multi-language monorepo of SDKs and integrations for [Copass](https://copass.id).

Copass is the abstraction layer over fragmented AI markets. **Three Routers, one architecture:**

- **AgentRouter** — unified managed agents (*the who*). Anthropic, Google, more on the way.
- **ContextRouter** — unified managed context (*the what they know*). Sandboxes, integrations, retrieval, memory.
- **ComputeRouter** — unified managed compute (*the where they run*). Self-hosted open-weights agents on managed compute. Phase 1 in flight.

Underneath all three: **ANS** — the Attention Name System. Every primitive (sandbox, agent, data source, compute session) has a stable address like `o://alice/sandbox/sb_abc`. Provider swaps, compute swaps, and runtime moves leave the address untouched. DNS for hosts; ANS for attention.

In Copass, **context and agents are decoupled.** Your sandbox holds the data, the integrations, the memory, and the end users. Agent runtimes are interchangeable backends. Compute is interchangeable underneath. Swap providers on a per-call flag; your context stays where it is.

```
  ┌───────────────────────┐
  │  data source          │   Slack · GitHub · Notion · folder · custom
  │  (input)              │
  └───────────┬───────────┘
              │
              ▼  ingest                    ← THE STEP NEW USERS MISS
              │
  ┌───────────────────────┐
  │  sandbox              │   knowledge graph + retrieval + memory
  │  (your tenancy)       │
  └───────────┬───────────┘
              │
              ▼
  ┌───────────────────────┐
  │  agents read it       │   discover · interpret · search
  └───────────────────────┘
```

**A sandbox starts empty.** Connecting an integration registers a credential — it doesn't pull your data into the sandbox. The activation step is **ingest**.

## The Agent Router — one API for every provider

```typescript
import { AgentRouter } from '@copass/agent-router';

const router = new AgentRouter({
  auth: { type: 'api-key', key: process.env.COPASS_API_KEY! },
  sandboxId: process.env.COPASS_SANDBOX_ID!,
});

// One agent turn. Streams events as the response is generated.
const turn = router.run({
  provider: 'anthropic',
  model: 'claude-opus-4-7',
  system: 'You are a helpful agent.',
  message: 'Summarize my latest GitHub issues.',
  endUserId: 'u-123',
});

for await (const event of turn) {
  if (event.type === 'text') process.stdout.write(event.text);
}

// Same call, different brain — memory, tools, end users stay.
const next = router.run({
  provider: 'google',
  model: 'gemini-3.1-pro',
  reasoningEngineId: process.env.COPASS_REASONING_ENGINE_ID!,
  system: 'You are a helpful agent.',
  message: 'Same question, different brain.',
  endUserId: 'u-123',
});
```

**What you get out of the box:**

- One API across providers — Anthropic and Google today; OpenAI and self-hosted on the roadmap.
- 3,000+ OAuth integrations via [Pipedream](https://pipedream.com/apps) — `router.integrations.connect('github', …)` runs the whole OAuth dance.
- Window-aware retrieval — the agent automatically pulls only what's relevant and new on each turn.
- Hosted runtime — no agent server to deploy, no SSE plumbing, no tool schemas to wire.

## 60-second quickstart

```bash
npm install -g @copass/cli
copass login                             # email OTP
copass setup                             # creates a sandbox, writes .olane/refs.json
copass apikey create --name my-app       # prints an olk_... key — shown once, save it

# Don't skip — your sandbox starts empty.
copass ingest README.md
```

You end up with two things every adapter needs:

| Output | Use as |
|---|---|
| `olk_...` key from `copass apikey create` | `COPASS_API_KEY` |
| `./.olane/refs.json` (`sandbox_id`, `project_id`, `data_source_id`) | `COPASS_SANDBOX_ID`, `COPASS_PROJECT_ID` |

## Pick your path

### Hosted runtime (recommended for new agents)

`@copass/agent-router` and `copass-agent-router` give you the API at the top of this README — one import, provider-neutral, OAuth integrations in one call.

| Surface | Package |
|---|---|
| TypeScript | [`@copass/agent-router`](./typescript/packages/agent-router) |
| Python | [`copass-agent-router`](./python/copass-agent-router) |

### Framework adapter (you own the runtime)

Drop window-aware retrieval into a framework you already use — the agent calls Copass through normal tool-use, the runtime stays in your hands.

| Framework | Package |
|---|---|
| Vercel AI SDK | [`@copass/ai-sdk`](./typescript/packages/ai-sdk) |
| LangChain / LangGraph (TS) | [`@copass/langchain`](./typescript/packages/langchain) |
| Mastra | [`@copass/mastra`](./typescript/packages/mastra) |
| LangChain / LangGraph (Python) | [`copass-langchain`](./python/copass-langchain) |
| Pydantic AI (Python) | [`copass-pydantic-ai`](./python/copass-pydantic-ai) |
| Anthropic Managed Agents (Python) | [`copass-anthropic-agents`](./python/copass-anthropic-agents) |
| Google Vertex Agent Engine / ADK (Python) | [`copass-google-agents`](./python/copass-google-agents) |

### MCP (zero code)

For Claude Code, Claude Desktop, Cursor, or any MCP client — drop in a config line, no SDK install.

| Client | Package |
|---|---|
| Claude Code · Claude Desktop · Cursor · Claude Agent SDK | [`@copass/mcp`](./typescript/packages/mcp) |

### Scaffolded starter (zero to chat UI)

```bash
npx create-copass-agent my-app
```

A ready-to-deploy Hono server + Claude agent with an embedded chat UI. ~150 lines across four files; everything is editable. See [`create-copass-agent`](./typescript/packages/create-copass-agent).

### Lower level (talk to the API directly)

`@copass/core` (and Python `copass-core`) exposes the full backend surface as a single typed client. Adapters and the MCP server are built on top of it.

| Use case | Package |
|---|---|
| `CopassClient` — auth, retrieval, ingestion, Context Window, sandboxes, sources, projects, vault | [`@copass/core`](./typescript/packages/core) · [`copass-core`](./python/copass-core) |
| Spec-driven management tool registrar (read-only Phase 1, 14 tools) | [`@copass/management`](./typescript/packages/management) · [`copass-management`](./python/copass-management) |
| Filesystem → knowledge graph watcher driver | [`@copass/datasource-fs`](./typescript/packages/datasource-fs) |
| Olane OS instance management + address book | [`@copass/datasource-olane`](./typescript/packages/datasource-olane) |

```typescript
import { CopassClient } from '@copass/core';

const client = new CopassClient({
  auth: { type: 'api-key', key: process.env.COPASS_API_KEY! },
});

// Knowledge-graph retrieval
const answer = await client.matrix.query({ query: 'How does auth work?' });

// Source-driven ingestion (production path)
await client.sources.ingest(sandboxId, sourceId, {
  text: '…',
  source_type: 'code',
  project_id: projectId,
});
```

The client splits cleanly into two layers, both documented in [`docs/api-surface.md`](./docs/api-surface.md):

- **Storage** (`/api/v1/storage/*`) — `sandboxes`, `sources`, `projects`, `vault`, `ingest`
- **Knowledge graph** (`/api/v1/*`) — `matrix`, `cosync`, `plans`, `entities`, `users`, `apiKeys`, `usage`

## Copass: the context layer

The data half of the decoupling. Sandboxes hold your data, integrations, memory, and end users — separate from whichever agent runtime is doing the talking. Every package in this repo surfaces the same primitives.

### Primitives

- **Sandbox** — your tenancy boundary. Data, quotas, and encryption keys scope here. Starts empty.
- **Data source** — a named connection feeding content in. Built-in providers: `slack`, `github`, `linear`, `gmail`, `jira`, `notion`, `custom`. Pick `manual` / `polling` / `realtime` ingestion mode.
- **Project** — sandbox-scoped grouping. Link one or more data sources; retrieval can be project-scoped.
- **Vault** — sandbox-scoped raw-bytes KV with optional AES-256-GCM at rest and content-hash dedup.
- **Context Window** — an agent conversation wrapped as an ephemeral data source. Retrieval reads from it like any other source.

### Retrieval

Three calls on a single quality-vs-cost gradient. The LLM picks one per turn — framework adapters expose them as ordinary tools; the Agent Router wires them automatically inside `router.run()`.

| Call | What you get | Cost | Use when |
|---|---|---|---|
| `discover` | A ranked list of relevant entities and snippets | Cheap | You want the LLM to scan a menu and decide what to read next |
| `interpret` | A synthesized brief that frames the relevant pieces | Moderate | You want the server to do the framing |
| `search` | A direct natural-language answer | Highest | You want one response, not a menu |

All three are **window-aware**: the server tracks what's already in the agent's prompt and only returns what's new, so retrieval never competes with the LLM's context budget.

## Authentication

Three flavors, all resolved to a Bearer token by the SDK. Full flow details in [`docs/authentication.md`](./docs/authentication.md).

| Type | Header | Refresh | Best for |
|---|---|---|---|
| `api-key` | `Bearer olk_…` | None — long-lived | Servers, CI, scripts |
| `bearer` | `Bearer <jwt>` | Caller-managed | Apps already using Supabase auth |
| `supabase` | `Bearer <jwt>` | SDK auto-refresh | CLIs and interactive tools |

## Encryption

Ingestion and vault payloads can be client-side encrypted with **AES-256-GCM**. The DEK is derived from a master key via **HKDF-SHA256** and wrapped per-session for transport in the `X-Encryption-Token` header. Pass `encryptionKey` to the client and the SDK handles the rest:

```typescript
const client = new CopassClient({
  auth: { type: 'api-key', key: 'olk_…' },
  encryptionKey: process.env.COPASS_MASTER_KEY,
});
```

Full protocol — including key derivation salts and on-the-wire layout — in [`docs/encryption.md`](./docs/encryption.md).

## Repository layout

```
copass/
  typescript/packages/
    core                  # CopassClient SDK — auth, retrieval, Context Window, sources, vault
    agent-router          # High-level agent SDK + integration OAuth
    ai-sdk                # Vercel AI SDK tool adapter
    langchain             # LangChain / LangGraph tool adapter
    mastra                # Mastra tool adapter
    mcp                   # Standalone MCP server (npx @copass/mcp)
    management            # Spec-driven management tool registrar (+ MCP adapter)
    create-copass-agent   # npx scaffold for Hono + Claude agent
    config                # Canonical tool descriptions / system prompts (shared)
    datasource-fs         # Filesystem watcher driver
    datasource-olane      # Olane OS driver
  python/
    copass-core           # Python mirror of @copass/core
    copass-agent-router   # Python mirror of @copass/agent-router
    copass-core-agents    # Vendor-neutral agent primitives (BaseAgent, events, scope)
    copass-anthropic-agents  # Anthropic Managed Agents backend
    copass-google-agents  # Google Vertex Agent Engine / ADK backend
    copass-context-agents # Context-Window-aware agent helpers
    copass-langchain      # LangChain / LangGraph tool adapter
    copass-pydantic-ai    # Pydantic AI tool adapter
    copass-management     # Python mirror of @copass/management
    copass-config         # Canonical tool descriptions (shared)
  docs/                   # Architecture, API surface, auth, encryption, getting-started
  spec/                   # Shared contracts (management v1 JSON Schema, crypto constants)
  examples/               # Per-language usage examples
```

## Documentation

- **[copass.id/docs](https://docs.copass.id)** — full developer documentation, including the Concierge, Collaboration, Cookbooks, and platform concepts.
- [Architecture](./docs/architecture.md) — Four-layer SDK design (Auth → Crypto → HTTP → Resources → Client)
- [API Surface](./docs/api-surface.md) — Full endpoint catalog
- [Authentication](./docs/authentication.md) — API key, Bearer JWT, Supabase OTP flows
- [Encryption](./docs/encryption.md) — AES-256-GCM protocol and HKDF key derivation
- [Getting Started](./docs/getting-started.md) — Install, create a client, first retrieval, full ingestion walkthrough

## Publishing

- TypeScript packages — Lerna (`pnpm -w version`, `pnpm -w release`)
- Python packages — Hatchling, lockstep-versioned (`python/scripts/bump-lockstep-version.sh`)

See each package's `package.json` / `pyproject.toml` for version state.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup.

## License

MIT — see [LICENSE](./LICENSE).
