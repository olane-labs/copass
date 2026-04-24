# copass-agent-router

High-level Copass agent SDK. Python mirror of [`@copass/agent-router`](../../typescript/packages/agent-router) — wraps `copass-core` + `copass-core-agents` into a one-import surface that runs a full agent lifecycle: connect an integration, run an agent turn, stream events.

## Install

```bash
pip install copass-agent-router
```

## Quickstart

```python
import asyncio, webbrowser
from copass_agent_router import AgentRouter, RunAgentOptions
from copass_core import ApiKeyAuth

async def main():
    router = AgentRouter(
        auth=ApiKeyAuth(key="olk_..."),
        sandbox_id="sb_...",
    )

    # Connect an integration (OAuth, local browser, webhook fallback via reconcile).
    result = await router.integrations.connect(
        "github",
        on_connect_url=lambda url: webbrowser.open(url),
    )
    print("connected:", result.connection["app"], result.connection["name"])

    # Run an agent.
    async for event in router.run(RunAgentOptions(
        provider="anthropic",
        model="claude-opus-4-7",
        system="You are a helpful agent.",
        message="Summarize my latest GitHub issues.",
        end_user_id="u-123",
    )):
        t = type(event).__name__
        if t == "AgentTextDelta":
            print(event.text, end="", flush=True)
        elif t == "AgentFinish":
            print(f"\n[done] {event.stop_reason}")

asyncio.run(main())
```

## License

MIT.
