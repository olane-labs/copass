# copass-config

Canonical strings shared across every Python Copass adapter. Python mirror of [`@copass/config`](../../typescript/packages/config).

This package owns the **single source of truth** (for Python) for:

- Tool descriptions the LLM sees (`DISCOVER_DESCRIPTION`, `INTERPRET_DESCRIPTION`, `SEARCH_DESCRIPTION`, `MCP_DISCOVER_DESCRIPTION`)
- Parameter descriptions (`DISCOVER_QUERY_PARAM`, `INTERPRET_ITEMS_PARAM`, etc.)
- System prompts (`COPASS_AGENT_MCP_SYSTEM_PROMPT`, `COPASS_AGENT_SDK_SYSTEM_PROMPT`)

Every Python Copass adapter (`copass-pydantic-ai`, `copass-langchain`, `copass-anthropic-agents`, etc.) imports from here so the LLM sees identical tool semantics regardless of framework wrapping.

## Install

```bash
pip install copass-config
```

Zero runtime dependencies.

## Usage

```python
from copass_config import DISCOVER_DESCRIPTION, COPASS_AGENT_SDK_SYSTEM_PROMPT

# Register a tool whose LLM-facing description matches every other
# Copass adapter:
my_tool = Tool(
    name="discover",
    description=DISCOVER_DESCRIPTION,
    ...
)

# Seed an agent with the canonical Copass system prompt:
agent = BaseAgent(
    identity="copass-agent",
    system_prompt=COPASS_AGENT_SDK_SYSTEM_PROMPT,
    ...
)
```

## Keeping in sync with `@copass/config`

This package is hand-ported from the TS source. When the TS side changes:

1. Update the matching constant in `src/copass_config/`.
2. Bump the minor version in `pyproject.toml` and `__init__.py`.
3. Republish.

A future release may auto-generate these constants from the TS package's build artifacts.

## License

MIT.
