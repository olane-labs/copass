"""High-level Copass agent SDK.

Mirror of ``@copass/agent-router`` on the TypeScript side. Wraps
``copass-core`` and the provider-neutral agent events so one import
runs the full lifecycle: connect an integration, start an agent turn,
stream events.
"""

from copass_agent_router.router import AgentRouter, IntegrationsFacade, RunAgentOptions
from copass_agent_router.connect_flow import ConnectFlowResult, run_connect_flow
from copass_core_agents.events import (
    AgentEvent,
    AgentFinish,
    AgentTextDelta,
    AgentToolCall,
    AgentToolResult,
)

__all__ = [
    "AgentRouter",
    "IntegrationsFacade",
    "RunAgentOptions",
    "ConnectFlowResult",
    "run_connect_flow",
    "AgentEvent",
    "AgentTextDelta",
    "AgentToolCall",
    "AgentToolResult",
    "AgentFinish",
]

__version__ = "0.1.0"
