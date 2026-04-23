# copass-langchain

LangChain tool adapters for Copass. Python mirror of [`@copass/langchain`](../../typescript/packages/langchain). Pulls `discover` / `interpret` / `search` into any LangChain agent, and (optionally) wires them into LangGraph's ReAct prebuilt.

## Install

```bash
pip install copass-langchain
# or, with the create_copass_agent convenience wrapper:
pip install copass-langchain[agent]
```

Depends on `copass-core` + `copass-config` + `langchain-core`. `langgraph` is optional — only needed for `create_copass_agent`.

## Drop-in tools

```python
from copass_core import ApiKeyAuth, CopassClient
from copass_langchain import copass_tools

client = CopassClient(auth=ApiKeyAuth(key="olk_..."))

tools = copass_tools(client=client, sandbox_id="sb_...")
# Pass `tools.all()` (a list of three StructuredTool instances) to your
# agent framework, or pull them individually:
# tools.discover, tools.interpret, tools.search
```

Tool descriptions and parameter descriptions come from `copass-config` — identical to the strings used across every other Copass adapter.

## Window-aware retrieval (when a Context Window exists)

`copass-core` v0.1 does not yet ship a `ContextWindow` class (deferred to v0.2). Until then, `copass_tools` and `CopassWindowCallback` accept any object satisfying `ContextWindowLike`:

```python
class ContextWindowLike(Protocol):
    def get_turns(self) -> list[ChatMessage]: ...
    def add_turn(self, turn: ChatMessage) -> Awaitable[None]: ...
```

When `copass-core` ships `ContextWindow`, it will satisfy this protocol and window-aware retrieval will light up without any consumer changes.

## Full agent in one call

```python
from copass_langchain import create_copass_agent
from langchain_anthropic import ChatAnthropic

agent = create_copass_agent(
    client=client,
    sandbox_id="sb_...",
    llm=ChatAnthropic(model="claude-opus-4-7"),
    # window=my_window,  # optional — enables window-aware retrieval + auto-mirroring
)

result = await agent.ainvoke({
    "messages": [("user", "why is checkout flaky?")]
})
```

## Status

- `copass_tools` — shipped.
- `CopassWindowCallback` — shipped (generic on `ContextWindowLike`).
- `create_copass_agent` — shipped (lazy-imports `langgraph`).
- First-class `ContextWindow` integration — lands when `copass-core` v0.2 ships the primitive.

## License

MIT.
