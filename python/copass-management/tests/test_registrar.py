"""Smoke test for register_management_tools — confirms every spec
entry gets a registration with a working handler."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, List
from unittest.mock import patch

import httpx
import pytest
import respx

from copass_core import ApiKeyAuth, CopassClient

from copass_management import (
    RegistrarOptions,
    ToolRegistration,
    register_management_tools,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
SPEC_DIR = REPO_ROOT / "spec" / "management" / "v1"


@pytest.fixture
def client() -> CopassClient:
    return CopassClient(auth=ApiKeyAuth(key="olk_test"), api_url="http://test")


def test_registers_all_tools_with_spec_names(client: CopassClient) -> None:
    """Every spec entry must bind to a handler — production wiring
    leaves ``allow_missing_handlers`` off."""
    registered: List[ToolRegistration] = []
    register_management_tools(
        registered.append,
        client,
        RegistrarOptions(sandbox_id="sb_test", spec_dir=SPEC_DIR),
    )
    assert len(registered) == 20
    names = sorted(r.name for r in registered)
    assert names == sorted(
        [
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
    )
    for reg in registered:
        assert callable(reg.handler)
        assert isinstance(reg.description, str) and reg.description
        assert isinstance(reg.input_schema, dict)
        assert isinstance(reg.output_schema, dict)


@respx.mock
async def test_registered_handler_invokes_core_client(client: CopassClient) -> None:
    respx.get("http://test/api/v1/storage/sandboxes").mock(
        return_value=httpx.Response(200, json={"sandboxes": [], "count": 0})
    )

    registered: List[ToolRegistration] = []
    register_management_tools(
        registered.append,
        client,
        RegistrarOptions(sandbox_id="sb_test", spec_dir=SPEC_DIR),
    )

    list_sandboxes = next(r for r in registered if r.name == "list_sandboxes")
    result = await list_sandboxes.handler({})
    assert result == {"sandboxes": [], "count": 0}


def test_registrar_validates_input_against_schema(client: CopassClient) -> None:
    registered: List[ToolRegistration] = []
    register_management_tools(
        registered.append,
        client,
        RegistrarOptions(sandbox_id="sb_test", spec_dir=SPEC_DIR),
    )

    get_agent = next(r for r in registered if r.name == "get_agent")
    # `get_agent` requires `slug`; calling with empty input must fail
    # the input validator.
    import asyncio
    from jsonschema import ValidationError

    with pytest.raises(ValidationError):
        asyncio.run(get_agent.handler({}))
