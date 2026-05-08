"""Ingest resource — low-level chunking + ontology ingestion pipeline.

Port of ``typescript/packages/core/src/resources/ingest.ts`` plus
``types/ingest.ts``. Prefer :meth:`SourcesResource.ingest` for
data-source-attributed ingestion; use this resource directly only for
quick-start experiments or for polling job status.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional

from copass_core.resources.base import BaseResource


# Hint describing the kind of payload being ingested. Treated as an
# advisory string by the API — not a strict enum. Conventional values:
#
#   Content-shape tokens (describe how the body is encoded):
#     "text"      — free-form text (default)
#     "markdown"  — markdown-formatted text
#     "code"      — source code; downstream extractors may apply
#                   code-aware handling
#     "json"      — JSON-encoded payload
#
#   Artifact-kind tokens (describe the underlying artifact):
#     "conversation" — chat / IM / dialogue between participants;
#                      pairs naturally with `speaker` / `participants`
#     "ticket"       — ticketing system entry (Jira, Linear, GitHub)
#     "email"        — email message; pairs with `participants`
#     "note"         — personal / shared note
#
# Custom values are accepted; the API does not gate on this field.
IngestSourceType = str
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
        speaker: Optional[str] = None,
        participants: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Submit text to the caller's primary sandbox.

        Args:
            text: The body of the payload.
            source_type: Hint describing the payload kind. Conventional
                values are documented on :data:`IngestSourceType`.
            storage_only: If True, chunk and store but do not run
                downstream ontology ingestion.
            project_id: Optional project override.
            data_source_id: Optional data source association.
            occurred_at: ISO 8601 timestamp anchoring this payload to
                a real-world moment.
            speaker: Optional name of the participant who uttered this
                payload. Caller decides the literal value (``"User"``,
                ``"Assistant"``, ``"Alice"``, an email address, etc.);
                the SDK does not auto-derive from any other field. Most
                useful on conversation-shaped sources.
            participants: Optional roster of participants present in
                the conversation / thread / artifact this payload
                belongs to. Per-message — pass the snapshot at the
                time of utterance.
        """
        body = _build_ingest_body(
            text=text,
            source_type=source_type,
            storage_only=storage_only,
            project_id=project_id,
            data_source_id=data_source_id,
            occurred_at=occurred_at,
            speaker=speaker,
            participants=participants,
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
        speaker: Optional[str] = None,
        participants: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Submit text to a specific sandbox. See :meth:`text` for arg
        semantics; ``speaker`` / ``participants`` are the per-message
        conversation metadata fields.
        """
        body = _build_ingest_body(
            text=text,
            source_type=source_type,
            storage_only=storage_only,
            project_id=project_id,
            data_source_id=data_source_id,
            occurred_at=occurred_at,
            speaker=speaker,
            participants=participants,
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
    speaker: Optional[str] = None,
    participants: Optional[List[str]] = None,
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
    if speaker is not None:
        body["speaker"] = speaker
    if participants is not None:
        body["participants"] = participants
    return body


__all__ = [
    "IngestResource",
    "IngestSourceType",
    "IngestJobState",
]
