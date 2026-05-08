"""Entities resource — sandbox-scoped entity name search.

Used to resolve a free-text entity name (e.g. "Stripe") to a canonical
id before passing it into a retrieval call. The full ontology surface
(per-canonical perspective trees, behavior listings, raw containment)
is intentionally not exposed through the public SDK.

Port of ``typescript/packages/core/src/resources/entities.ts``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from copass_core.resources.base import BaseResource


@dataclass(frozen=True)
class CanonicalEntity:
    """Search result row — minimal public projection.

    Search-only fields (``similarity``, ``record_type``) are kept because
    the CLI surfaces them when ranking candidates. Internal ontology
    fields (origin_priority, node_count, behavior_count, semantic_tags)
    are not exposed.
    """

    canonical_id: str
    name: str
    similarity: Optional[float] = None
    record_type: Optional[str] = None


class EntitiesResource(BaseResource):
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


__all__ = ["EntitiesResource", "CanonicalEntity"]
