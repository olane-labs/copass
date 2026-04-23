"""Storage projects resource — sandbox-scoped project grouping.

Port of ``typescript/packages/core/src/resources/projects.ts`` plus
``types/storage-projects.ts``. Replaces the deprecated
``/api/v1/projects/*`` indexing API — all projects live inside a
sandbox in the copass-id storage layer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional

from copass_core.resources.base import BaseResource


StorageProjectStatus = Literal["active", "archived"]


@dataclass(frozen=True)
class StorageProject:
    project_id: str
    user_id: str
    sandbox_id: str
    name: str
    status: str
    data_source_ids: List[str]
    metadata: Dict[str, Any]
    description: Optional[str] = None
    created_at: Optional[str] = None


def _base(sandbox_id: str) -> str:
    return f"/api/v1/storage/sandboxes/{sandbox_id}/projects"


class ProjectsResource(BaseResource):
    async def create(
        self,
        sandbox_id: str,
        *,
        name: str,
        description: Optional[str] = None,
        data_source_ids: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"name": name}
        if description is not None:
            body["description"] = description
        if data_source_ids is not None:
            body["data_source_ids"] = data_source_ids
        if metadata is not None:
            body["metadata"] = metadata
        return await self._post(_base(sandbox_id), body)

    async def list(
        self,
        sandbox_id: str,
        *,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self._get(_base(sandbox_id), query={"status": status})

    async def retrieve(self, sandbox_id: str, project_id: str) -> Dict[str, Any]:
        return await self._get(f"{_base(sandbox_id)}/{project_id}")

    async def update(
        self,
        sandbox_id: str,
        project_id: str,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        updates: Dict[str, Any] = {}
        if name is not None:
            updates["name"] = name
        if description is not None:
            updates["description"] = description
        if metadata is not None:
            updates["metadata"] = metadata
        return await self._patch(f"{_base(sandbox_id)}/{project_id}", updates)

    async def archive(self, sandbox_id: str, project_id: str) -> Dict[str, Any]:
        return await self._post(f"{_base(sandbox_id)}/{project_id}/archive")

    async def delete(self, sandbox_id: str, project_id: str) -> Dict[str, Any]:
        return await self._delete(f"{_base(sandbox_id)}/{project_id}")

    async def link_source(
        self, sandbox_id: str, project_id: str, source_id: str
    ) -> Dict[str, Any]:
        return await self._post(
            f"{_base(sandbox_id)}/{project_id}/sources/{source_id}"
        )

    async def unlink_source(
        self, sandbox_id: str, project_id: str, source_id: str
    ) -> Dict[str, Any]:
        return await self._delete(
            f"{_base(sandbox_id)}/{project_id}/sources/{source_id}"
        )


__all__ = ["ProjectsResource", "StorageProject", "StorageProjectStatus"]
