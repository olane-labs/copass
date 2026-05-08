# copass-anthropic-agents

Anthropic Managed Agents backend for Copass. Depends on [`copass-core-agents`](../copass-core-agents), which owns the vendor-neutral primitives (`BaseAgent`, `AgentTool`, `AgentBackend` ABC, events, `AgentScope`, registries, etc.) shared across every provider-specific Copass SDK.

This package owns the Anthropic-specific piece — `ManagedAgentBackend` and the `CopassManagedAgent` convenience subclass — and re-exports the core primitives for one-line dev imports. Either of these works for consumers:

```python
from copass_anthropic_agents import BaseAgent, CopassManagedAgent  # convenient
# or
from copass_core_agents import BaseAgent                           # explicit boundary
from copass_anthropic_agents import CopassManagedAgent
```

Pairs with Copass's server-side router — both sides import the same code so the agent runtime is a single codepath, whether the agent runs in the dev's process (deep-integration) or server-side via Copass's Router endpoint (thin client).

## Install

```bash
pip install copass-anthropic-agents
```

Requires `anthropic>=0.93.0` (first version shipping the `beta.agents` / `beta.environments` / `beta.sessions` surface).

## Quickstart

```python
import os
from copass_anthropic_agents import (
    AgentInvocationContext,
    AgentScope,
    CopassManagedAgent,
)

agent = CopassManagedAgent(
    identity="support",
    system_prompt="You are a support agent.",
    anthropic_api_key=os.environ["ANTHROPIC_API_KEY"],
)

ctx = AgentInvocationContext(scope=AgentScope(user_id="u-123"))
result = await agent.run(
    messages=[{"role": "user", "content": "Hello"}],
    context=ctx,
)
print(result.final_text)
```

## Streaming

```python
from copass_anthropic_agents import (
    AgentFinish,
    AgentTextDelta,
    AgentToolCall,
    AgentToolResult,
)

async for evt in agent.stream(messages, context=ctx):
    match evt:
        case AgentTextDelta(text=chunk):
            print(chunk, end="", flush=True)
        case AgentToolCall(name=name, arguments=args):
            print(f"\n[tool-call] {name}")
        case AgentToolResult(name=name, result=result):
            print(f"\n[tool-result] {name}")
        case AgentFinish(stop_reason=reason, session_id=sid):
            print(f"\n[finish] {reason} session={sid}")
```

## Multi-turn continuation

The Anthropic managed-agent session holds conversation state. Capture `AgentFinish.session_id` and thread it back on the next turn:

```python
from copass_anthropic_agents import SESSION_ID_HANDLE

ctx2 = AgentInvocationContext(
    scope=AgentScope(user_id="u-123"),
    handles={SESSION_ID_HANDLE: prior_session_id},
)
```

## Custom tools

See `AgentTool` + `AgentToolRegistry` + `AgentToolResolver`. Tools are dispatched locally on tool-use events; provider handles the rest.

```python
from copass_anthropic_agents import AgentTool, AgentToolRegistry, ToolSpec

class EchoTool(AgentTool):
    @property
    def spec(self):
        return ToolSpec(
            name="echo",
            description="Echo a message back.",
            input_schema={
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
        )

    async def invoke(self, arguments, *, context=None):
        return {"echoed": arguments["text"]}


tools = AgentToolRegistry()
tools.add(EchoTool())
agent = CopassManagedAgent(
    identity="support",
    system_prompt="You are helpful.",
    anthropic_api_key=os.environ["ANTHROPIC_API_KEY"],
    tools=tools,
)
```

## Rate-limit note

`ManagedAgentBackend` caches Anthropic-side agent + environment resources per-instance by a fingerprint of `(model, system_prompt, tool_schemas)`. Reusing the backend across requests shares the cache; constructing a fresh backend per request re-creates resources and hits Anthropic's 60-creates/min limit fast. Use the backend as a process-wide singleton in server contexts.

## Context injection (deferred)

A future release will pull Copass's Context Window into `system_prompt` via the reserved `{{copass_context}}` placeholder (see `spec/context-placeholders.md` in this monorepo). Not wired in this release — injection would change `system_prompt` per invocation, invalidating the backend's fingerprint cache.

## Conversation metadata: speaker + participants

When `auto_record=True` (the default when `window` is supplied), the
agent constructs a `CopassTurnRecorder` that auto-populates the
envelope's typed metadata on every turn:

- **`speaker`** — set from the `author` constructor arg on assistant
  turns; falls back to `"User"` / `"Assistant"` from the role on user
  turns.
- **`participants`** — defaults to `["User", author or "Assistant"]`.
  The roster rides on every turn so downstream retrieval can resolve
  second-person pronouns.

```python
agent = CopassManagedAgent(
    identity="support",
    system_prompt="You are helpful.",
    anthropic_api_key=os.environ["ANTHROPIC_API_KEY"],
    window=window,
    author="agent:support-bot",   # → speaker on every assistant turn
    # participants auto-defaults to ["User", "agent:support-bot"]
)
```

If you need a richer roster (multi-party threads) or a logged-in user
identity, build a `CopassTurnRecorder` directly with `participants=...`
and `user_speaker="Alice"`, then pass `auto_record=False` to the agent
and drive recording yourself. See
[`copass-context-agents`](../copass-context-agents) for the recorder
surface and full envelope semantics.

## License

MIT.
