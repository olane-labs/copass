"""Copass Core Agents — provider-neutral agent primitives.

Shared ABCs and value types used by every provider-specific Copass
agent SDK (``copass-anthropic-agents``, future ``copass-openai-agents``,
``copass-google-agents``, etc.). Concrete backends, convenience
subclasses, and vendor-specific wiring live in those per-provider
packages; this package owns nothing vendor-specific.

Public surface:

    Core
        BaseAgent               — identity + prompt + tools + backend
        AgentScope              — tenancy payload
        AgentInvocationContext  — per-call runtime context
        AgentTool               — ABC for a tool an agent can invoke
        AgentToolRegistry       — per-agent collection of tools
        AgentToolResolver       — scope-aware dynamic tool producer
        ToolSpec, ToolCall      — tool catalog shapes
        ToolConflictPolicy      — "error" | "dynamic_wins" | "static_wins"
        ToolConflictError

    Events (emitted by AgentBackend.stream)
        AgentEvent              — tagged union
        AgentTextDelta
        AgentToolCall
        AgentToolResult
        AgentFinish

    Backends
        AgentBackend            — ABC (concrete impls live per-provider)
        AgentRunResult          — reduced run() output

    Registries (optional lookup-by-name)
        register_agent, get_agent_class, list_agents
        register_agent_tool, get_agent_tool, try_get_agent_tool,
        list_agent_tools
"""

from copass_core_agents.backends import AgentBackend, AgentRunResult
from copass_core_agents.base_agent import BaseAgent
from copass_core_agents.base_tool import AgentTool, ToolCall, ToolSpec
from copass_core_agents.events import (
    AgentEvent,
    AgentFinish,
    AgentTextDelta,
    AgentToolCall,
    AgentToolResult,
)
from copass_core_agents.invocation_context import AgentInvocationContext
from copass_core_agents.registry import (
    get_agent_class,
    get_agent_tool,
    list_agent_tools,
    list_agents,
    register_agent,
    register_agent_tool,
    try_get_agent_tool,
)
from copass_core_agents.scope import AgentScope
from copass_core_agents.tool_registry import AgentToolRegistry
from copass_core_agents.tool_resolver import (
    AgentToolResolver,
    ToolConflictError,
    ToolConflictPolicy,
)

__all__ = [
    # Core
    "BaseAgent",
    "AgentScope",
    "AgentInvocationContext",
    "AgentTool",
    "AgentToolRegistry",
    "AgentToolResolver",
    "ToolSpec",
    "ToolCall",
    "ToolConflictError",
    "ToolConflictPolicy",
    # Events
    "AgentEvent",
    "AgentTextDelta",
    "AgentToolCall",
    "AgentToolResult",
    "AgentFinish",
    # Backends
    "AgentBackend",
    "AgentRunResult",
    # Registries
    "register_agent",
    "get_agent_class",
    "list_agents",
    "register_agent_tool",
    "get_agent_tool",
    "try_get_agent_tool",
    "list_agent_tools",
]
