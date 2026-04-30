"""Ingest resource — low-level chunking + ontology ingestion pipeline.

Port of ``typescript/packages/core/src/resources/ingest.ts`` plus
``types/ingest.ts``. Prefer :meth:`SourcesResource.ingest` for
data-source-attributed ingestion; use this resource directly only for
quick-start experiments or for polling job status.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional

from copass_core.resources.base import BaseResource


IngestSourceType = str  # "text" | "conversation" | "markdown" | "code" | "json" | custom
IngestJobState = str  # "queued" | "pending" | "processing" | "completed" | "failed" | "cancelled" | custom

_SHORTHAND = "/api/v1/storage/ingest"


def _explicit_base(sandbox_id: str) -> str:
    return f"/api/v1/storage/sandboxes/{sandbox_id}/ingest"


class IngestResource(BaseResource):
    """Ingest endpoints.

    Two pairs of entry points:

    - :meth:`text` + :meth:`get_job` — shorthand that auto-resolves
      the caller's primary sandbox.
    - :meth:`text_in_sandbox` + :meth:`get_sandbox_job` — explicit
      sandbox id.
    """

    async def text(
        self,
        *,
        text: str,
        source_type: Optional[str] = None,
        storage_only: Optional[bool] = None,
        project_id: Optional[str] = None,
        data_source_id: Optional[str] = None,
        occurred_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        body = _build_ingest_body(
            text=text,
            source_type=source_type,
            storage_only=storage_only,
            project_id=project_id,
            data_source_id=data_source_id,
            occurred_at=occurred_at,
        )
        return await self._post(_SHORTHAND, body)

    async def get_job(self, job_id: str) -> Dict[str, Any]:
        return await self._get(f"{_SHORTHAND}/{job_id}")

    async def text_in_sandbox(
        self,
        sandbox_id: str,
        *,
        text: str,
        source_type: Optional[str] = None,
        storage_only: Optional[bool] = None,
        project_id: Optional[str] = None,
        data_source_id: Optional[str] = None,
        occurred_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        body = _build_ingest_body(
            text=text,
            source_type=source_type,
            storage_only=storage_only,
            project_id=project_id,
            data_source_id=data_source_id,
            occurred_at=occurred_at,
        )
        return await self._post(_explicit_base(sandbox_id), body)

    async def get_sandbox_job(self, sandbox_id: str, job_id: str) -> Dict[str, Any]:
        return await self._get(f"{_explicit_base(sandbox_id)}/{job_id}")


def _build_ingest_body(
    *,
    text: str,
    source_type: Optional[str],
    storage_only: Optional[bool],
    project_id: Optional[str],
    data_source_id: Optional[str],
    occurred_at: Optional[str] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {"text": text}
    if source_type is not None:
        body["source_type"] = source_type
    if storage_only is not None:
        body["storage_only"] = storage_only
    if project_id is not None:
        body["project_id"] = project_id
    if data_source_id is not None:
        body["data_source_id"] = data_source_id
    if occurred_at is not None:
        body["occurred_at"] = occurred_at
    return body


__all__ = [
    "IngestResource",
    "IngestSourceType",
    "IngestJobState",
]
