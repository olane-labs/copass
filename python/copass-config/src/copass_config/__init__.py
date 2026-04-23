"""Canonical strings shared across every Copass agent adapter.

Python mirror of ``@copass/config``. Single source of truth for tool
descriptions, parameter descriptions, and system prompts used by every
Python Copass adapter (``copass-pydantic-ai``, ``copass-langchain``,
``copass-anthropic-agents``, future MCP server, etc.). Editing here
and rebuilding the adapters keeps the LLM surface identical regardless
of framework wrapping.

If the TS ``@copass/config`` package changes, update the Python
constants to match and bump this package's minor version.
"""

from copass_config.param_descriptions import (
    DISCOVER_QUERY_PARAM,
    INTERPRET_ITEMS_PARAM,
    INTERPRET_QUERY_PARAM,
    PRESET_PARAM,
    PROJECT_ID_PARAM,
    SEARCH_QUERY_PARAM,
)
from copass_config.system_prompts import (
    COPASS_AGENT_MCP_SYSTEM_PROMPT,
    COPASS_AGENT_SDK_SYSTEM_PROMPT,
)
from copass_config.tool_descriptions import (
    DISCOVER_DESCRIPTION,
    INTERPRET_DESCRIPTION,
    MCP_DISCOVER_DESCRIPTION,
    SEARCH_DESCRIPTION,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    # Tool descriptions
    "DISCOVER_DESCRIPTION",
    "MCP_DISCOVER_DESCRIPTION",
    "INTERPRET_DESCRIPTION",
    "SEARCH_DESCRIPTION",
    # Param descriptions
    "DISCOVER_QUERY_PARAM",
    "INTERPRET_QUERY_PARAM",
    "SEARCH_QUERY_PARAM",
    "INTERPRET_ITEMS_PARAM",
    "PROJECT_ID_PARAM",
    "PRESET_PARAM",
    # System prompts
    "COPASS_AGENT_MCP_SYSTEM_PROMPT",
    "COPASS_AGENT_SDK_SYSTEM_PROMPT",
]
