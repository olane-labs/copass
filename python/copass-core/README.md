# copass-core

Core client SDK for the Copass platform. Python mirror of [`@copass/core`](../../typescript/packages/core) — shared foundation for every Python Copass adapter.

## Install

```bash
pip install copass-core
```

Requires `httpx>=0.27`. Python ≥ 3.10.

## Quickstart

```python
import asyncio
from copass_core import CopassClient, ApiKeyAuth

async def main():
    client = CopassClient(auth=ApiKeyAuth(key="olk_..."))

    # Retrieval
    menu = await client.retrieval.discover(
        sandbox_id="sb_...",
        query="How does auth work?",
    )
    print(menu["items"])

asyncio.run(main())
```

## Auth options

```python
from copass_core import CopassClient, ApiKeyAuth, BearerAuth, ProviderAuth

# Long-lived API key (olk_ prefix)
CopassClient(auth=ApiKeyAuth(key="olk_..."))

# Raw Bearer JWT (caller owns refresh)
CopassClient(auth=BearerAuth(token="eyJ..."))

# Custom AuthProvider implementation
class MyProvider:
    async def get_session(self):
        from copass_core import SessionContext
        return SessionContext(access_token=await _mint_token())

CopassClient(auth=ProviderAuth(provider=MyProvider()))
```

## Available resources

Full resource surface matching `@copass/core`:

```python
client = CopassClient(auth=ApiKeyAuth(key="olk_..."))

# Narrow retrieval tools
await client.retrieval.discover(sandbox_id, query="...")
await client.retrieval.interpret(sandbox_id, query="...", items=[...])
await client.retrieval.search(sandbox_id, query="...")

# Storage layer
await client.sandboxes.create(name="...", owner_id="...")
await client.sources.register(sandbox_id, provider="custom", name="...")
await client.ingest.text_in_sandbox(sandbox_id, text="...")
await client.projects.create(sandbox_id, name="...")
await client.vault.store(sandbox_id, "key/path", b"bytes")

# Knowledge graph
await client.entities.search(sandbox_id, q="auth")

# Account
await client.users.get_profile()
await client.api_keys.create(name="ci")
await client.usage.get_balance()

# Higher-order — ephemeral data source wrapping agent conversation
window = await client.context_window.create(sandbox_id=sandbox_id)
await window.add_turn(ChatMessage(role="user", content="..."))
# Pass directly to retrieval for window-aware calls:
await client.retrieval.search(sandbox_id, query="...", window=window)
```

## Conversation metadata: speaker, participants, timestamp

Every ingestion path accepts optional metadata that travels alongside the
content on the envelope. Set them when the data is conversation-shaped so
the platform can attribute and order content correctly.

| Field | Where to set | What it means |
|---|---|---|
| `occurred_at` | `IngestTextRequest` / `BaseDataSource.push` / `client.sources.ingest` | ISO 8601 timestamp anchoring this payload to a real-world moment. Falls back as the default `occurred_at` for any composed event whose own LLM-extracted timestamp is `None`. |
| `speaker` | `IngestTextRequest` / `BaseDataSource.push` / `client.sources.ingest` | Name of the participant who uttered this payload. Caller-decided literal (`"User"`, `"Assistant"`, `"Alice"`, an email address, …). Most useful on conversation-shaped sources. |
| `participants` | Same | Roster of participants present in this artifact. Per-message — pass the snapshot at the time of utterance. |
| `source_type` | Same | Hint describing the payload kind. Conventional values: `"text"`, `"markdown"`, `"code"`, `"json"` (content-shape) or `"conversation"`, `"ticket"`, `"email"`, `"note"` (artifact-kind). Free-form string; custom values accepted. |

### Direct API

```python
await client.ingest.text(
    text="Hey Alice, did you finish the report?",
    source_type="conversation",
    speaker="Bob",
    participants=["Alice", "Bob"],
    occurred_at="2026-05-08T15:30:00Z",
)
```

### Through a `ContextWindow`

For a chat-style agent, set the participant roster once at window
construction; it forwards on every `add_turn` call. Set
`ChatMessage.name` when you want a richer speaker than the role-derived
default (`"User"` / `"Assistant"`):

```python
window = await client.context_window.create(
    sandbox_id=sandbox_id,
    participants=["User", "Alice"],   # default roster, applied on every turn
)

# Role-only — speaker derived as capitalized role.
await window.add_turn(ChatMessage(role="user", content="Hey Alice…"))

# Named participant — `name` overrides role-derived speaker.
await window.add_turn(
    ChatMessage(role="user", content="…thanks!", name="Bob"),
)

# Per-call override — use when the roster shifts mid-conversation.
await window.add_turn(
    ChatMessage(role="assistant", content="…"),
    participants=["User", "Alice", "Bob", "Carol"],
)
```

### Through a `BaseDataSource` subclass

```python
class SlackChannelSource(BaseDataSource):
    async def push_message(self, msg):
        await self.push(
            msg.text,
            source_type="conversation",
            speaker=msg.author_name,
            participants=msg.channel.member_names,
            occurred_at=msg.posted_at_iso,
        )
```

Existing callers that don't pass any of these fields keep working — all
four are optional.

## v0.2 scope

**Shipped in v0.2:**
- Full resource surface (12 resource classes, all public paths).
- `ContextWindow` + `ContextWindowResource`.
- `BaseDataSource` + `ensure_data_source` for custom driver subclasses.
- `HttpClient` raw-body / raw-response support (enables vault blob I/O).

**Deferred to v0.3:**
- Crypto primitives (HKDF, AES-GCM, session tokens, DEK).
- Supabase OTP auth provider (requires crypto).
- `BearerAuth(encryption_key=...)` currently stores the key but doesn't
  derive a session token — works when the server doesn't demand one.

Open a PR with a scoped addition if you need those sooner.

## License

MIT.
