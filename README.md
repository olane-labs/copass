# copass

[![CI – TypeScript](https://github.com/olane-labs/copass/actions/workflows/ci-typescript.yml/badge.svg?branch=main)](https://github.com/olane-labs/copass/actions/workflows/ci-typescript.yml)
[![CI – Python](https://github.com/olane-labs/copass/actions/workflows/ci-python.yml/badge.svg?branch=main)](https://github.com/olane-labs/copass/actions/workflows/ci-python.yml)
[![Conformance](https://github.com/olane-labs/copass/actions/workflows/conformance.yml/badge.svg?branch=main)](https://github.com/olane-labs/copass/actions/workflows/conformance.yml)
[![SDK Contract Probe](https://github.com/olane-labs/copass/actions/workflows/sdk-contract-probe.yml/badge.svg?branch=main)](https://github.com/olane-labs/copass/actions/workflows/sdk-contract-probe.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[![npm @copass/core](https://img.shields.io/npm/v/@copass/core?label=%40copass%2Fcore&color=cb3837&logo=npm)](https://www.npmjs.com/package/@copass/core)
[![npm @copass/management](https://img.shields.io/npm/v/@copass/management?label=%40copass%2Fmanagement&color=cb3837&logo=npm)](https://www.npmjs.com/package/@copass/management)
[![npm @copass/mcp](https://img.shields.io/npm/v/@copass/mcp?label=%40copass%2Fmcp&color=cb3837&logo=npm)](https://www.npmjs.com/package/@copass/mcp)
[![npm @copass/cli](https://img.shields.io/npm/v/@copass/cli?label=%40copass%2Fcli&color=cb3837&logo=npm)](https://www.npmjs.com/package/@copass/cli)
[![PyPI copass-core](https://img.shields.io/pypi/v/copass-core?label=copass-core&color=3776ab&logo=pypi&logoColor=white)](https://pypi.org/project/copass-core/)
[![PyPI copass-management](https://img.shields.io/pypi/v/copass-management?label=copass-management&color=3776ab&logo=pypi&logoColor=white)](https://pypi.org/project/copass-management/)

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

## Packages

Every published artifact in the monorepo, with the live version pulled from the registry. CI status for each language is in the badge bar at the top.

### TypeScript — npm

| Package | Version | Downloads |
|---|---|---|
| [`@copass/core`](https://www.npmjs.com/package/@copass/core) — typed client SDK; auth, retrieval, ContextWindow | [![v](https://img.shields.io/npm/v/@copass/core?label=&color=cb3837)](https://www.npmjs.com/package/@copass/core) | [![dl](https://img.shields.io/npm/dm/@copass/core?label=)](https://www.npmjs.com/package/@copass/core) |
| [`@copass/management`](https://www.npmjs.com/package/@copass/management) — admin-tool catalog (sandboxes, sources, agents) | [![v](https://img.shields.io/npm/v/@copass/management?label=&color=cb3837)](https://www.npmjs.com/package/@copass/management) | [![dl](https://img.shields.io/npm/dm/@copass/management?label=)](https://www.npmjs.com/package/@copass/management) |
| [`@copass/mcp`](https://www.npmjs.com/package/@copass/mcp) — Model Context Protocol server | [![v](https://img.shields.io/npm/v/@copass/mcp?label=&color=cb3837)](https://www.npmjs.com/package/@copass/mcp) | [![dl](https://img.shields.io/npm/dm/@copass/mcp?label=)](https://www.npmjs.com/package/@copass/mcp) |
| [`@copass/cli`](https://www.npmjs.com/package/@copass/cli) — `copass` and `copass-admin` binaries | [![v](https://img.shields.io/npm/v/@copass/cli?label=&color=cb3837)](https://www.npmjs.com/package/@copass/cli) | [![dl](https://img.shields.io/npm/dm/@copass/cli?label=)](https://www.npmjs.com/package/@copass/cli) |
| [`@copass/agent-router`](https://www.npmjs.com/package/@copass/agent-router) — one API across providers + OAuth integrations | [![v](https://img.shields.io/npm/v/@copass/agent-router?label=&color=cb3837)](https://www.npmjs.com/package/@copass/agent-router) | [![dl](https://img.shields.io/npm/dm/@copass/agent-router?label=)](https://www.npmjs.com/package/@copass/agent-router) |
| [`@copass/ai-sdk`](https://www.npmjs.com/package/@copass/ai-sdk) — Vercel AI SDK adapter (`copassTools`) | [![v](https://img.shields.io/npm/v/@copass/ai-sdk?label=&color=cb3837)](https://www.npmjs.com/package/@copass/ai-sdk) | [![dl](https://img.shields.io/npm/dm/@copass/ai-sdk?label=)](https://www.npmjs.com/package/@copass/ai-sdk) |
| [`@copass/langchain`](https://www.npmjs.com/package/@copass/langchain) — LangChain adapter | [![v](https://img.shields.io/npm/v/@copass/langchain?label=&color=cb3837)](https://www.npmjs.com/package/@copass/langchain) | [![dl](https://img.shields.io/npm/dm/@copass/langchain?label=)](https://www.npmjs.com/package/@copass/langchain) |
| [`@copass/mastra`](https://www.npmjs.com/package/@copass/mastra) — Mastra adapter | [![v](https://img.shields.io/npm/v/@copass/mastra?label=&color=cb3837)](https://www.npmjs.com/package/@copass/mastra) | [![dl](https://img.shields.io/npm/dm/@copass/mastra?label=)](https://www.npmjs.com/package/@copass/mastra) |
| [`@copass/datasource-fs`](https://www.npmjs.com/package/@copass/datasource-fs) — file-system data source driver | [![v](https://img.shields.io/npm/v/@copass/datasource-fs?label=&color=cb3837)](https://www.npmjs.com/package/@copass/datasource-fs) | [![dl](https://img.shields.io/npm/dm/@copass/datasource-fs?label=)](https://www.npmjs.com/package/@copass/datasource-fs) |
| [`@copass/datasource-olane`](https://www.npmjs.com/package/@copass/datasource-olane) — Olane OS data source driver | [![v](https://img.shields.io/npm/v/@copass/datasource-olane?label=&color=cb3837)](https://www.npmjs.com/package/@copass/datasource-olane) | [![dl](https://img.shields.io/npm/dm/@copass/datasource-olane?label=)](https://www.npmjs.com/package/@copass/datasource-olane) |
| [`@copass/config`](https://www.npmjs.com/package/@copass/config) — shared chalk palette + tool descriptions | [![v](https://img.shields.io/npm/v/@copass/config?label=&color=cb3837)](https://www.npmjs.com/package/@copass/config) | [![dl](https://img.shields.io/npm/dm/@copass/config?label=)](https://www.npmjs.com/package/@copass/config) |
| [`create-copass-agent`](https://www.npmjs.com/package/create-copass-agent) — `npm create copass-agent` scaffolder | [![v](https://img.shields.io/npm/v/create-copass-agent?label=&color=cb3837)](https://www.npmjs.com/package/create-copass-agent) | [![dl](https://img.shields.io/npm/dm/create-copass-agent?label=)](https://www.npmjs.com/package/create-copass-agent) |

### Python — PyPI

| Package | Version | Downloads |
|---|---|---|
| [`copass-core`](https://pypi.org/project/copass-core/) — typed client SDK; auth, retrieval, ContextWindow | [![v](https://img.shields.io/pypi/v/copass-core?label=&color=3776ab)](https://pypi.org/project/copass-core/) | [![dl](https://img.shields.io/pypi/dm/copass-core?label=)](https://pypi.org/project/copass-core/) |
| [`copass-management`](https://pypi.org/project/copass-management/) — admin-tool catalog | [![v](https://img.shields.io/pypi/v/copass-management?label=&color=3776ab)](https://pypi.org/project/copass-management/) | [![dl](https://img.shields.io/pypi/dm/copass-management?label=)](https://pypi.org/project/copass-management/) |
| [`copass-agent-router`](https://pypi.org/project/copass-agent-router/) — one API across providers + OAuth integrations | [![v](https://img.shields.io/pypi/v/copass-agent-router?label=&color=3776ab)](https://pypi.org/project/copass-agent-router/) | [![dl](https://img.shields.io/pypi/dm/copass-agent-router?label=)](https://pypi.org/project/copass-agent-router/) |
| [`copass-anthropic-agents`](https://pypi.org/project/copass-anthropic-agents/) — Anthropic agent backend | [![v](https://img.shields.io/pypi/v/copass-anthropic-agents?label=&color=3776ab)](https://pypi.org/project/copass-anthropic-agents/) | [![dl](https://img.shields.io/pypi/dm/copass-anthropic-agents?label=)](https://pypi.org/project/copass-anthropic-agents/) |
| [`copass-google-agents`](https://pypi.org/project/copass-google-agents/) — Google / Vertex agent backend | [![v](https://img.shields.io/pypi/v/copass-google-agents?label=&color=3776ab)](https://pypi.org/project/copass-google-agents/) | [![dl](https://img.shields.io/pypi/dm/copass-google-agents?label=)](https://pypi.org/project/copass-google-agents/) |
| [`copass-hermes-agents`](https://pypi.org/project/copass-hermes-agents/) — self-hosted Hermes (compute-router) backend | [![v](https://img.shields.io/pypi/v/copass-hermes-agents?label=&color=3776ab)](https://pypi.org/project/copass-hermes-agents/) | [![dl](https://img.shields.io/pypi/dm/copass-hermes-agents?label=)](https://pypi.org/project/copass-hermes-agents/) |
| [`copass-core-agents`](https://pypi.org/project/copass-core-agents/) — base abstractions shared by every backend | [![v](https://img.shields.io/pypi/v/copass-core-agents?label=&color=3776ab)](https://pypi.org/project/copass-core-agents/) | [![dl](https://img.shields.io/pypi/dm/copass-core-agents?label=)](https://pypi.org/project/copass-core-agents/) |
| [`copass-context-agents`](https://pypi.org/project/copass-context-agents/) — context-engineering tools for agent runtimes | [![v](https://img.shields.io/pypi/v/copass-context-agents?label=&color=3776ab)](https://pypi.org/project/copass-context-agents/) | [![dl](https://img.shields.io/pypi/dm/copass-context-agents?label=)](https://pypi.org/project/copass-context-agents/) |
| [`copass-langchain`](https://pypi.org/project/copass-langchain/) — LangChain adapter | [![v](https://img.shields.io/pypi/v/copass-langchain?label=&color=3776ab)](https://pypi.org/project/copass-langchain/) | [![dl](https://img.shields.io/pypi/dm/copass-langchain?label=)](https://pypi.org/project/copass-langchain/) |
| [`copass-pydantic-ai`](https://pypi.org/project/copass-pydantic-ai/) — pydantic-ai adapter | [![v](https://img.shields.io/pypi/v/copass-pydantic-ai?label=&color=3776ab)](https://pypi.org/project/copass-pydantic-ai/) | [![dl](https://img.shields.io/pypi/dm/copass-pydantic-ai?label=)](https://pypi.org/project/copass-pydantic-ai/) |
| [`copass-config`](https://pypi.org/project/copass-config/) — shared chalk palette + tool descriptions | [![v](https://img.shields.io/pypi/v/copass-config?label=&color=3776ab)](https://pypi.org/project/copass-config/) | [![dl](https://img.shields.io/pypi/dm/copass-config?label=)](https://pypi.org/project/copass-config/) |

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
