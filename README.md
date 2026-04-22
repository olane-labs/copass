# copass-harness

**Developer SDKs and integrations for [Copass](https://copass.id).** A typed, multi-language monorepo for building agents grounded in a knowledge graph.

## Pick your path

**Building an agent with an LLM framework?** Use an adapter — the LLM picks between `discover` / `interpret` / `search` on each turn, and retrieval is window-aware automatically.

| Framework | Package |
|---|---|
| Vercel AI SDK | [`@copass/ai-sdk`](./typescript/packages/ai-sdk) |
| LangChain / LangGraph | [`@copass/langchain`](./typescript/packages/langchain) |
| Mastra | [`@copass/mastra`](./typescript/packages/mastra) |
| Pydantic AI (Python) | [`copass-pydantic-ai`](./python/copass-pydantic-ai) |

**On the Anthropic managed stack?** Use MCP — zero code, just a config line.

| Client | Package |
|---|---|
| Claude Code · Claude Desktop · Cursor · Claude Agent SDK | [`@copass/mcp`](./typescript/packages/mcp) |

**Starting from zero?** Scaffold a ready-to-deploy Hono server + Claude agent:

```bash
npx create-copass-agent my-app
```

See [`create-copass-agent`](./typescript/packages/create-copass-agent).

**Going lower level?** Talk to the API directly:

| Use case | Package |
|---|---|
| Retrieval, ingestion, Context Window, sandbox/source management | [`@copass/core`](./typescript/packages/core) |
| Filesystem → knowledge graph watcher driver | [`@copass/datasource-fs`](./typescript/packages/datasource-fs) |
| Olane OS instance management + address book | [`@copass/datasource-olane`](./typescript/packages/datasource-olane) |

## Prerequisites (every path)

```bash
npm install -g @copass/cli
copass login                             # email OTP
copass setup                             # creates a sandbox, writes .olane/refs.json
copass apikey create --name my-app       # prints an olk_... key — shown once, save it
```

You end up with two things every adapter needs:

| Output | Use as |
|---|---|
| `olk_...` key printed by `copass apikey create` | `COPASS_API_KEY` |
| `./.olane/refs.json` (`sandbox_id`, `project_id`, `data_source_id`) | `COPASS_SANDBOX_ID`, `COPASS_PROJECT_ID` |

Ingest something so retrieval has material to work with:

```bash
copass ingest path/to/notes.md
```

## Core primitives

- **Sandbox** — your tenancy boundary. Data, quotas, and encryption keys scope here.
- **Data source** — a named connection feeding content in. Durable by default; `ephemeral` for time-bound streams like agent threads.
- **Context Window** — an agent conversation wrapped as an ephemeral data source. Retrieval is automatically window-aware; the agent's memory isn't a prompt-engineering problem anymore.
- **Retrieval gradient** — one axis, three calls: `discover` (ranked menu) → `interpret` (synthesized brief) → `search` (direct answer). Pick the point that matches your cost-quality tradeoff.

## Repository layout

```
copass-harness/
  typescript/packages/
    core                  # Client SDK — auth, retrieval, Context Window, sources
    ai-sdk                # Vercel AI SDK tool adapter
    langchain             # LangChain tool adapter
    mastra                # Mastra tool adapter
    mcp                   # Standalone MCP server (npx @copass/mcp)
    create-copass-agent   # npx scaffold for Hono + Claude agent
    datasource-fs         # Filesystem watcher driver
    datasource-olane      # Olane OS driver
  python/
    copass-pydantic-ai    # Pydantic AI tool adapter + minimal retrieval client
  docs/                   # Architecture, auth, encryption, getting-started
  spec/                   # Shared contracts (crypto constants, API specs)
  examples/               # Per-language usage examples
```

## Documentation

- [Architecture](./docs/architecture.md) — SDK layered design
- [API Surface](./docs/api-surface.md) — Backend endpoint catalog
- [Authentication](./docs/authentication.md) — API key, JWT, Supabase OTP
- [Encryption](./docs/encryption.md) — AES-256-GCM protocol and key derivation
- [Getting Started](./docs/getting-started.md) — Install and first retrieval

## Publishing

- TypeScript packages — Lerna (`pnpm -w version`, `pnpm -w release`)
- Python packages — Hatchling (`python -m build && twine upload`)

See each package's `package.json` / `pyproject.toml` for version state.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup.

## License

MIT — see [LICENSE](./LICENSE).
