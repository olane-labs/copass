"""Sandboxes resource — the top-level tenancy unit.

Port of ``typescript/packages/core/src/resources/sandboxes.ts`` plus
``types/sandboxes.ts``. A sandbox owns its data sources, projects,
vault, and ingestion jobs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional

from copass_core.resources.base import BaseResource


SandboxTier = Literal["free", "pro", "enterprise"]
SandboxStatus = Literal["active", "suspended", "archived"]
SandboxStorageProvider = Literal["platform_s3", "custom_s3"]


@dataclass(frozen=True)
class SandboxLimits:
    max_data_sources: int
    max_projects: int
    max_storage_bytes: int
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Sandbox:
    sandbox_id: str
    user_id: str
    owner_id: str
    name: str
    tier: SandboxTier
    status: SandboxStatus
    storage_provider_type: SandboxStorageProvider
    limits: Dict[str, Any]
    metadata: Dict[str, Any]
    created_at: Optional[str] = None


@dataclass(frozen=True)
class StatusResponse:
    success: bool
    message: Optional[str] = None


_BASE = "/api/v1/storage/sandboxes"


class SandboxesResource(BaseResource):
    """``/api/v1/storage/sandboxes``."""

    async def create(
        self,
        *,
        name: str,
        owner_id: str,
        tier: Optional[SandboxTier] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"name": name, "owner_id": owner_id}
        if tier is not None:
            body["tier"] = tier
        if metadata is not None:
            body["metadata"] = metadata
        return await self._post(_BASE, body)

    async def list(
        self,
        *,
        status: Optional[SandboxStatus] = None,
        owner_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self._get(
            _BASE,
            query={"status": status, "owner_id": owner_id},
        )

    async def retrieve(self, sandbox_id: str) -> Dict[str, Any]:
        return await self._get(f"{_BASE}/{sandbox_id}")

    async def update(
        self,
        sandbox_id: str,
        *,
        name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        updates: Dict[str, Any] = {}
        if name is not None:
            updates["name"] = name
        if metadata is not None:
            updates["metadata"] = metadata
        return await self._patch(f"{_BASE}/{sandbox_id}", updates)

    async def suspend(self, sandbox_id: str) -> Dict[str, Any]:
        return await self._post(f"{_BASE}/{sandbox_id}/suspend")

    async def reactivate(self, sandbox_id: str) -> Dict[str, Any]:
        return await self._post(f"{_BASE}/{sandbox_id}/reactivate")

    async def archive(self, sandbox_id: str) -> Dict[str, Any]:
        return await self._post(f"{_BASE}/{sandbox_id}/archive")

    async def destroy(self, sandbox_id: str) -> Dict[str, Any]:
        return await self._delete(f"{_BASE}/{sandbox_id}")


__all__ = [
    "SandboxesResource",
    "Sandbox",
    "SandboxLimits",
    "SandboxTier",
    "SandboxStatus",
    "SandboxStorageProvider",
    "StatusResponse",
]
