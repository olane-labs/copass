"""Wire-level mock tests for ``CopassClient.agents`` (and the nested
``client.agents.triggers`` sub-resource)."""

from __future__ import annotations

import json

import httpx
import respx

from copass_core import CopassClient

_BASE = "http://test/api/v1/storage/sandboxes/sb-1/agents"


# ─── AgentsResource ──────────────────────────────────────────────────


@respx.mock
async def test_create(client: CopassClient) -> None:
    """``create`` requires slug + name + system_prompt + tool_allowlist."""
    route = respx.post(_BASE).mock(
        return_value=httpx.Response(
            200,
            json={"slug": "support-bot", "name": "Support", "version": 1},
        )
    )
    resp = await client.agents.create(
        sandbox_id="sb-1",
        slug="support-bot",
        name="Support",
        system_prompt="Help users.",
        tool_allowlist=["discover", "interpret", "search"],
        model_settings={"backend": "anthropic", "model": "claude-opus-4-7"},
    )
    assert resp["slug"] == "support-bot"
    body = json.loads(route.calls.last.request.content)
    assert body["slug"] == "support-bot"
    assert body["tool_allowlist"] == ["discover", "interpret", "search"]


@respx.mock
async def test_list(client: CopassClient) -> None:
    respx.get(_BASE).mock(
        return_value=httpx.Response(200, json={"agents": [], "count": 0})
    )
    resp = await client.agents.list(sandbox_id="sb-1")
    assert "agents" in resp


@respx.mock
async def test_retrieve(client: CopassClient) -> None:
    respx.get(f"{_BASE}/support-bot").mock(
        return_value=httpx.Response(200, json={"slug": "support-bot"})
    )
    resp = await client.agents.retrieve(sandbox_id="sb-1", slug="support-bot")
    assert resp["slug"] == "support-bot"


@respx.mock
async def test_update(client: CopassClient) -> None:
    """Update takes name/description/system_prompt etc. as kwargs."""
    route = respx.patch(f"{_BASE}/support-bot").mock(
        return_value=httpx.Response(200, json={"slug": "support-bot", "version": 2})
    )
    await client.agents.update(
        sandbox_id="sb-1", slug="support-bot", name="renamed",
    )
    body = json.loads(route.calls.last.request.content)
    assert body == {"name": "renamed"}


@respx.mock
async def test_archive(client: CopassClient) -> None:
    route = respx.delete(f"{_BASE}/support-bot").mock(
        return_value=httpx.Response(200, json=None)
    )
    await client.agents.archive(sandbox_id="sb-1", slug="support-bot")
    assert route.called


@respx.mock
async def test_update_model_settings(client: CopassClient) -> None:
    route = respx.patch(f"{_BASE}/support-bot/model-settings").mock(
        return_value=httpx.Response(
            200,
            json={"slug": "support-bot", "model_settings": {"backend": "anthropic"}},
        )
    )
    await client.agents.update_model_settings(
        sandbox_id="sb-1", slug="support-bot", backend="anthropic", model="claude-opus-4-7",
    )
    body = json.loads(route.calls.last.request.content)
    assert body["backend"] == "anthropic"
    assert body["model"] == "claude-opus-4-7"


@respx.mock
async def test_update_tool_sources(client: CopassClient) -> None:
    """update_tool_sources takes the list as the third positional arg."""
    route = respx.patch(f"{_BASE}/support-bot/tool-sources").mock(
        return_value=httpx.Response(200, json={"slug": "support-bot", "tool_sources": ["slack"]})
    )
    await client.agents.update_tool_sources("sb-1", "support-bot", ["slack"])
    body = json.loads(route.calls.last.request.content)
    assert body == {"tool_sources": ["slack"]}


@respx.mock
async def test_wire_integration(client: CopassClient) -> None:
    """wire_integration takes ``app_slug`` as positional arg."""
    route = respx.post(f"{_BASE}/support-bot/wire-integration").mock(
        return_value=httpx.Response(
            200,
            json={
                "wired": True,
                "mode": "explicit",
                "sources_added": ["slack-1"],
                "tool_count": 5,
                "message": "wired",
            },
        )
    )
    resp = await client.agents.wire_integration(
        sandbox_id="sb-1", slug="support-bot", app_slug="slack",
    )
    # Returns a dataclass — assert tool_count via attr or dict.
    assert getattr(resp, "wired", None) is True or resp.get("wired") is True
    assert getattr(resp, "tool_count", None) == 5 or resp.get("tool_count") == 5


@respx.mock
async def test_test_fire(client: CopassClient) -> None:
    """test_fire optionally takes ``event_payload``."""
    route = respx.post(f"{_BASE}/support-bot/test").mock(
        return_value=httpx.Response(
            200,
            json={"run_id": "run-1", "status": "queued"},
        )
    )
    await client.agents.test_fire(
        sandbox_id="sb-1", slug="support-bot",
        event_payload={"hello": "world"},
    )
    body = json.loads(route.calls.last.request.content)
    assert body["event_payload"] == {"hello": "world"}


