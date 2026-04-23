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

    async def ingest(
        self,
        sandbox_id: str,
        source_id: str,
        *,
        text: str,
        source_type: Optional[str] = None,
        storage_only: Optional[bool] = None,
        project_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Primary ingestion path — pushes ``text`` through this
        data source. Equivalent to calling
        ``client.ingest.text_in_sandbox(sandbox_id, text=..., data_source_id=source_id)``.
        """
        body: Dict[str, Any] = {"text": text, "data_source_id": source_id}
        if source_type is not None:
            body["source_type"] = source_type
        if storage_only is not None:
            body["storage_only"] = storage_only
        if project_id is not None:
            body["project_id"] = project_id
        return await self._post(_ingest_base(sandbox_id), body)


__all__ = [
    "SourcesResource",
    "DataSource",
    "DataSourceProvider",
    "DataSourceIngestionMode",
    "DataSourceStatus",
    "DataSourceKind",
]
