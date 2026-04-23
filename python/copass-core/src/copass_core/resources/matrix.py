"""Matrix resource — natural language search across the knowledge graph.

Port of ``typescript/packages/core/src/resources/matrix.ts`` plus
``types/matrix.ts``.
"""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from copass_core.resources.base import BaseResource
from copass_core.types import SearchPreset as RetrievalSearchPreset


MatrixDetailLevel = Literal["concise", "detailed"]

# Matrix presets are a different shape than retrieval presets — they
# name strategy classes in the search matrix rather than response
# cost-tiers. Kept loose (``str``) at the Python surface to stay
# forward-compatible with server-side additions.
MatrixPreset = str


class MatrixResource(BaseResource):
    """``GET /api/v1/matrix/query``.

    Custom headers (``X-Search-Matrix``, ``X-Detail-Instruction``,
    ``X-Trace-Id``) carry preset + tracing hints; query params carry
    the rest.
    """

    async def query(
        self,
        *,
        query: str,
        project_id: Optional[str] = None,
        reference_date: Optional[str] = None,
        detail_level: Optional[MatrixDetailLevel] = None,
        max_tokens: Optional[int] = None,
        preset: Optional[MatrixPreset] = None,
        detail_instruction: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        headers: Dict[str, str] = {}
        if preset:
            headers["X-Search-Matrix"] = preset
        if detail_instruction:
            headers["X-Detail-Instruction"] = detail_instruction
        if trace_id:
            headers["X-Trace-Id"] = trace_id

        return await self._get(
            "/api/v1/matrix/query",
            query={
                "query": query,
                "project_id": project_id,
                "reference_date": reference_date,
                "detail_level": detail_level,
                "max_tokens": str(max_tokens) if max_tokens is not None else None,
            },
            headers=headers,
        )


__all__ = ["MatrixResource", "MatrixDetailLevel", "MatrixPreset"]