@respx.mock
async def test_start_chat_run(client: CopassClient) -> None:
    """start_chat_run posts message+session_id and returns the new run_id."""
    route = respx.post(f"{_BASE}/support-bot/invoke-async").mock(
        return_value=httpx.Response(202, json={"run_id": "run-async-1"})
    )
    resp = await client.agents.start_chat_run(
        sandbox_id="sb-1",
        slug="support-bot",
        message="hello",
        session_id="sesn_prev",
    )
    assert resp == {"run_id": "run-async-1"}
    body = json.loads(route.calls.last.request.content)
    assert body == {"message": "hello", "session_id": "sesn_prev"}

    route2 = respx.post(f"{_BASE}/support-bot-2/invoke-async").mock(
        return_value=httpx.Response(202, json={"run_id": "run-async-2"})
    )
    await client.agents.start_chat_run(
        sandbox_id="sb-1", slug="support-bot-2", message="hi",
    )
    body2 = json.loads(route2.calls.last.request.content)
    assert body2 == {"message": "hi"}


@respx.mock
async def test_list_runs(client: CopassClient) -> None:
    route = respx.get(f"{_BASE}/support-bot/runs").mock(
        return_value=httpx.Response(200, json={"runs": [], "count": 0})
    )
    await client.agents.list_runs(sandbox_id="sb-1", slug="support-bot", limit=10)
    params = route.calls.last.request.url.params
    assert params.get("limit") == "10"


@respx.mock
async def test_get_run(client: CopassClient) -> None:
    respx.get(f"{_BASE}/runs/run-1").mock(
        return_value=httpx.Response(200, json={"run_id": "run-1", "status": "completed"})
    )
    resp = await client.agents.get_run(sandbox_id="sb-1", run_id="run-1")
    assert resp["run_id"] == "run-1"


@respx.mock
async def test_list_tools(client: CopassClient) -> None:
    respx.get(f"{_BASE}/tools").mock(
        return_value=httpx.Response(200, json={"tools": [{"name": "discover"}]})
    )
    resp = await client.agents.list_tools(sandbox_id="sb-1")
    assert resp["tools"][0]["name"] == "discover"


@respx.mock
async def test_list_trigger_components(client: CopassClient) -> None:
    route = respx.get(f"{_BASE}/triggers/components").mock(
        return_value=httpx.Response(200, json={"components": [{"id": "slack-msg"}]})
    )
    await client.agents.list_trigger_components(sandbox_id="sb-1", app="slack")
    params = route.calls.last.request.url.params
    assert params.get("app") == "slack"


# ─── AgentTriggersResource ───────────────────────────────────────────


@respx.mock
async def test_triggers_create(client: CopassClient) -> None:
    """Triggers.create requires data_source_id + event_type_filter (no `kind`)."""
    route = respx.post(f"{_BASE}/support-bot/triggers").mock(
        return_value=httpx.Response(
            200,
            json={"trigger_id": "trg-1", "event_type_filter": "issue.created"},
        )
    )
    await client.agents.triggers.create(
        sandbox_id="sb-1",
        slug="support-bot",
        data_source_id="src-1",
        event_type_filter="issue.created",
    )
    body = json.loads(route.calls.last.request.content)
    assert body["data_source_id"] == "src-1"
    assert body["event_type_filter"] == "issue.created"


@respx.mock
async def test_triggers_list(client: CopassClient) -> None:
    route = respx.get(f"{_BASE}/support-bot/triggers").mock(
        return_value=httpx.Response(200, json={"triggers": [], "count": 0})
    )
    await client.agents.triggers.list(sandbox_id="sb-1", slug="support-bot")
    assert route.called


@respx.mock
async def test_triggers_retrieve(client: CopassClient) -> None:
    respx.get(f"{_BASE}/support-bot/triggers/trg-1").mock(
        return_value=httpx.Response(200, json={"trigger_id": "trg-1"})
    )
    resp = await client.agents.triggers.retrieve(
        sandbox_id="sb-1", slug="support-bot", trigger_id="trg-1",
    )
    assert resp["trigger_id"] == "trg-1"


@respx.mock
async def test_triggers_update(client: CopassClient) -> None:
    """update takes status + event_type_filter etc. as kwargs."""
    route = respx.patch(f"{_BASE}/support-bot/triggers/trg-1").mock(
        return_value=httpx.Response(200, json={"trigger_id": "trg-1", "status": "paused"})
    )
    await client.agents.triggers.update(
        sandbox_id="sb-1",
        slug="support-bot",
        trigger_id="trg-1",
        status="paused",
    )
    body = json.loads(route.calls.last.request.content)
    assert body.get("status") == "paused"


@respx.mock
async def test_triggers_destroy(client: CopassClient) -> None:
    route = respx.delete(f"{_BASE}/support-bot/triggers/trg-1").mock(
        return_value=httpx.Response(200, json=None)
    )
    await client.agents.triggers.destroy(
        sandbox_id="sb-1", slug="support-bot", trigger_id="trg-1",
    )
    assert route.called
