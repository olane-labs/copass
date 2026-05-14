"""Anthropic agent backends.

Re-exports the core ``AgentBackend`` / ``AgentRunResult`` ABCs
(implemented in ``copass-core-agents``) alongside this package's
Anthropic-specific ``ManagedAgentBackend`` (v1) and
``ManagedAgentBackendV2`` (ADR 0001).

Phase 1 of ADR 0001 keeps v1 as the default; v2 is opt-in at the
sub-module import path. The top-level
``copass_anthropic_agents/__init__.py`` is deliberately NOT modified
to advertise v2 — adopters who want it import from
``copass_anthropic_agents.backends`` directly. Phase 4 of the ADR
flips that.
"""

from copass_anthropic_agents.backends.managed_agent_backend import (
    DEFAULT_ENVIRONMENT_CONFIG,
    SESSION_ID_HANDLE,
    ManagedAgentBackend,
)

# v2 — ADR 0001. See module docstrings for the cycle model and the
# rationale for the registry seam.
from copass_anthropic_agents.backends.backend_run_policy import BackendRunPolicy
from copass_anthropic_agents.backends.in_memory_provider_binding_registry import (
    InMemoryProviderBindingRegistry,
)
from copass_anthropic_agents.backends.managed_agent_backend_v2 import (
    ManagedAgentBackendV2,
)
from copass_anthropic_agents.backends.pending_tool_call import (
    CustomToolCall,
    McpToolCall,
    PendingToolCall,
    ServerToolCall,
)
from copass_anthropic_agents.backends.provider_binding_registry import (
    ProviderBinding,
    ProviderBindingRegistry,
)
from copass_anthropic_agents.backends.requires_action_cycle import (
    MissingPendingToolCallError,
    OutOfCycleReplyError,
    RequiresActionCycle,
)
from copass_core_agents.backends import AgentBackend, AgentRunResult

__all__ = [
    "AgentBackend",
    "AgentRunResult",
    # v1
    "ManagedAgentBackend",
    "DEFAULT_ENVIRONMENT_CONFIG",
    "SESSION_ID_HANDLE",
    # v2 — ADR 0001
    "ManagedAgentBackendV2",
    "BackendRunPolicy",
    "ProviderBindingRegistry",
    "ProviderBinding",
    "InMemoryProviderBindingRegistry",
    "PendingToolCall",
    "CustomToolCall",
    "ServerToolCall",
    "McpToolCall",
    "RequiresActionCycle",
    "MissingPendingToolCallError",
    "OutOfCycleReplyError",
]
