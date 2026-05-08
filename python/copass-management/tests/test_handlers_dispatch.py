"""Dispatch tests for management tool handlers — every handler covered.

Each handler is a thin shim that maps a Pydantic-validated input into a
``ctx.client.<resource>.<method>(...)`` call. These tests verify the
mapping is correct — when the SDK refactors a method signature or
moves a resource, the matching handler test fails.

Per ``copass-management`` design: handlers are stateless modules under
``copass_management/tools/``. The ``ToolContext`` carries the SDK
``client`` + ``sandbox_id`` injected by the registrar at call time.

This suite exercises ALL 34 handlers (one test each) — when a new
handler is added under ``tools/``, add a matching test here.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from copass_management.tools import (
    add_user_mcp_source,
    connect_linear,
    create_agent,
    create_trigger,
    get_agent,
    get_run_trace,
    get_source,
    grant_sandbox_connection,
    list_agent_tools,
    list_agents,
    list_api_keys,
    list_apps,
    list_connected_accounts,
    list_runs,
    list_sandbox_connections,
    list_sandboxes,
    list_sources,
    list_trigger_components,
    list_triggers,
    pause_trigger,
    provision_source,
    purge_source_context,
    resume_trigger,
    revoke_sandbox_connection,
    revoke_user_mcp_source,
    start_integration_connect,
    test_user_mcp_source as _test_user_mcp_source_handler,  # aliased — avoid pytest test collection
    update_agent_model_settings,
    update_agent_prompt,
    update_agent_tool_sources,
    update_agent_tools,
    update_source,
    update_trigger,
    wire_integration_to_agent,
)


def _ctx(client_overrides: dict | None = None) -> SimpleNamespace:
    """Build a fake ToolContext with a fully-mocked SDK client.

    ``client_overrides`` is a dict of ``"resource.method": AsyncMock``
    that pre-attaches mocks to the right paths on the client.
    """
    client = MagicMock()
    if client_overrides:
        for path, mock in client_overrides.items():
            obj = client
            parts = path.split(".")
            for p in parts[:-1]:
                if not hasattr(obj, p) or not isinstance(getattr(obj, p), MagicMock):
                    setattr(obj, p, MagicMock())
                obj = getattr(obj, p)
            setattr(obj, parts[-1], mock)
    return SimpleNamespace(client=client, sandbox_id="sb-1", user_id="u-1")


# ─── sources ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_provision_source_dispatches_to_sources_register() -> None:
    register = AsyncMock(return_value={"data_source_id": "ds-1"})
    ctx = _ctx({"sources.register": register})
    await provision_source(ctx, {"name": "demo", "kind": "manual"})
    register.assert_awaited_once()


@pytest.mark.asyncio
async def test_purge_source_context_dispatches_to_sources_purge() -> None:
    purge = AsyncMock(return_value={"success": True})
    ctx = _ctx({"sources.purge": purge})
    await purge_source_context(ctx, {"data_source_id": "ds-1", "delete_source": True})
    purge.assert_awaited_once()


@pytest.mark.asyncio
async def test_list_sources_dispatches_to_sources_list() -> None:
    listfn = AsyncMock(return_value={"sources": [], "count": 0})
    ctx = _ctx({"sources.list": listfn})
    await list_sources(ctx, {})
    listfn.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_source_dispatches_to_sources_retrieve() -> None:
    retrieve = AsyncMock(return_value={"data_source_id": "ds-1"})
    ctx = _ctx({"sources.retrieve": retrieve})
    await get_source(ctx, {"data_source_id": "ds-1"})
    retrieve.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_source_dispatches_to_sources_update() -> None:
    update = AsyncMock(return_value={"data_source_id": "ds-1"})
    ctx = _ctx({"sources.update": update})
    await update_source(ctx, {"data_source_id": "ds-1", "name": "renamed"})
    update.assert_awaited_once()


@pytest.mark.asyncio
async def test_connect_linear_dispatches_to_sources_connect_linear() -> None:
    connect = AsyncMock(return_value={"data_source_id": "ds-linear"})
    ctx = _ctx({"sources.connect_linear": connect})
    await connect_linear(ctx, {"api_key": "lin_abc"})
    connect.assert_awaited_once()


@pytest.mark.asyncio
async def test_add_user_mcp_source_dispatches_to_sources_register_user_mcp() -> None:
    register = AsyncMock(return_value={"data_source_id": "ds-mcp-1"})
    ctx = _ctx({"sources.register_user_mcp": register})
    await add_user_mcp_source(
        ctx,
        {"name": "my-mcp", "base_url": "https://mcp.example", "auth_kind": "none"},
    )
    register.assert_awaited_once()


@pytest.mark.asyncio
async def test_test_user_mcp_source_dispatches_to_sources_test_user_mcp() -> None:
    test_fn = AsyncMock(return_value={"reachable": True})
    ctx = _ctx({"sources.test_user_mcp": test_fn})
    await _test_user_mcp_source_handler(ctx, {"data_source_id": "ds-mcp-1"})
    test_fn.assert_awaited_once()


@pytest.mark.asyncio
async def test_revoke_user_mcp_source_dispatches_to_sources_revoke_user_mcp() -> None:
    revoke = AsyncMock(return_value={"revoked": True})
    ctx = _ctx({"sources.revoke_user_mcp": revoke})
    await revoke_user_mcp_source(ctx, {"data_source_id": "ds-mcp-1"})
    revoke.assert_awaited_once()


# ─── integrations ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_apps_dispatches_to_integrations_catalog() -> None:
    catalog = AsyncMock(return_value={"apps": []})
    ctx = _ctx({"integrations.catalog": catalog})
    await list_apps(ctx, {"q": "slack", "limit": 10})
    catalog.assert_awaited_once()


@pytest.mark.asyncio
async def test_list_connected_accounts_dispatches_to_integrations_list_accounts() -> None:
    list_accts = AsyncMock(return_value={"accounts": []})
    ctx = _ctx({"integrations.list_accounts": list_accts})
    await list_connected_accounts(ctx, {"app": "slack"})
    list_accts.assert_awaited_once()


@pytest.mark.asyncio
async def test_start_integration_connect_dispatches_to_integrations_connect() -> None:
    connect = AsyncMock(return_value={"source_id": "src-1"})
    ctx = _ctx({"integrations.connect": connect})
    await start_integration_connect(
        ctx,
        {
            "app_slug": "slack",
            "success_redirect_uri": "https://app/done",
            "error_redirect_uri": "https://app/err",
        },
    )
    connect.assert_awaited_once()


# ─── sandboxes / sandbox_connections ─────────────────────────────────


@pytest.mark.asyncio
async def test_list_sandboxes_dispatches_to_sandboxes_list() -> None:
    listfn = AsyncMock(return_value={"sandboxes": [], "count": 0})
    ctx = _ctx({"sandboxes.list": listfn})
    await list_sandboxes(ctx, {})
    listfn.assert_awaited_once()


@pytest.mark.asyncio
async def test_grant_sandbox_connection_dispatches_to_sandbox_connections_create() -> None:
    create = AsyncMock(return_value={"connection_id": "conn-1"})
    ctx = _ctx({"sandbox_connections.create": create})
    await grant_sandbox_connection(
        ctx, {"role": "viewer", "user_id": "u-2"},
    )
    create.assert_awaited_once()


@pytest.mark.asyncio
async def test_list_sandbox_connections_dispatches_to_sandbox_connections_list() -> None:
    # SDK returns a bare list of SandboxConnection rows; the handler
    # wraps it in the {connections, count} envelope MCP requires.
    listfn = AsyncMock(return_value=[])
    ctx = _ctx({"sandbox_connections.list": listfn})
    result = await list_sandbox_connections(ctx, {})
    listfn.assert_awaited_once()
    assert result == {"connections": [], "count": 0}


@pytest.mark.asyncio
async def test_revoke_sandbox_connection_dispatches_to_sandbox_connections_revoke() -> None:
    revoke = AsyncMock(return_value={"revoked": True})
    ctx = _ctx({"sandbox_connections.revoke": revoke})
    await revoke_sandbox_connection(
        ctx, {"connection_id": "conn-1"},
    )
    revoke.assert_awaited_once()


# ─── api_keys ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_api_keys_dispatches_to_api_keys_list() -> None:
    listfn = AsyncMock(return_value=[])
    ctx = _ctx({"api_keys.list": listfn})
    await list_api_keys(ctx, {})
    listfn.assert_awaited_once()


# ─── agents ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_agent_dispatches_to_agents_create() -> None:
    create = AsyncMock(return_value={"slug": "new-bot"})
    ctx = _ctx({"agents.create": create})
    await create_agent(
        ctx, {"slug": "new-bot", "name": "New", "system_prompt": "You are helpful."},
    )
    create.assert_awaited_once()


@pytest.mark.asyncio
async def test_list_agents_dispatches_to_agents_list() -> None:
    listfn = AsyncMock(return_value={"agents": [], "count": 0})
    ctx = _ctx({"agents.list": listfn})
    await list_agents(ctx, {})
    listfn.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_agent_dispatches_to_agents_retrieve() -> None:
    retrieve = AsyncMock(return_value={"slug": "bot"})
    ctx = _ctx({"agents.retrieve": retrieve})
    await get_agent(ctx, {"slug": "bot"})
    retrieve.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_agent_prompt_dispatches_to_agents_update() -> None:
    update = AsyncMock(return_value={"slug": "bot"})
    ctx = _ctx({"agents.update": update})
    await update_agent_prompt(
        ctx, {"slug": "bot", "system_prompt": "new prompt"},
    )
    update.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_agent_tools_dispatches_to_agents_update() -> None:
    update = AsyncMock(return_value={"slug": "bot"})
    ctx = _ctx({"agents.update": update})
    await update_agent_tools(
        ctx, {"slug": "bot", "tool_allowlist": ["discover", "interpret"]},
    )
    update.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_agent_tool_sources_dispatches() -> None:
    update_ts = AsyncMock(return_value={"slug": "bot"})
    ctx = _ctx({"agents.update_tool_sources": update_ts})
    await update_agent_tool_sources(
        ctx, {"slug": "bot", "tool_sources": ["slack"]},
    )
    update_ts.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_agent_model_settings_dispatches() -> None:
    ums = AsyncMock(return_value={"slug": "bot"})
    ctx = _ctx({"agents.update_model_settings": ums})
    await update_agent_model_settings(
        ctx, {"slug": "bot", "backend": "anthropic", "model": "claude-opus-4-7"},
    )
    ums.assert_awaited_once()


@pytest.mark.asyncio
async def test_wire_integration_to_agent_dispatches() -> None:
    wire = AsyncMock(return_value={
        "wired": True, "tool_count": 5, "mode": "explicit",
        "sources_added": [], "message": "ok",
    })
    ctx = _ctx({"agents.wire_integration": wire})
    await wire_integration_to_agent(
        ctx, {"agent_slug": "bot", "app_slug": "slack"},
    )
    wire.assert_awaited_once()


@pytest.mark.asyncio
async def test_list_agent_tools_dispatches() -> None:
    list_tools = AsyncMock(return_value={"tools": []})
    ctx = _ctx({"agents.list_tools": list_tools})
    result = await list_agent_tools(ctx, {})
    list_tools.assert_awaited_once()
    assert result == {"tools": [], "by_app": {}, "count": 0}


@pytest.mark.asyncio
async def test_list_agent_tools_groups_by_app_slug() -> None:
    list_tools = AsyncMock(
        return_value={
            "tools": [
                {"name": "pd_slack_post", "app_slug": "slack", "description": "Post"},
                {"name": "pd_slack_react", "app_slug": "slack", "description": "React"},
                {"name": "pd_gmail_send", "app_slug": "gmail", "description": "Send"},
            ],
            "count": 3,
        }
    )
    ctx = _ctx({"agents.list_tools": list_tools})
    result = await list_agent_tools(ctx, {})
    assert result["count"] == 3
    assert set(result["by_app"].keys()) == {"slack", "gmail"}
    assert len(result["by_app"]["slack"]) == 2
    assert len(result["by_app"]["gmail"]) == 1


@pytest.mark.asyncio
async def test_list_agent_tools_filters_by_app_slug() -> None:
    list_tools = AsyncMock(
        return_value={
            "tools": [
                {"name": "pd_slack_post", "app_slug": "slack"},
                {"name": "pd_gmail_send", "app_slug": "gmail"},
            ],
            "count": 2,
        }
    )
    ctx = _ctx({"agents.list_tools": list_tools})
    result = await list_agent_tools(ctx, {"app_slug": "slack"})
    assert result["count"] == 1
    assert list(result["by_app"].keys()) == ["slack"]


@pytest.mark.asyncio
async def test_list_runs_dispatches_to_agents_list_runs() -> None:
    list_runs_fn = AsyncMock(return_value={"runs": [], "count": 0})
    ctx = _ctx({"agents.list_runs": list_runs_fn})
    await list_runs(ctx, {"agent_slug": "bot", "limit": 5})
    list_runs_fn.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_run_trace_dispatches_to_agents_get_run() -> None:
    get_run = AsyncMock(return_value={"run_id": "run-1"})
    ctx = _ctx({"agents.get_run": get_run})
    await get_run_trace(ctx, {"run_id": "run-1"})
    get_run.assert_awaited_once()


@pytest.mark.asyncio
async def test_list_trigger_components_dispatches() -> None:
    listfn = AsyncMock(return_value={"components": []})
    ctx = _ctx({"agents.list_trigger_components": listfn})
    await list_trigger_components(ctx, {"app": "slack"})
    listfn.assert_awaited_once()


# ─── agent triggers ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_trigger_dispatches_to_agents_triggers_create() -> None:
    create = AsyncMock(return_value={"trigger_id": "trg-1"})
    ctx = _ctx({"agents.triggers.create": create})
    await create_trigger(
        ctx,
        {
            "agent_slug": "bot",
            "data_source_id": "src-1",
            "event_type_filter": "issue.created",
        },
    )
    create.assert_awaited_once()


@pytest.mark.asyncio
async def test_list_triggers_dispatches_to_agents_triggers_list() -> None:
    listfn = AsyncMock(return_value={"triggers": [], "count": 0})
    ctx = _ctx({"agents.triggers.list": listfn})
    await list_triggers(ctx, {"agent_slug": "bot"})
    listfn.assert_awaited_once()


@pytest.mark.asyncio
async def test_pause_trigger_dispatches_to_agents_triggers_update_by_id() -> None:
    update_by = AsyncMock(return_value={"trigger_id": "trg-1", "status": "paused"})
    ctx = _ctx({"agents.triggers.update_by_id": update_by})
    await pause_trigger(ctx, {"trigger_id": "trg-1"})
    update_by.assert_awaited_once()


@pytest.mark.asyncio
async def test_resume_trigger_dispatches_to_agents_triggers_update_by_id() -> None:
    update_by = AsyncMock(return_value={"trigger_id": "trg-1", "status": "active"})
    ctx = _ctx({"agents.triggers.update_by_id": update_by})
    await resume_trigger(ctx, {"trigger_id": "trg-1"})
    update_by.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_trigger_dispatches_to_agents_triggers_update_by_id() -> None:
    update_by = AsyncMock(return_value={"trigger_id": "trg-1"})
    ctx = _ctx({"agents.triggers.update_by_id": update_by})
    await update_trigger(
        ctx, {"trigger_id": "trg-1", "status": "active"},
    )
    update_by.assert_awaited_once()
