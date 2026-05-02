"""Copass agent SDK for Hermes (NousResearch hermes-agent) via OpenRouter.

This package owns the Hermes-specific backend. All provider-neutral
ABCs live in ``copass_core_agents`` and are re-exported here for
convenience.

Public surface:

    Hermes-specific (owned here):
        HermesAgentBackend
        CopassHermesAgent       — convenience subclass of BaseAgent
        DEFAULT_MODEL
        HERMES_MODEL_PREFIX

    Provider-neutral (re-exported from copass_core_agents):
        BaseAgent, AgentScope, AgentInvocationContext
        AgentTool, AgentToolRegistry, AgentToolResolver
        ToolSpec, ToolCall, ToolConflictPolicy, ToolConflictError
        AgentEvent, AgentTextDelta, AgentToolCall, AgentToolResult,
        AgentFinish
        AgentBackend, AgentRunResult
"""

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
)

from copass_hermes_agents.backends.hermes_agent_backend import (
    HERMES_MODEL_PREFIX,
    HermesAgentBackend,
)
from copass_hermes_agents.hermes_agent import (
    DEFAULT_MODEL,
    CopassHermesAgent,
)

# Re-export context-engineering primitives for symmetry with the
# anthropic / google packages.
from copass_context_agents import (
    CopassTurnRecorder,
    copass_ingest_tool,
    copass_retrieval_tools,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    # Hermes-specific
    "CopassHermesAgent",
    "DEFAULT_MODEL",
    "HermesAgentBackend",
    "HERMES_MODEL_PREFIX",
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
]
