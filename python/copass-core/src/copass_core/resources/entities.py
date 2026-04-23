"""Entities resource — query canonical entities in the knowledge graph.

Port of ``typescript/packages/core/src/resources/entities.ts`` plus
``types/entities.ts``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from copass_core.resources.base import BaseResource


@dataclass(frozen=True)
class ProvenanceMetadata:
    source_type: Optional[str] = None
    confidence: Optional[float] = None
    extraction_timestamp: Optional[str] = None
    reasoning: Optional[str] = None
    source_event_id: Optional[str] = None
    extraction_batch_id: Optional[str] = None


@dataclass(frozen=True)
class Behavior:
    path_ids: List[str]
    path_names: List[str]
    depth: int
    provenance: Optional[Dict[str, Any]] = None


@dataclass(frozen=True)
class CanonicalEntity:
    canonical_id: str
    name: str
    origin_priority: Optional[int] = None
    semantic_tags: Optional[List[str]] = None
    node_count: Optional[int] = None
    behavior_count: Optional[int] = None
    similarity: Optional[float] = None
    """Search-only: cosine similarity returned by entity search."""
    record_type: Optional[str] = None
    """Search-only: record type classifier returned by entity search."""


class EntitiesResource(BaseResource):
    async def list(self) -> List[Dict[str, Any]]:
        response = await self._get("/api/v1/users/me/canonical-entities")
        return response.get("canonical_entities", []) if isinstance(response, dict) else []

    async def get_perspective(self, canonical_id: str) -> Dict[str, Any]:
        return await self._get(
            f"/api/v1/users/me/canonical-entities/{canonical_id}/perspective"
        )

    async def search(
        self,
        sandbox_id: str,
        q: str,
        *,
        limit: Optional[int] = None,
        min_similarity: Optional[float] = None,
        canonical_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Sandbox-scoped entity search.

        Hits ``GET /api/v1/storage/sandboxes/{id}/entities/search``,
        filtered to canonical entities (``record_type == "entity"``).
        """
        response = await self._get(
            f"/api/v1/storage/sandboxes/{sandbox_id}/entities/search",
            query={
                "q": q,
                "limit": str(limit) if limit is not None else None,
                "min_similarity": str(min_similarity) if min_similarity is not None else None,
                "canonical_id": canonical_id,
                "project_id": project_id,
            },
        )
        if isinstance(response, dict):
            return response.get("results", [])
        return []


__all__ = ["EntitiesResource", "CanonicalEntity", "Behavior", "ProvenanceMetadata"]
