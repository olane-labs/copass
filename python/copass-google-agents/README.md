# copass-google-agents

Google Vertex AI **Agent Engine** (ADK) backend for Copass. Depends on [`copass-core-agents`](../copass-core-agents), which owns the vendor-neutral primitives (`BaseAgent`, `AgentTool`, `AgentBackend` ABC, events, `AgentScope`, registries, etc.) shared across every provider-specific Copass SDK.

This package owns the Google-specific piece — `GoogleAgentBackend` and the `CopassGoogleAgent` convenience subclass — and re-exports the core primitives for one-line dev imports. Either of these works for consumers:

```python
from copass_google_agents import BaseAgent, CopassGoogleAgent  # convenient
# or
from copass_core_agents import BaseAgent                       # explicit boundary
from copass_google_agents import CopassGoogleAgent
```

Pairs with Copass's server-side router — both sides import the same code so the agent runtime is a single codepath, whether the agent runs in the dev's process or server-side via Copass's Router endpoint.

> **Status: scaffold (v0.1.0).** Constructors, type surface, and public imports are in place. `GoogleAgentBackend.run` / `GoogleAgentBackend.stream` / `deploy_adk_agent` / `adk_event_to_agent_events` currently raise `NotImplementedError`. Implementation lands in a follow-up pass.

## Install

```bash
pip install copass-google-agents
```

Requires `google-cloud-aiplatform[agent_engines,adk]>=1.148.1` (which pulls in `google-adk>=1.31`). Uses Application Default Credentials (ADC) — run `gcloud auth application-default login` locally, or set `GOOGLE_APPLICATION_CREDENTIALS` / attach a service account.

## Architecture

Agent Engine diverges from Claude Managed Agents in one important way: **ADK agents are pre-deployed resources** (`projects/{p}/locations/{l}/reasoningEngines/{id}`) and their **tools are baked in at deploy time**. You cannot pass tools per-run.

To preserve Copass's `AgentToolResolver` runtime-plug model, `copass-google-agents` deploys ADK agents carrying a single `copass_dispatch(tool_name, arguments)` function tool. At run time that proxy calls back into your Copass service, which hosts the real resolver and invokes the right tool for the current user.

So:
- **`GoogleAgentBackend`** is *session-only* — streams queries against a pre-deployed engine.
- **`deploy_adk_agent`** (ops helper) is the one-time setup that wires the proxy tool into a new ADK agent resource.
- **Zero client-side tools** is the expected case. `CopassGoogleAgent` defaults to an empty `AgentToolRegistry`.

## Quickstart (planned — not functional in the scaffold)

```python
import os
from copass_google_agents import (
    AgentInvocationContext,
    AgentScope,
    CopassGoogleAgent,
)

agent = CopassGoogleAgent(
    identity="support",
    system_prompt="You are a support agent.",
    project=os.environ["GOOGLE_CLOUD_PROJECT"],
    reasoning_engine_id=os.environ["COPASS_REASONING_ENGINE_ID"],
)

ctx = AgentInvocationContext(scope=AgentScope(user_id="u-123"))
result = await agent.run(
    messages=[{"role": "user", "content": "Hello"}],
    context=ctx,
)
print(result.final_text)
```

## Streaming (planned)

```python
from copass_google_agents import (
    AgentFinish,
    AgentTextDelta,
    AgentToolCall,
    AgentToolResult,
)

async for evt in agent.stream(messages, context=ctx):
    match evt:
        case AgentTextDelta(text=chunk):
            print(chunk, end="", flush=True)
        case AgentToolCall(name=name):
            print(f"\n[tool-call] {name}")
        case AgentToolResult(name=name):
            print(f"\n[tool-result] {name}")
        case AgentFinish(stop_reason=reason, session_id=sid):
            print(f"\n[finish] {reason} session={sid}")
```

## Multi-turn continuation (planned)

Agent Engine sessions hold conversation state. Capture `AgentFinish.session_id` and thread it back on the next turn:

```python
from copass_google_agents import SESSION_ID_HANDLE

ctx2 = AgentInvocationContext(
    scope=AgentScope(user_id="u-123"),
    handles={SESSION_ID_HANDLE: prior_session_id},
)
```

## Deploying an ADK agent (planned)

```python
from copass_google_agents.deploy import deploy_adk_agent

engine = deploy_adk_agent(
    display_name="support-agent",
    project="my-gcp-project",
    system_prompt="You are a support agent...",
    copass_api_url="https://api.copass.id",
)
print(engine.resource_name)  # feed into CopassGoogleAgent(reasoning_engine_id=...)
```

The deployed engine no longer bakes a fixed API key. Per-call
authentication flows through the ADK session: the calling Copass
server populates `state["copass_api_key"]` on each session via
`async_create_session(state={...})`; the proxy tool reads it from
`tool_context.state` on every invocation.

## License

MIT.
