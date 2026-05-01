"""Reactive Agents resource — persisted agent CRUD + run reads.

Port of ``typescript/packages/core/src/resources/agents.ts``.

Phase 1A scope (read-only): ``list``, ``retrieve``, ``list_runs``,
``get_run``, ``list_tools``, ``list_trigger_components``, plus
``triggers.list`` / ``triggers.retrieve`` for the trigger sub-resource.
Write methods (``create``, ``update``, ``archive``, ``test_fire``,
``triggers.create`` / ``update`` / ``destroy``) are included for parity
with the TS surface — they're thin wrappers over the existing CRUD
endpoints. Spec-driven write tools land in Phase 2.

Sandbox-scoped: every method takes ``sandbox_id`` first. The path
prefix is ``/api/v1/storage/sandboxes/{sandbox_id}/agents``. The
``get_run`` method targets the new
``/agents/runs/{run_id}`` route added in Phase 1A.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional

from copass_core.resources.base import BaseResource


_STORAGE_BASE = "/api/v1/storage/sandboxes"


WireIntegrationMode = Literal[
    "explicit",
    "allow_all",
    "ingestion_only",
    "not_connected",
    "unknown_provider",
]


@dataclass(frozen=True)
class WireIntegrationResult:
    """Public envelope returned by ``AgentsResource.wire_integration``.

    Mirrors the backend
    :class:`frame_graph.copass_id.agents.types.WireIntegrationResult`
    dataclass and the wire shape served by
    ``POST /agents/{slug}/wire-integration``.

    ``mode`` is the discriminator; consumers branch on
    (``wired``, ``mode``):

    * ``"explicit"`` — one or more providers wired, tools added.
    * ``"allow_all"`` — wired, allowlist set to allow-all (reserved).
    * ``"ingestion_only"`` — app exposes no callable tools.
    * ``"not_connected"`` — no provider has this app connected.
    * ``"unknown_provider"`` — provider present in user sources but
      not registered for agent wiring (defensive; logged at ERROR).
    """

    wired: bool
    agent_slug: str
    app_slug: str
    sources_added: List[str] = field(default_factory=list)
    tool_count: int = 0
    mode: WireIntegrationMode = "explicit"
    message: str = ""

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "WireIntegrationResult":
        return cls(
            wired=bool(payload.get("wired", False)),
            agent_slug=str(payload.get("agent_slug", "")),
            app_slug=str(payload.get("app_slug", "")),
            sources_added=list(payload.get("sources_added") or []),
            tool_count=int(payload.get("tool_count", 0)),
            mode=payload.get("mode", "explicit"),  # type: ignore[arg-type]
            message=str(payload.get("message", "")),
        )


def _agents_base(sandbox_id: str) -> str:
    return f"{_STORAGE_BASE}/{sandbox_id}/agents"


class AgentTriggersResource(BaseResource):
    """Trigger CRUD nested under each agent slug.

    Mounted under each agent slug:
      POST   /agents/{slug}/triggers
      GET    /agents/{slug}/triggers
      GET    /agents/{slug}/triggers/{trigger_id}
      PATCH  /agents/{slug}/triggers/{trigger_id}
      DELETE /agents/{slug}/triggers/{trigger_id}
    """

    async def create(
        self,
        sandbox_id: str,
        slug: str,
        *,
        data_source_id: str,
        event_type_filter: str,
        filter_config: Optional[Dict[str, Any]] = None,
        rate_limit_per_hour: Optional[int] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "data_source_id": data_source_id,
            "event_type_filter": event_type_filter,
        }
        if filter_config is not None:
            body["filter_config"] = filter_config
        if rate_limit_per_hour is not None:
            body["rate_limit_per_hour"] = rate_limit_per_hour
        return await self._post(
            f"{_agents_base(sandbox_id)}/{slug}/triggers", body
        )

    async def list(
        self,
        sandbox_id: str,
        slug: str,
        *,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self._get(
            f"{_agents_base(sandbox_id)}/{slug}/triggers",
            query={"status": status},
        )

    async def retrieve(
        self,
        sandbox_id: str,
        slug: str,
        trigger_id: str,
    ) -> Dict[str, Any]:
        return await self._get(
            f"{_agents_base(sandbox_id)}/{slug}/triggers/{trigger_id}"
        )

    async def update(
        self,
        sandbox_id: str,
        slug: str,
        trigger_id: str,
        *,
        event_type_filter: Optional[str] = None,
        filter_config: Optional[Dict[str, Any]] = None,
        clear_filter_config: bool = False,
        rate_limit_per_hour: Optional[int] = None,
        clear_rate_limit: bool = False,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "clear_filter_config": clear_filter_config,
            "clear_rate_limit": clear_rate_limit,
        }
        if event_type_filter is not None:
            body["event_type_filter"] = event_type_filter
        if filter_config is not None:
            body["filter_config"] = filter_config
        if rate_limit_per_hour is not None:
            body["rate_limit_per_hour"] = rate_limit_per_hour
        if status is not None:
            body["status"] = status
        return await self._patch(
            f"{_agents_base(sandbox_id)}/{slug}/triggers/{trigger_id}",
            body,
        )

    async def destroy(
        self,
        sandbox_id: str,
        slug: str,
        trigger_id: str,
    ) -> None:
        await self._delete(
            f"{_agents_base(sandbox_id)}/{slug}/triggers/{trigger_id}"
        )


class AgentsResource(BaseResource):
    """Reactive Agents resource — persisted agent CRUD + test-fire + run log.

    ``self.triggers`` exposes trigger CRUD nested under each agent.

    Example::

        client = CopassClient(auth=ApiKeyAuth(key="olk_..."))
        agents = await client.agents.list("sb_...")
        agent = await client.agents.retrieve("sb_...", "gtm-marketing")
        runs = await client.agents.list_runs("sb_...", "gtm-marketing")
        run = await client.agents.get_run("sb_...", "rn_...")
    """

    triggers: AgentTriggersResource

    def __init__(self, http) -> None:  # type: ignore[no-untyped-def]
        super().__init__(http)
        self.triggers = AgentTriggersResource(http)

    # ── Agent CRUD ──────────────────────────────────────────────

    async def create(
        self,
        sandbox_id: str,
        *,
        slug: str,
        name: str,
        system_prompt: str,
        tool_allowlist: List[str],
        model_settings: Dict[str, Any],
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "slug": slug,
            "name": name,
            "system_prompt": system_prompt,
            "tool_allowlist": list(tool_allowlist),
            "model_settings": model_settings,
        }
        if description is not None:
            body["description"] = description
        return await self._post(_agents_base(sandbox_id), body)

    async def list(
        self,
        sandbox_id: str,
        *,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self._get(
            _agents_base(sandbox_id),
            query={"status": status},
        )

    async def retrieve(self, sandbox_id: str, slug: str) -> Dict[str, Any]:
        return await self._get(f"{_agents_base(sandbox_id)}/{slug}")

    async def update(
        self,
        sandbox_id: str,
        slug: str,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
        system_prompt: Optional[str] = None,
        tool_allowlist: Optional[List[str]] = None,
        model_settings: Optional[Dict[str, Any]] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if description is not None:
            body["description"] = description
        if system_prompt is not None:
            body["system_prompt"] = system_prompt
        if tool_allowlist is not None:
            body["tool_allowlist"] = list(tool_allowlist)
        if model_settings is not None:
            body["model_settings"] = model_settings
        if status is not None:
            body["status"] = status
        return await self._patch(f"{_agents_base(sandbox_id)}/{slug}", body)

    async def archive(self, sandbox_id: str, slug: str) -> None:
        await self._delete(f"{_agents_base(sandbox_id)}/{slug}")

    async def update_tool_sources(
        self,
        sandbox_id: str,
        slug: str,
        tool_sources: Optional[List[str]],
    ) -> Dict[str, Any]:
        """Replace an agent's ``tool_sources`` (resolver list).

        Targets ``PATCH /agents/{slug}/tool-sources``. Distinct from
        :meth:`update` so the absent-vs-null distinction is structural:

        * ``tool_sources=None`` — sent as JSON ``null``; reverts to the
          caller's default tool-sources set.
        * ``tool_sources=[]`` — explicit "tool-less by choice".
        * ``tool_sources=[...]`` — set the list verbatim.

        Distinct from ``tool_allowlist`` — this controls which
        RESOLVERS run (which tools are AVAILABLE), not which tool
        NAMES are CALLABLE. Returns the updated agent.
        """
        body: Dict[str, Any] = {
            "tool_sources": (
                None if tool_sources is None else list(tool_sources)
            ),
        }
        return await self._patch(
            f"{_agents_base(sandbox_id)}/{slug}/tool-sources", body,
        )

    async def wire_integration(
        self,
        sandbox_id: str,
        slug: str,
        app_slug: str,
    ) -> WireIntegrationResult:
        """Wire a third-party integration's tools into one agent atomically.

        Targets ``POST /agents/{slug}/wire-integration``. Resolves
        ``app_slug`` against the user's active OAuth-connected
        providers, unions the matching source(s) into the agent's
        ``tool_sources``, and rebuilds ``tool_allowlist`` from the
        full resulting source set in one ``update_agent`` call.

        Idempotent per ADR 0006: re-firing on an already-wired
        ``(slug, app_slug)`` pair returns
        ``WireIntegrationResult(sources_added=[], ...)`` with the
        current ``tool_count``.
        """
        body = {"app_slug": app_slug}
        payload = await self._post(
            f"{_agents_base(sandbox_id)}/{slug}/wire-integration", body,
        )
        return WireIntegrationResult.from_dict(payload)

    # ── Invocation ──────────────────────────────────────────────

    async def test_fire(
        self,
        sandbox_id: str,
        slug: str,
        *,
        event_payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {}
        if event_payload is not None:
            body["event_payload"] = event_payload
        return await self._post(
            f"{_agents_base(sandbox_id)}/{slug}/test", body
        )

    # ── Run reads ───────────────────────────────────────────────

    async def list_runs(
        self,
        sandbox_id: str,
        slug: str,
        *,
        limit: Optional[int] = None,
        before: Optional[str] = None,
    ) -> Dict[str, Any]:
        query: Dict[str, Any] = {}
        if limit is not None:
            query["limit"] = str(limit)
        if before is not None:
            query["before"] = before
        return await self._get(
            f"{_agents_base(sandbox_id)}/{slug}/runs",
            query=query or None,
        )

    async def get_run(
        self,
        sandbox_id: str,
        run_id: str,
    ) -> Dict[str, Any]:
        """Fetch a single agent run with its full ``tool_resolution_trace``.

        Targets the Phase 1A endpoint
        ``GET /sandboxes/{sandbox_id}/agents/runs/{run_id}``. The trace
        JSON is the answer to "why did this agent silently do nothing?";
        older runs and ad-hoc invocations may return ``null`` for it.
        """
        return await self._get(
            f"{_agents_base(sandbox_id)}/runs/{run_id}"
        )

    # ── Tool catalogue + trigger registry ──────────────────────

    async def list_tools(self, sandbox_id: str) -> Dict[str, Any]:
        """Dynamic-per-sandbox tool catalog resolved from the user's
        connected integrations. Server-side at
        ``GET /agents/tools``."""
        return await self._get(f"{_agents_base(sandbox_id)}/tools")

    async def list_trigger_components(
        self,
        sandbox_id: str,
        *,
        app: Optional[str] = None,
        q: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Search the active trigger-provider's component registry. Use
        before recommending a trigger to discover the right slug + its
        ``configurable_props`` schema."""
        query: Dict[str, Any] = {}
        if app is not None:
            query["app"] = app
        if q is not None:
            query["q"] = q
        if limit is not None:
            query["limit"] = str(limit)
        return await self._get(
            f"{_agents_base(sandbox_id)}/triggers/components",
            query=query or None,
        )


__all__ = [
    "AgentsResource",
    "AgentTriggersResource",
    "WireIntegrationMode",
    "WireIntegrationResult",
]
