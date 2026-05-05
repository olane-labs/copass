"""Backend unit tests — construction, scope mapping, stream/run loop
driven by a mocked ADK app.

Live Agent Engine calls are out of scope here; ``stream`` and ``run``
are exercised end-to-end against a FakeAdkApp that mirrors the
``async_stream_query`` / ``async_create_session`` contract.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, List, Optional
from unittest.mock import AsyncMock

import pytest

from copass_core_agents import (
    AgentFinish,
    AgentInvocationContext,
    AgentScope,
    AgentTextDelta,
    AgentTool,
    AgentToolCall,
    AgentToolRegistry,
    AgentToolResult,
    ToolSpec,
)
from copass_google_agents import (
    AgentBackend,
    CopassGoogleAgent,
    DEFAULT_LOCATION,
    DEFAULT_MODEL,
    DISPATCH_TOOL_NAME,
    GoogleAgentBackend,
    SESSION_ID_HANDLE,
)
from copass_google_agents.backends.google_agent_backend import scope_to_user_id


# ──────────────────────────────────────────────────────────────────────
# Constants + constructor surface
# ──────────────────────────────────────────────────────────────────────


def test_constants_have_expected_values() -> None:
    assert DEFAULT_LOCATION == "us-central1"
    assert DEFAULT_MODEL.startswith("gemini-")
    assert DISPATCH_TOOL_NAME == "copass_dispatch"
    assert SESSION_ID_HANDLE == "agent_engine_session_id"


def test_backend_constructs_without_network() -> None:
    backend = GoogleAgentBackend(
        project="my-proj",
        location="us-central1",
        reasoning_engine_id="1234567890",
    )
    assert isinstance(backend, AgentBackend)
    assert backend.resource_name == (
        "projects/my-proj/locations/us-central1/reasoningEngines/1234567890"
    )


@pytest.mark.parametrize(
    "field,value",
    [("project", ""), ("reasoning_engine_id", ""), ("location", "")],
)
def test_backend_rejects_empty_required_args(field: str, value: str) -> None:
    kwargs = {
        "project": "p",
        "reasoning_engine_id": "r",
        "location": "us-central1",
    }
    kwargs[field] = value
    with pytest.raises(ValueError, match=field):
        GoogleAgentBackend(**kwargs)


def test_backend_uses_default_location_when_omitted() -> None:
    backend = GoogleAgentBackend(project="p", reasoning_engine_id="r")
    assert backend.resource_name.split("/")[3] == DEFAULT_LOCATION


# ──────────────────────────────────────────────────────────────────────
# scope_to_user_id — prefix scheme
# ──────────────────────────────────────────────────────────────────────


def test_scope_to_user_id_user_only() -> None:
    assert scope_to_user_id(AgentScope(user_id="u-1")) == "u_u-1"


def test_scope_to_user_id_sandbox_wins_over_user() -> None:
    scope = AgentScope(user_id="u-1", sandbox_id="sb-2")
    assert scope_to_user_id(scope) == "s_sb-2"


def test_scope_to_user_id_project_wins_over_sandbox() -> None:
    scope = AgentScope(user_id="u-1", sandbox_id="sb-2", project_id="p-3")
    assert scope_to_user_id(scope) == "p_p-3"


# ──────────────────────────────────────────────────────────────────────
# Fake Agent Engine app + helpers for the stream/run loop tests
# ──────────────────────────────────────────────────────────────────────


@dataclass
class _Session:
    id: str


@dataclass
class FakeAdkApp:
    """Mirrors the surface that ``GoogleAgentBackend`` actually touches."""

    events: List[dict] = field(default_factory=list)
    created_sessions: List[str] = field(default_factory=list)
    deleted_sessions: List[tuple] = field(default_factory=list)
    received: List[dict] = field(default_factory=list)
    next_session_id: str = "session-fresh"

    create_session_calls: List[dict] = field(default_factory=list)

    async def async_create_session(
        self, *, user_id: str, state: Optional[dict] = None
    ) -> _Session:
        self.created_sessions.append(user_id)
        # Record the full kwargs the backend passed so tests can assert
        # ``state`` is forwarded only when the caller supplied it.
        call: dict = {"user_id": user_id}
        if state is not None:
            call["state"] = state
        self.create_session_calls.append(call)
        return _Session(id=self.next_session_id)

    async def async_stream_query(
        self,
        *,
        user_id: str,
        session_id: str,
        message: str,
    ) -> AsyncIterator[dict]:
        self.received.append(
            {"user_id": user_id, "session_id": session_id, "message": message}
        )
        for evt in self.events:
            yield evt

    async def async_delete_session(
        self, *, user_id: str, session_id: str
    ) -> None:
        self.deleted_sessions.append((user_id, session_id))


class _EchoTool(AgentTool):
    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="noop",
            description="noop",
            input_schema={"type": "object", "properties": {}},
        )

    async def invoke(self, arguments, *, context=None):
        return {}


def _make_agent(
    *,
    fake_app: FakeAdkApp,
    delete_session_on_finish: bool = False,
) -> CopassGoogleAgent:
    backend = GoogleAgentBackend(
        project="p",
        reasoning_engine_id="r",
        adk_app=fake_app,
        delete_session_on_finish=delete_session_on_finish,
    )
    reg = AgentToolRegistry()
    reg.add(_EchoTool())
    agent = CopassGoogleAgent(
        identity="support",
        system_prompt="prompt",
        project="p",
        reasoning_engine_id="r",
    )
    # Swap the backend CopassGoogleAgent built internally for the
    # one wired to the fake app (mirrors how callers would override
    # in production — construct the backend directly).
    agent.backend = backend
    return agent


# ──────────────────────────────────────────────────────────────────────
# Stream/run integration against the fake app
# ──────────────────────────────────────────────────────────────────────


async def test_stream_creates_session_and_translates_events() -> None:
    fake = FakeAdkApp(
        events=[
            {"id": "e1", "content": {"parts": [{"text": "Hello "}], "role": "model"}},
            {"id": "e2", "content": {"parts": [{"text": "world"}], "role": "model"}},
        ],
        next_session_id="sess-new",
    )
    agent = _make_agent(fake_app=fake)
    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))

    events = [evt async for evt in agent.backend.stream(agent, "hi there", ctx)]

    # Session was auto-created scoped to the prefixed user_id.
    assert fake.created_sessions == ["u_u-1"]
    assert fake.received[0]["session_id"] == "sess-new"
    assert fake.received[0]["user_id"] == "u_u-1"
    assert fake.received[0]["message"] == "hi there"

    assert len(events) == 3
    assert isinstance(events[0], AgentTextDelta) and events[0].text == "Hello "
    assert isinstance(events[1], AgentTextDelta) and events[1].text == "world"
    assert isinstance(events[2], AgentFinish)
    assert events[2].stop_reason == "end_turn"
    assert events[2].session_id == "sess-new"


async def test_stream_reuses_supplied_session_id() -> None:
    fake = FakeAdkApp(events=[], next_session_id="should-not-be-used")
    agent = _make_agent(fake_app=fake)
    ctx = AgentInvocationContext(
        scope=AgentScope(user_id="u-1"),
        handles={SESSION_ID_HANDLE: "sess-existing"},
    )

    events = [evt async for evt in agent.backend.stream(agent, "hi", ctx)]

    assert fake.created_sessions == []  # no session creation
    assert fake.received[0]["session_id"] == "sess-existing"
    finish = [e for e in events if isinstance(e, AgentFinish)][0]
    assert finish.session_id == "sess-existing"


async def test_stream_surfaces_tool_call_and_result_events() -> None:
    fake = FakeAdkApp(
        events=[
            {
                "id": "e1",
                "content": {
                    "parts": [
                        {
                            "function_call": {
                                "id": "call-1",
                                "name": "search",
                                "args": {"q": "x"},
                            }
                        }
                    ],
                    "role": "model",
                },
            },
            {
                "id": "e2",
                "content": {
                    "parts": [
                        {
                            "function_response": {
                                "id": "call-1",
                                "name": "search",
                                "response": {"hits": 2},
                            }
                        }
                    ],
                    "role": "user",
                },
            },
            {"id": "e3", "content": {"parts": [{"text": "done"}], "role": "model"}},
        ],
    )
    agent = _make_agent(fake_app=fake)
    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))

    events = [evt async for evt in agent.backend.stream(agent, "hi", ctx)]
    kinds = [type(e).__name__ for e in events]
    assert kinds == ["AgentToolCall", "AgentToolResult", "AgentTextDelta", "AgentFinish"]


async def test_stream_deletes_session_when_configured() -> None:
    fake = FakeAdkApp(events=[], next_session_id="sess-created")
    agent = _make_agent(fake_app=fake, delete_session_on_finish=True)
    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))

    _ = [evt async for evt in agent.backend.stream(agent, "hi", ctx)]
    assert fake.deleted_sessions == [("u_u-1", "sess-created")]


async def test_stream_does_not_delete_supplied_session() -> None:
    fake = FakeAdkApp(events=[])
    agent = _make_agent(fake_app=fake, delete_session_on_finish=True)
    ctx = AgentInvocationContext(
        scope=AgentScope(user_id="u-1"),
        handles={SESSION_ID_HANDLE: "sess-caller"},
    )
    _ = [evt async for evt in agent.backend.stream(agent, "hi", ctx)]
    assert fake.deleted_sessions == []  # caller owns the session


async def test_run_collects_stream_into_result() -> None:
    fake = FakeAdkApp(
        events=[
            {"id": "e1", "content": {"parts": [{"text": "Hi "}], "role": "model"}},
            {
                "id": "e2",
                "content": {
                    "parts": [
                        {
                            "function_call": {
                                "id": "c1",
                                "name": "search",
                                "args": {"q": "x"},
                            }
                        }
                    ],
                    "role": "model",
                },
            },
            {
                "id": "e3",
                "content": {
                    "parts": [
                        {
                            "function_response": {
                                "id": "c1",
                                "name": "search",
                                "response": {"ok": True},
                            }
                        }
                    ],
                    "role": "user",
                },
            },
            {"id": "e4", "content": {"parts": [{"text": "done."}], "role": "model"}},
        ],
        next_session_id="s-final",
    )
    agent = _make_agent(fake_app=fake)
    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))

    result = await agent.backend.run(agent, "hello", ctx)
    assert result.final_text == "Hi done."
    assert result.stop_reason == "end_turn"
    assert result.session_id == "s-final"
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0] == {
        "call_id": "c1",
        "name": "search",
        "arguments": {"q": "x"},
        "result": {"ok": True},
    }


async def test_stream_rejects_empty_messages() -> None:
    fake = FakeAdkApp(events=[])
    agent = _make_agent(fake_app=fake)
    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))
    with pytest.raises(ValueError, match="user-role message"):
        _ = [evt async for evt in agent.backend.stream(agent, "", ctx)]


async def test_stream_forwards_adk_session_state_when_supplied() -> None:
    """When the caller stashes ``adk_session_state`` in ``context.handles``,
    the backend must forward it to ``async_create_session(state=...)`` so the
    deployed engine's ``_proxy_tool`` / ``_header_provider`` can read
    ``copass_api_key`` from session state per-request (closes the bake-out
    loop from copass-google-agents 1.0.0).
    """
    fake_app = AsyncMock()
    fake_app.async_create_session = AsyncMock(return_value=_Session(id="sess-from-mock"))

    async def _empty_stream(**_: Any) -> AsyncIterator[dict]:
        if False:  # pragma: no cover — generator with no yields
            yield {}

    fake_app.async_stream_query = _empty_stream

    backend = GoogleAgentBackend(
        project="p",
        reasoning_engine_id="r",
        adk_app=fake_app,
    )
    reg = AgentToolRegistry()
    reg.add(_EchoTool())
    agent = CopassGoogleAgent(
        identity="support",
        system_prompt="prompt",
        project="p",
        reasoning_engine_id="r",
    )
    agent.backend = backend

    ctx = AgentInvocationContext(
        scope=AgentScope(user_id="u-1"),
        handles={"adk_session_state": {"copass_api_key": "olk_test"}},
    )

    _ = [evt async for evt in backend.stream(agent, "hi", ctx)]

    fake_app.async_create_session.assert_awaited_once_with(
        user_id="u_u-1",
        state={"copass_api_key": "olk_test"},
    )


async def test_stream_omits_state_kwarg_when_no_adk_session_state() -> None:
    """Negative case: when no ``adk_session_state`` is in handles, the
    backend must NOT pass ``state=`` to ``async_create_session`` — legacy
    engines that bake their own env vars keep working unchanged.
    """
    fake_app = AsyncMock()
    fake_app.async_create_session = AsyncMock(return_value=_Session(id="sess-from-mock"))

    async def _empty_stream(**_: Any) -> AsyncIterator[dict]:
        if False:  # pragma: no cover — generator with no yields
            yield {}

    fake_app.async_stream_query = _empty_stream

    backend = GoogleAgentBackend(
        project="p",
        reasoning_engine_id="r",
        adk_app=fake_app,
    )
    reg = AgentToolRegistry()
    reg.add(_EchoTool())
    agent = CopassGoogleAgent(
        identity="support",
        system_prompt="prompt",
        project="p",
        reasoning_engine_id="r",
    )
    agent.backend = backend

    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))

    _ = [evt async for evt in backend.stream(agent, "hi", ctx)]

    fake_app.async_create_session.assert_awaited_once_with(user_id="u_u-1")
    # Verify ``state`` is absent (not just falsy) — distinguishes "didn't
    # pass it" from "passed it as None/empty dict".
    _, kwargs = fake_app.async_create_session.call_args
    assert "state" not in kwargs


async def test_stream_joins_multiple_user_messages() -> None:
    fake = FakeAdkApp(events=[], next_session_id="sid")
    agent = _make_agent(fake_app=fake)
    ctx = AgentInvocationContext(scope=AgentScope(user_id="u-1"))
    _ = [
        evt
        async for evt in agent.backend.stream(
            agent,
            [
                {"role": "user", "content": "one"},
                {"role": "assistant", "content": "should be dropped"},
                {"role": "user", "content": "two"},
            ],
            ctx,
        )
    ]
    assert fake.received[0]["message"] == "one\n\ntwo"


# ──────────────────────────────────────────────────────────────────────
# CopassGoogleAgent convenience
# ──────────────────────────────────────────────────────────────────────


def test_copass_google_agent_defaults_empty_registry() -> None:
    agent = CopassGoogleAgent(
        identity="support",
        system_prompt="prompt",
        project="p",
        reasoning_engine_id="r",
    )
    assert agent.model == DEFAULT_MODEL
    assert isinstance(agent.backend, GoogleAgentBackend)
