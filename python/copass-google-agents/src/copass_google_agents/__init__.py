"""Copass agent SDK for Google Vertex AI Agent Engine (ADK).

This package owns the Google-specific backend. All provider-neutral
ABCs (``BaseAgent``, ``AgentTool``, ``AgentBackend``, events, scope,
registries) live in :mod:`copass_core_agents` and are re-exported here
for convenience — dev code can import everything it needs from one
place.

Public surface:

    Google-specific (owned here):
        GoogleAgentBackend
        CopassGoogleAgent           — convenience subclass of BaseAgent
        DEFAULT_LOCATION
        DEFAULT_MODEL
        DISPATCH_TOOL_NAME
        SESSION_ID_HANDLE

    Provider-neutral (re-exported from copass_core_agents):
        BaseAgent, AgentScope, AgentInvocationContext
        AgentTool, AgentToolRegistry, AgentToolResolver
        ToolSpec, ToolCall, ToolConflictPolicy, ToolConflictError
        AgentEvent, AgentTextDelta, AgentToolCall, AgentToolResult,
        AgentFinish
        AgentBackend, AgentRunResult
        register_agent, get_agent_class, list_agents
        register_agent_tool, get_agent_tool, try_get_agent_tool,
        list_agent_tools
"""

# Re-export core (vendor-neutral) primitives for one-line imports.
from copass_core_agents import (
    AgentBackend,
    AgentEvent,
    AgentFinish,
    AgentInvocationContext,
    AgentRunResult,
    AgentScope,
    AgentTextDelta,
    AgentTool,
    AgentToolCall,
    AgentToolRegistry,
    AgentToolResolver,
    AgentToolResult,
    BaseAgent,
    ToolCall,
    ToolConflictError,
    ToolConflictPolicy,
    ToolSpec,
    get_agent_class,
    get_agent_tool,
    list_agent_tools,
    list_agents,
    register_agent,
    register_agent_tool,
    try_get_agent_tool,
)

# Google-specific (owned here).
from copass_google_agents.backends.google_agent_backend import (
    DEFAULT_LOCATION,
    DISPATCH_TOOL_NAME,
    SESSION_ID_HANDLE,
    GoogleAgentBackend,
)
from copass_context_agents import (
    CopassTurnRecorder,
    copass_ingest_tool,
    copass_retrieval_tools,
)
from copass_google_agents.google_agent import DEFAULT_MODEL, CopassGoogleAgent

__all__ = [
    # Google-specific
    "CopassGoogleAgent",
    "DEFAULT_MODEL",
    "GoogleAgentBackend",
    "DEFAULT_LOCATION",
    "DISPATCH_TOOL_NAME",
    "SESSION_ID_HANDLE",
    # Copass context-engineering primitives
    "copass_retrieval_tools",
    "copass_ingest_tool",
    "CopassTurnRecorder",
    # Re-exported from copass_core_agents
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
    "AgentEvent",
    "AgentTextDelta",
    "AgentToolCall",
    "AgentToolResult",
    "AgentFinish",
    "AgentBackend",
    "AgentRunResult",
    "register_agent",
    "get_agent_class",
    "list_agents",
    "register_agent_tool",
    "get_agent_tool",
    "try_get_agent_tool",
    "list_agent_tools",
]
