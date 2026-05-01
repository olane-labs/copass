"""Per-tool handler modules. Each module exposes a single async handler
that takes ``(ctx, input)`` and returns the parsed response."""

from typing import Any, Awaitable, Callable, Dict, TYPE_CHECKING

if TYPE_CHECKING:
    from copass_management.registrar import ToolContext

ToolHandler = Callable[["ToolContext", Dict[str, Any]], Awaitable[Any]]

from copass_management.tools.add_user_mcp_source import add_user_mcp_source
from copass_management.tools.create_agent import create_agent
from copass_management.tools.get_agent import get_agent
from copass_management.tools.get_run_trace import get_run_trace
from copass_management.tools.get_source import get_source
from copass_management.tools.list_agent_tools import list_agent_tools
from copass_management.tools.list_agents import list_agents
from copass_management.tools.list_api_keys import list_api_keys
from copass_management.tools.list_apps import list_apps
from copass_management.tools.list_connected_accounts import list_connected_accounts
from copass_management.tools.list_runs import list_runs
from copass_management.tools.list_sandbox_connections import list_sandbox_connections
from copass_management.tools.list_sandboxes import list_sandboxes
from copass_management.tools.list_sources import list_sources
from copass_management.tools.list_trigger_components import list_trigger_components
from copass_management.tools.list_triggers import list_triggers
from copass_management.tools.update_agent_prompt import update_agent_prompt
from copass_management.tools.update_agent_tool_sources import update_agent_tool_sources
from copass_management.tools.update_agent_tools import update_agent_tools
from copass_management.tools.wire_integration_to_agent import wire_integration_to_agent


TOOL_HANDLERS: Dict[str, ToolHandler] = {
    "list_sandboxes": list_sandboxes,
    "list_sources": list_sources,
    "get_source": get_source,
    "list_agents": list_agents,
    "get_agent": get_agent,
    "list_triggers": list_triggers,
    "list_runs": list_runs,
    "get_run_trace": get_run_trace,
    "list_trigger_components": list_trigger_components,
    "list_apps": list_apps,
    "list_connected_accounts": list_connected_accounts,
    "list_api_keys": list_api_keys,
    "list_agent_tools": list_agent_tools,
    "list_sandbox_connections": list_sandbox_connections,
    "create_agent": create_agent,
    "update_agent_prompt": update_agent_prompt,
    "update_agent_tools": update_agent_tools,
    "update_agent_tool_sources": update_agent_tool_sources,
    "add_user_mcp_source": add_user_mcp_source,
    "wire_integration_to_agent": wire_integration_to_agent,
}


__all__ = [
    "TOOL_HANDLERS",
    "ToolHandler",
    "add_user_mcp_source",
    "create_agent",
    "get_agent",
    "get_run_trace",
    "get_source",
    "list_agent_tools",
    "list_agents",
    "list_api_keys",
    "list_apps",
    "list_connected_accounts",
    "list_runs",
    "list_sandbox_connections",
    "list_sandboxes",
    "list_sources",
    "list_trigger_components",
    "list_triggers",
    "update_agent_prompt",
    "update_agent_tool_sources",
    "update_agent_tools",
    "wire_integration_to_agent",
]
