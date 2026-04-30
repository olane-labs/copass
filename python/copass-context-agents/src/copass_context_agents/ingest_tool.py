"""Copass ingestion as a provider-neutral :class:`AgentTool`.

Python analogue of the ``ingest`` tool registered by
``typescript/packages/mcp/src/tools/ingest.ts``. Same HTTP call
(``client.sources.ingest(...)``), same semantics — just shaped for
the core agent runtime's tool catalog.

Intent: let an agent **voluntarily commit** content worth preserving
into durable sandbox storage. Complements
:class:`CopassTurnRecorder`, which mirrors every turn into the
ephemeral Context Window. The LLM calls ``ingest`` when it learns
something that should outlive this conversation — architecture
decisions, user-shared framing, corrections, durable notes.

Not for turn-by-turn capture. Every agent turn is already pushed to
the Context Window by :class:`CopassTurnRecorder`. Ingest is the
intentional "promote this to durable knowledge" call. The LLM-facing
description says so explicitly.

Cache-safety: same story as the retrieval tools — :class:`ToolSpec`
is built from frozen strings + a constant JSON schema, so rebuilding
on each invocation yields an identical fingerprint and the
provider's agent cache keeps hitting.
"""

from __future__ import annotations

from typing import Optional

from copass_core import CopassClient
from copass_core_agents.base_tool import AgentTool, ToolSpec
from copass_core_agents.invocation_context import AgentInvocationContext


# Canonical copy with `typescript/packages/mcp/src/tools/ingest.ts`. When
# `INGEST_DESCRIPTION` lands in `copass_config.tool_descriptions` (and
# `@copass/config`), switch this + the MCP server to an import.
_INGEST_DESCRIPTION = (
    "Push content into the knowledge graph via a data source. Use for: "
    'architecture decisions (source_type: "decision"), user-shared context '
    '("user_input"), corrections ("correction"), durable notes, any '
    "significant new concept. Do NOT ingest trivial changes or ephemeral "
    "debug context — those belong in the Context Window (every agent turn "
    "is already mirrored there automatically). Call this only when the "
    "content is worth preserving beyond the current conversation."
)

_CONTENT_PARAM = "The content to ingest. Non-empty."
_SOURCE_TYPE_PARAM = (
    "Type tag: code, markdown, json, text, conversation, decision, correction, "
    "user_input. Defaults to the tool's configured default_source_type when omitted."
)
_STORAGE_ONLY_PARAM = "If true, chunk and store but skip ontology ingestion."
_OCCURRED_AT_PARAM = (
    "Optional ISO 8601 timestamp anchoring the content to a real-world moment "
    "(e.g. when the user said it, when the decision was made). Used as the "
    "default occurred_at for any composed event whose own LLM-extracted "
    "timestamp is None, so temporal queries can find this content."
)


class _CopassIngestTool(AgentTool):
    def __init__(
        self,
        *,
        client: CopassClient,
        sandbox_id: str,
        data_source_id: str,
        project_id: Optional[str],
        default_source_type: str,
        author: Optional[str],
    ) -> None:
        self._client = client
        self._sandbox_id = sandbox_id
        self._data_source_id = data_source_id
        self._project_id = project_id
        self._default_source_type = default_source_type
        self._author = author

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="ingest",
            description=_INGEST_DESCRIPTION,
            input_schema={
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "minLength": 1,
                        "description": _CONTENT_PARAM,
                    },
                    "source_type": {
                        "type": "string",
                        "description": _SOURCE_TYPE_PARAM,
                    },
                    "storage_only": {
                        "type": "boolean",
                        "description": _STORAGE_ONLY_PARAM,
                    },
                    "occurred_at": {
                        "type": "string",
                        "description": _OCCURRED_AT_PARAM,
                    },
                },
                "required": ["content"],
                "additionalProperties": False,
            },
        )

    async def invoke(
        self,
        arguments: dict,
        *,
        context: Optional[AgentInvocationContext] = None,
    ) -> dict:
        content = str(arguments.get("content", "")).strip()
        if not content:
            return {"error": "content is required and must be non-empty"}

        # Provenance prefix — until the ingest API / ChatMessage grow
        # a first-class author envelope, embed it as a structured
        # header so downstream retrieval can see who committed this
        # knowledge.
        if self._author:
            content = f"[author={self._author}]\n{content}"

        source_type = arguments.get("source_type") or self._default_source_type
        storage_only = arguments.get("storage_only")
        occurred_at = arguments.get("occurred_at")

        response = await self._client.sources.ingest(
            self._sandbox_id,
            self._data_source_id,
            text=content,
            source_type=source_type,
            storage_only=storage_only,
            project_id=self._project_id,
            occurred_at=occurred_at,
        )
        return {
            "job_id": response.get("job_id"),
            "status": response.get("status"),
            "data_source_id": self._data_source_id,
        }


def copass_ingest_tool(
    *,
    client: CopassClient,
    sandbox_id: str,
    data_source_id: str,
    project_id: Optional[str] = None,
    default_source_type: str = "text",
    author: Optional[str] = None,
) -> AgentTool:
    """Return the ``ingest`` :class:`AgentTool`.

    Args:
        client: An authenticated :class:`copass_core.CopassClient`.
        sandbox_id: Sandbox the target data source lives in.
        data_source_id: Target data source for durable ingestion.
            Must be pre-registered — use
            ``client.sources.register(sandbox_id, ...)`` or the
            ``copass source register`` CLI to create one.
        project_id: Optional project scoping.
        default_source_type: Default ``source_type`` when the model
            omits the argument. ``"text"`` matches the MCP server's
            behavior; override to ``"conversation"`` for chat-style
            agents or ``"decision"`` for agents whose primary job
            is architecture capture.
        author: Optional identifier of whoever is running the agent
            (``"agent:support-bot"``, ``"user"``, etc.). When set,
            ingested content is prefixed with ``"[author=...]\\n"``
            so retrieval can distinguish provenance. Remove once the
            ingest API / :class:`ChatMessage` grows a first-class
            author field.

    Returns:
        One :class:`AgentTool` — register it via
        ``AgentToolRegistry.add(...)``.
    """
    return _CopassIngestTool(
        client=client,
        sandbox_id=sandbox_id,
        data_source_id=data_source_id,
        project_id=project_id,
        default_source_type=default_source_type,
        author=author,
    )


__all__ = ["copass_ingest_tool"]
