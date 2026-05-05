"""Spec-driven management tool registrar for Copass agents (Python).

Phase 1 ships the read-only subset (14 tools). Write tools land in
Phase 2.

Public surface::

    from copass_management import (
        register_management_tools,
        register_to_mcp_server,
        load_management_specs,
        MIN_SPEC_VERSION,
        MAX_SPEC_VERSION,
    )
"""

from copass_management.adapters.mcp import register_to_mcp_server
from copass_management.registrar import (
    Register,
    RegistrarOptions,
    ToolContext,
    ToolHandler,
    ToolRegistration,
    register_management_tools,
)
from copass_management.specs import (
    LoadedManagementCorpus,
    ManagementFixture,
    ManagementSpec,
    MAX_SPEC_VERSION,
    MIN_SPEC_VERSION,
    load_management_specs,
)

__all__ = [
    "Register",
    "RegistrarOptions",
    "ToolContext",
    "ToolHandler",
    "ToolRegistration",
    "register_management_tools",
    "register_to_mcp_server",
    "load_management_specs",
    "LoadedManagementCorpus",
    "ManagementFixture",
    "ManagementSpec",
    "MIN_SPEC_VERSION",
    "MAX_SPEC_VERSION",
]
