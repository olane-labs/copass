"""``AgentRouter`` — high-level Copass agent SDK.

Mirrors ``@copass/agent-router`` on the TS side. Hides SSE parsing and
OAuth connect-flow orchestration behind a :class:`CopassClient` built
from the caller's auth.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, AsyncIterator, List, Optional

import httpx

from copass_core import CopassClient
from copass_core.client import AuthConfig
from copass_core_agents.events import AgentEvent

from copass_agent_router.connect_flow import (
    ConnectFlowResult,
    OnConnectUrl,
    run_connect_flow,
)
from copass_agent_router.sse import frame_to_agent_event, iterate_sse_frames


DEFAULT_API_URL = "https://ai.copass.id"


@dataclass
class RunAgentOptions:
    """Options for :meth:`AgentRouter.run`."""

    provider: str
    model: str
    system: str
    end_user_id: str
    message: Optional[str] = None
    messages: Optional[List[dict]] = None
    session_id: Optional[str] = None
    reasoning_engine_id: Optional[str] = None
    location: Optional[str] = None


class IntegrationsFacade:
    """Provider-neutral integrations surface with flow helpers."""

    def __init__(self, client: CopassClient, default_sandbox_id: str) -> None:
        self._client = client
        self._default_sandbox_id = default_sandbox_id

    def _sb(self, sandbox_id: Optional[str]) -> str:
        sid = sandbox_id or self._default_sandbox_id
        if not sid:
            raise ValueError("sandbox_id is required (no default on AgentRouter).")
        return sid

    async def catalog(
        self,
        *,
        q: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        sandbox_id: Optional[str] = None,
    ) -> dict:
        return await self._client.integrations.catalog(
            self._sb(sandbox_id), q=q, limit=limit, cursor=cursor
        )

    async def connect(
        self,
        app: str,
        *,
        on_connect_url: OnConnectUrl,
        scope: str = "user",
        project_id: Optional[str] = None,
        timeout_seconds: float = 300.0,
        success_uri: Optional[str] = None,
        error_uri: Optional[str] = None,
        sandbox_id: Optional[str] = None,
    ) -> ConnectFlowResult:
        return await run_connect_flow(
            self._client,
            self._sb(sandbox_id),
            app=app,
            on_connect_url=on_connect_url,
            scope=scope,
            project_id=project_id,
            timeout_seconds=timeout_seconds,
            success_uri=success_uri,
            error_uri=error_uri,
        )

    async def list(
        self, *, app: Optional[str] = None, sandbox_id: Optional[str] = None
    ) -> dict:
        return await self._client.integrations.list(self._sb(sandbox_id), app=app)

    async def disconnect(
        self, source_id: str, *, sandbox_id: Optional[str] = None
    ) -> None:
        await self._client.integrations.disconnect(self._sb(sandbox_id), source_id)

    async def reconcile(
        self,
        *,
        app: Optional[str] = None,
        scope: str = "user",
        project_id: Optional[str] = None,
        sandbox_id: Optional[str] = None,
    ) -> dict:
        return await self._client.integrations.reconcile(
            self._sb(sandbox_id), app=app, scope=scope, project_id=project_id
        )


class AgentRouter:
    """Top-level agent router SDK."""

    def __init__(
        self,
        *,
        auth: AuthConfig,
        sandbox_id: str,
        api_url: str = DEFAULT_API_URL,
        client: Optional[CopassClient] = None,
    ) -> None:
        self.client = client or CopassClient(auth=auth, api_url=api_url)
        self._api_url = api_url
        self._default_sandbox_id = sandbox_id
        self.integrations = IntegrationsFacade(self.client, sandbox_id)

    async def run(
        self,
        options: RunAgentOptions,
        *,
        sandbox_id: Optional[str] = None,
    ) -> AsyncIterator[AgentEvent]:
        """Run an agent turn and yield neutral :class:`AgentEvent` values."""
        sb = sandbox_id or self._default_sandbox_id
        if not sb:
            raise ValueError("sandbox_id is required.")

        messages = options.messages
        if messages is None:
            if not options.message:
                raise ValueError("Either `message` or `messages` must be supplied.")
            messages = [{"role": "user", "content": options.message}]

        body: dict[str, Any] = {
            "provider": options.provider,
            "model": options.model,
            "system_prompt": options.system,
            "messages": messages,
            "end_user_id": options.end_user_id,
        }
        if options.session_id is not None:
            body["session_id"] = options.session_id
        if options.reasoning_engine_id is not None:
            body["reasoning_engine_id"] = options.reasoning_engine_id
        if options.location is not None:
            body["location"] = options.location

        # Resolve auth via the client's auth provider so headers match.
        auth_provider = getattr(self.client, "_auth_provider", None)
        session = (
            await auth_provider.get_session() if auth_provider is not None else None
        )
        headers = {
            "content-type": "application/json",
            "accept": "text/event-stream",
        }
        token = getattr(session, "access_token", None) if session else None
        if token:
            headers["authorization"] = f"Bearer {token}"

        url = (
            f"{self._api_url.rstrip('/')}"
            f"/api/v1/storage/sandboxes/{sb}/agents/run"
        )
        async with httpx.AsyncClient(timeout=None) as http:
            async with http.stream("POST", url, headers=headers, json=body) as resp:
                if resp.status_code >= 400:
                    text = (await resp.aread()).decode("utf-8", errors="replace")
                    raise RuntimeError(
                        f"agents.run: HTTP {resp.status_code} {text[:300]}"
                    )
                async for frame in iterate_sse_frames(resp):
                    event = frame_to_agent_event(frame)
                    if event is not None:
                        yield event


__all__ = ["AgentRouter", "IntegrationsFacade", "RunAgentOptions"]
