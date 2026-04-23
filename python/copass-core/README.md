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

    # Context for agent
    context = await client.context.for_agent(
        sandbox_id="sb_...",
        tier="adaptive",
        query="auth flow",
    )
    print(context)

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
await client.context.for_agent(sandbox_id="...", tier="adaptive")

# Storage layer
await client.sandboxes.create(name="...", owner_id="...")
await client.sources.register(sandbox_id, provider="custom", name="...")
await client.ingest.text_in_sandbox(sandbox_id, text="...")
await client.projects.create(sandbox_id, name="...")
await client.vault.store(sandbox_id, "key/path", b"bytes")

# Knowledge graph
await client.entities.search(sandbox_id, q="auth")
await client.matrix.query(query="...")

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
