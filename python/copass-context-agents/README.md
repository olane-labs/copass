# copass-context-agents

Copass context-engineering primitives for `copass-core-agents`.

Three provider-neutral pieces every Copass-aware agent uses:

- **`copass_retrieval_tools(...)`** — returns `discover` / `interpret` / `search` as `AgentTool` instances, window-aware when a `ContextWindow` is passed.
- **`copass_ingest_tool(...)`** — returns `ingest` as an `AgentTool` so agents can promote content into durable sandbox storage.
- **`CopassTurnRecorder`** — mirrors user / assistant turns into a `ContextWindow` with fire-and-forget pushes and typed speaker / participants metadata.

These are the primitives the provider adapter packages — `copass-anthropic-agents`, `copass-google-agents` — compose into their `run()` / `stream()` loops. The descriptions come from `copass_config` so every Copass surface (TS adapters, MCP server, CLI) shows the LLM identical tool semantics.

## Install

```bash
pip install copass-context-agents
```

Usually a transitive dep — `pip install copass-anthropic-agents` / `copass-google-agents` pulls it in.

## Usage

```python
from copass_core import CopassClient
from copass_context_agents import (
    copass_retrieval_tools,
    copass_ingest_tool,
    CopassTurnRecorder,
)

client = CopassClient(...)
window = await client.context_window.create(sandbox_id=sandbox_id)

tools = [
    *copass_retrieval_tools(client=client, sandbox_id=sandbox_id, window=window),
    copass_ingest_tool(
        client=client,
        sandbox_id=sandbox_id,
        data_source_id=my_source_id,
        default_source_type="decision",
        author="agent:support-bot",
    ),
]

recorder = CopassTurnRecorder(window=window, author="agent:support-bot")
# ...wire into your provider's stream loop; see copass-anthropic-agents or
# copass-google-agents for the full wiring.
```

See the provider adapter packages for the full `CopassManagedAgent` / `CopassGoogleAgent` integrations that wire these primitives into discover-as-step-1 + auto-record flows.

## Speaker, participants, and provenance

`CopassTurnRecorder` populates the typed envelope fields on every turn it
pushes through the underlying `ContextWindow`:

| Constructor arg | Default | Effect |
|---|---|---|
| `author` | `None` | Forwarded as the envelope's `speaker` field on assistant turns (and as `ChatMessage.name` on the recorded turn). When unset, assistant turns get `speaker="Assistant"` from the role-derived fallback. |
| `user_speaker` | `"User"` | Speaker label on user turns. Set to a richer identity when you have one (e.g. logged-in user's display name). |
| `participants` | `["User", author or "Assistant"]` | Conversation roster forwarded as the envelope's `participants` field on every turn. Pass an explicit list to override; pass `[]` to opt out entirely. |
| `include_author_prefix` | `False` | **Legacy** — when `True`, also embeds `[author=…]\n` in the body string. The typed envelope path is the supported way to carry provenance now; this flag exists for backward compat with body-reading consumers and is off by default. |

```python
# Typical setup — typed speaker + auto-derived roster
recorder = CopassTurnRecorder(
    window=window,
    author="agent:support-bot",
    # participants defaults to ["User", "agent:support-bot"]
)

# Multi-party — set the roster explicitly
recorder = CopassTurnRecorder(
    window=window,
    author="agent:support-bot",
    user_speaker="Alice",
    participants=["Alice", "agent:support-bot", "system"],
)

# Opt out of participants entirely
recorder = CopassTurnRecorder(
    window=window,
    author="agent:support-bot",
    participants=[],
)
```

The same `author` flows through `copass_ingest_tool` as the envelope's
`speaker` on every tool-driven ingestion. No body-prefix munging — the
caller's content is sent verbatim.
