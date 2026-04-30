"""Data sources resource — unit of attribution for ingestion.

Port of ``typescript/packages/core/src/resources/sources.ts`` plus
``types/sources.ts``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional

from copass_core.resources.base import BaseResource


DataSourceProvider = str  # "slack" | "github" | ... | custom string
DataSourceIngestionMode = Literal["realtime", "polling", "batch", "manual"]
DataSourceStatus = Literal[
    "active", "paused", "disconnected", "error", "archived"
]  # plus open-ended strings at runtime
DataSourceKind = Literal["durable", "ephemeral"]


@dataclass(frozen=True)
class DataSource:
    data_source_id: str
    user_id: str
    sandbox_id: str
    provider: str
    name: str
    ingestion_mode: str
    status: str
    adapter_config: Dict[str, Any]
    kind: Optional[str] = None
    external_account_id: Optional[str] = None
    poll_interval_seconds: Optional[int] = None
    webhook_url: Optional[str] = None
    last_sync_at: Optional[str] = None
    created_at: Optional[str] = None


@dataclass(frozen=True)
class UserMcpSourceResult:
    """Outcome of a ``user_mcp`` lifecycle call.

    On success, ``data_source_id`` and ``status`` are populated. On
    health-check failure, ``status == 'error'`` and ``health_error``
    carries a short reason. Validation failures surface at the HTTP
    layer (400) before reaching here; the dataclass shape matches the
    server's ``UserMCPSourceResultResponse``.
    """

    data_source_id: Optional[str] = None
    status: Optional[str] = None
    name: Optional[str] = None
    ingestion_mode: Optional[str] = None
    health_error: Optional[str] = None
    error: Optional[str] = None
    detail: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "UserMcpSourceResult":
        return cls(
            data_source_id=d.get("data_source_id"),
            status=d.get("status"),
            name=d.get("name"),
            ingestion_mode=d.get("ingestion_mode"),
            health_error=d.get("health_error"),
            error=d.get("error"),
            detail=d.get("detail"),
        )


def _base(sandbox_id: str) -> str:
    return f"/api/v1/storage/sandboxes/{sandbox_id}/sources"


def _ingest_base(sandbox_id: str) -> str:
    return f"/api/v1/storage/sandboxes/{sandbox_id}/ingest"


class SourcesResource(BaseResource):
    """``/api/v1/storage/sandboxes/{id}/sources``."""

    async def register(
        self,
        sandbox_id: str,
        *,
        provider: str,
        name: str,
        ingestion_mode: Optional[DataSourceIngestionMode] = None,
        kind: Optional[DataSourceKind] = None,
        external_account_id: Optional[str] = None,
        adapter_config: Optional[Dict[str, Any]] = None,
        poll_interval_seconds: Optional[int] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"provider": provider, "name": name}
        if ingestion_mode is not None:
            body["ingestion_mode"] = ingestion_mode
        if kind is not None:
            body["kind"] = kind
        if external_account_id is not None:
            body["external_account_id"] = external_account_id
        if adapter_config is not None:
            body["adapter_config"] = adapter_config
        if poll_interval_seconds is not None:
            body["poll_interval_seconds"] = poll_interval_seconds
        return await self._post(_base(sandbox_id), body)

    async def list(
        self,
        sandbox_id: str,
        *,
        provider: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self._get(
            _base(sandbox_id),
            query={"provider": provider, "status": status},
        )

    async def retrieve(self, sandbox_id: str, source_id: str) -> Dict[str, Any]:
        return await self._get(f"{_base(sandbox_id)}/{source_id}")

    async def update(
        self,
        sandbox_id: str,
        source_id: str,
        *,
        name: Optional[str] = None,
        ingestion_mode: Optional[DataSourceIngestionMode] = None,
        external_account_id: Optional[str] = None,
        adapter_config: Optional[Dict[str, Any]] = None,
        poll_interval_seconds: Optional[int] = None,
    ) -> Dict[str, Any]:
        updates: Dict[str, Any] = {}
        if name is not None:
            updates["name"] = name
        if ingestion_mode is not None:
            updates["ingestion_mode"] = ingestion_mode
        if external_account_id is not None:
            updates["external_account_id"] = external_account_id
        if adapter_config is not None:
            updates["adapter_config"] = adapter_config
        if poll_interval_seconds is not None:
            updates["poll_interval_seconds"] = poll_interval_seconds
        return await self._patch(f"{_base(sandbox_id)}/{source_id}", updates)

    async def pause(self, sandbox_id: str, source_id: str) -> Dict[str, Any]:
        return await self._post(f"{_base(sandbox_id)}/{source_id}/pause")

    async def resume(self, sandbox_id: str, source_id: str) -> Dict[str, Any]:
        return await self._post(f"{_base(sandbox_id)}/{source_id}/resume")

    async def disconnect(self, sandbox_id: str, source_id: str) -> Dict[str, Any]:
        return await self._post(f"{_base(sandbox_id)}/{source_id}/disconnect")

    async def delete(self, sandbox_id: str, source_id: str) -> Dict[str, Any]:
        return await self._delete(f"{_base(sandbox_id)}/{source_id}")

    # ─── user_mcp lifecycle ──────────────────────────────────────────
    #
    # Distinct from ``register`` because the secret-aware flow lives on
    # the server (vault-put before row write, health check, namespace
    # uniqueness, durability sequencing). Going through ``register``
    # with ``provider='user_mcp'`` would store the bearer token
    # plaintext on ``adapter_config`` — these methods route through
    # ``POST /sources/user-mcp`` so the server runs the safe path.

    async def register_user_mcp(
        self,
        sandbox_id: str,
        *,
        name: str,
        base_url: str,
        auth_kind: Literal["bearer", "header_token", "none"],
        token: Optional[str] = None,
        auth_header: Optional[str] = None,
        app_namespace: Optional[str] = None,
        allowed_tools: Optional[List[str]] = None,
        ingest_tool_calls: Optional[List[Dict[str, Any]]] = None,
        rate_cap_per_minute: Optional[int] = None,
        webhook_rate_cap_per_minute: Optional[int] = None,
    ) -> UserMcpSourceResult:
        """Register a tenant-supplied MCP server as a ``user_mcp`` source.

        ``token`` is vault-put server-side under ``user_mcp/<id>/auth``;
        only the vault key reference lives on the row. A one-shot
        ``tools/list`` health check runs before returning. On health
        failure the source lands with ``status='error'`` and the caller
        can retry via :meth:`test_user_mcp`. On success, status is
        ``'active'``.
        """
        body: Dict[str, Any] = {
            "name": name,
            "base_url": base_url,
            "auth_kind": auth_kind,
        }
        if token is not None:
            body["token"] = token
        if auth_header is not None:
            body["auth_header"] = auth_header
        if app_namespace is not None:
            body["app_namespace"] = app_namespace
        if allowed_tools is not None:
            body["allowed_tools"] = allowed_tools
        if ingest_tool_calls is not None:
            body["ingest_tool_calls"] = ingest_tool_calls
        if rate_cap_per_minute is not None:
            body["rate_cap_per_minute"] = rate_cap_per_minute
        if webhook_rate_cap_per_minute is not None:
            body["webhook_rate_cap_per_minute"] = webhook_rate_cap_per_minute
        result = await self._post(f"{_base(sandbox_id)}/user-mcp", body)
        return UserMcpSourceResult.from_dict(result)

    async def test_user_mcp(
        self, sandbox_id: str, source_id: str,
    ) -> UserMcpSourceResult:
        """Re-run the health check on a ``user_mcp`` source.

        Flips status to ``'active'`` on success or ``'error'`` on
        failure. Use after fixing whatever made
        :meth:`register_user_mcp` land in error state.
        """
        result = await self._post(
            f"{_base(sandbox_id)}/{source_id}/user-mcp/test",
        )
        return UserMcpSourceResult.from_dict(result)

    async def revoke_user_mcp(
        self, sandbox_id: str, source_id: str,
    ) -> UserMcpSourceResult:
        """Disconnect a ``user_mcp`` source.

        Deletes vault-stored secrets (auth + webhook signing if
        present), sets status to ``'disconnected'`` (terminal), and
        evicts both the agent-side tool-cap bucket and the receiver-
        side webhook-cap bucket so revocation is observed within one
        request. Reversible only by calling :meth:`register_user_mcp`
        again.
        """
        result = await self._post(
            f"{_base(sandbox_id)}/{source_id}/user-mcp/revoke",
        )
        return UserMcpSourceResult.from_dict(result)

    async def ingest(
        self,
        sandbox_id: str,
        source_id: str,
        *,
        text: str,
        source_type: Optional[str] = None,
        storage_only: Optional[bool] = None,
        project_id: Optional[str] = None,
        occurred_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Primary ingestion path — pushes ``text`` through this
        data source. Equivalent to calling
        ``client.ingest.text_in_sandbox(sandbox_id, text=..., data_source_id=source_id)``.

        ``occurred_at`` anchors the payload to a real-world timestamp
        (ISO 8601). The backend uses it as the default ``occurred_at``
        for any composed event whose own LLM-extracted occurred_at is
        None — so temporal queries can find the content even when the
        upstream extractor doesn't pull dates out of the body.
        """
        body: Dict[str, Any] = {"text": text, "data_source_id": source_id}
        if source_type is not None:
            body["source_type"] = source_type
        if storage_only is not None:
            body["storage_only"] = storage_only
        if project_id is not None:
            body["project_id"] = project_id
        if occurred_at is not None:
            body["occurred_at"] = occurred_at
        return await self._post(_ingest_base(sandbox_id), body)


__all__ = [
    "SourcesResource",
    "DataSource",
    "DataSourceProvider",
    "DataSourceIngestionMode",
    "DataSourceStatus",
    "DataSourceKind",
    "UserMcpSourceResult",
]
