"""Copass retrieval as provider-neutral :class:`AgentTool` instances.

Python analogue of ``typescript/packages/langchain/src/tools.ts`` ·
``copassTools(...)``. Returns the three context-engineering primitives
— ``discover``, ``interpret``, ``search`` — shaped for the core agent
runtime, so any :class:`BaseAgent` subclass (Anthropic managed agents,
Google Vertex AI Agent Engine, …) registers them with one call.

Why these three, and why always together:

* ``discover`` — window-aware ranked menu. Cheap, repeatable, and the
  first call every agent should make when a new goal lands. Because
  the server filters items already surfaced in this conversation's
  window, subsequent calls always return NEW signal — agents can
  lean on it freely without wasting tokens.
* ``interpret`` — paragraph brief pinned to specific items returned
  by ``discover``. Lets the model drill down without paying for a
  full retrieval round-trip.
* ``search`` — one-shot synthesized answer. Heavier; prefer
  ``discover`` → ``interpret`` for exploration.

Descriptions come from :mod:`copass_config` — the single source of
truth the TypeScript ``@copass/config`` package mirrors. Editing here
is a bug; edit the shared module and rebuild all adapters.

Cache-safety note (Anthropic Managed Agents):

    Provider adapters that cache managed-agent resources by a
    fingerprint of ``(model, system_prompt, tool_specs)`` rely on
    :class:`ToolSpec` being stable across invocations. Every spec
    returned here is built from frozen module-level strings +
    a constant JSON schema — so rebuilding the tool list on each
    invocation produces an identical fingerprint. Re-creating the
    tools does NOT invalidate the cache. Safe to call
    :func:`copass_retrieval_tools` once at agent construction and
    forget about it.

Example::

    from copass_core import CopassClient
    from copass_core_agents import AgentToolRegistry
    from copass_context_agents import copass_retrieval_tools

    copass = CopassClient(...)
    window = await copass.context_window.create(sandbox_id=sandbox_id)

    registry = AgentToolRegistry()
    registry.extend(
        copass_retrieval_tools(
            client=copass,
            sandbox_id=sandbox_id,
            window=window,
        )
    )
"""

from __future__ import annotations

from typing import List, Optional

from copass_config.param_descriptions import (
    DISCOVER_QUERY_PARAM,
    INTERPRET_ITEMS_PARAM,
    INTERPRET_QUERY_PARAM,
    ORIGIN_CANONICAL_IDS_PARAM,
    ORIGIN_LIMIT_PARAM,
    SEARCH_QUERY_PARAM,
)
from copass_config.tool_descriptions import (
    DISCOVER_DESCRIPTION,
    GET_ORIGIN_DESCRIPTION,
    INTERPRET_DESCRIPTION,
    SEARCH_DESCRIPTION,
)
from copass_core import CopassClient
from copass_core.types import SearchPreset, WindowLike
from copass_core_agents.base_tool import AgentTool, ToolSpec
from copass_core_agents.invocation_context import AgentInvocationContext


class _CopassDiscoverTool(AgentTool):
    def __init__(
        self,
        *,
        client: CopassClient,
        sandbox_id: str,
        project_id: Optional[str],
        window: Optional[WindowLike],
        preset: SearchPreset,
    ) -> None:
        self._client = client
        self._sandbox_id = sandbox_id
        self._project_id = project_id
        self._window = window
        self._preset = preset

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="discover",
            description=DISCOVER_DESCRIPTION,
            input_schema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": DISCOVER_QUERY_PARAM,
                    },
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        )

    async def invoke(
        self,
        arguments: dict,
        *,
        context: Optional[AgentInvocationContext] = None,
    ) -> dict:
        response = await self._client.retrieval.discover(
            self._sandbox_id,
            query=str(arguments.get("query", "")),
            project_id=self._project_id,
            window=self._window,
            preset=self._preset,
        )
        return {
            "header": response.get("header"),
            "items": [
                # Project the v2 fields (``subgraph`` + ``matched_query_nodes``)
                # alongside the v1 fields. They're populated only when the
                # configured preset is ``copass/copass_2.0`` (or its
                # ``copass/2.0`` alias); under v1 they come back as ``None``
                # and the LLM ignores them.
                {
                    "score": item.get("score"),
                    "summary": item.get("summary"),
                    "canonical_ids": item.get("canonical_ids", []),
                    "subgraph": item.get("subgraph"),
                    "matched_query_nodes": item.get("matched_query_nodes"),
                    # Inline source-file paths so the agent can ``read``
                    # directly without a follow-up ``get_origin`` call.
                    # Empty list when the backend couldn't enrich
                    # (legacy sandbox / no file markers in source chunks).
                    "file_paths": item.get("file_paths") or [],
                }
                for item in response.get("items", [])
            ],
            "next_steps": response.get("next_steps"),
        }


class _CopassInterpretTool(AgentTool):
    def __init__(
        self,
        *,
        client: CopassClient,
        sandbox_id: str,
        project_id: Optional[str],
        window: Optional[WindowLike],
        preset: SearchPreset,
    ) -> None:
        self._client = client
        self._sandbox_id = sandbox_id
        self._project_id = project_id
        self._window = window
        self._preset = preset

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="interpret",
            description=INTERPRET_DESCRIPTION,
            input_schema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": INTERPRET_QUERY_PARAM,
                    },
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 1,
                        },
                        "minItems": 1,
                        "description": INTERPRET_ITEMS_PARAM,
                    },
                },
                "required": ["query", "items"],
                "additionalProperties": False,
            },
        )

    async def invoke(
        self,
        arguments: dict,
        *,
        context: Optional[AgentInvocationContext] = None,
    ) -> dict:
        raw_items = arguments.get("items", []) or []
        items: List[List[str]] = [
            [str(x) for x in tup] for tup in raw_items if tup
        ]
        response = await self._client.retrieval.interpret(
            self._sandbox_id,
            query=str(arguments.get("query", "")),
            items=items,
            project_id=self._project_id,
            window=self._window,
            preset=self._preset,
        )
        return {"brief": response.get("brief")}


class _CopassSearchTool(AgentTool):
    def __init__(
        self,
        *,
        client: CopassClient,
        sandbox_id: str,
        project_id: Optional[str],
        window: Optional[WindowLike],
        preset: SearchPreset,
    ) -> None:
        self._client = client
        self._sandbox_id = sandbox_id
        self._project_id = project_id
        self._window = window
        self._preset = preset

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="search",
            description=SEARCH_DESCRIPTION,
            input_schema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": SEARCH_QUERY_PARAM,
                    },
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        )

    async def invoke(
        self,
        arguments: dict,
        *,
        context: Optional[AgentInvocationContext] = None,
    ) -> dict:
        response = await self._client.retrieval.search(
            self._sandbox_id,
            query=str(arguments.get("query", "")),
            project_id=self._project_id,
            window=self._window,
            preset=self._preset,
        )
        return {"answer": response.get("answer")}


class _CopassGetOriginTool(AgentTool):
    def __init__(
        self,
        *,
        client: CopassClient,
        sandbox_id: str,
    ) -> None:
        self._client = client
        self._sandbox_id = sandbox_id

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="get_origin",
            description=GET_ORIGIN_DESCRIPTION,
            input_schema={
                "type": "object",
                "properties": {
                    "canonical_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "maxItems": 100,
                        "description": ORIGIN_CANONICAL_IDS_PARAM,
                    },
                    "limit_per_canonical": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 50,
                        "description": ORIGIN_LIMIT_PARAM,
                    },
                },
                "required": ["canonical_ids"],
                "additionalProperties": False,
            },
        )

    async def invoke(
        self,
        arguments: dict,
        *,
        context: Optional[AgentInvocationContext] = None,
    ) -> dict:
        raw_ids = arguments.get("canonical_ids", []) or []
        canonical_ids: List[str] = [str(x) for x in raw_ids if x]
        limit = arguments.get("limit_per_canonical")
        response = await self._client.retrieval.get_origin(
            self._sandbox_id,
            canonical_ids=canonical_ids,
            limit_per_canonical=int(limit) if limit is not None else None,
        )
        return {
            "sandbox_id": response.get("sandbox_id"),
            "origins": [
                {
                    "canonical_id": entry.get("canonical_id"),
                    "files": [
                        {
                            "file_path": f.get("file_path"),
                            "extraction_count": f.get("extraction_count"),
                        }
                        for f in entry.get("files", [])
                    ],
                }
                for entry in response.get("origins", [])
            ],
        }


def copass_retrieval_tools(
    *,
    client: CopassClient,
    sandbox_id: str,
    project_id: Optional[str] = None,
    window: Optional[WindowLike] = None,
    preset: SearchPreset = "copass/copass_1.0",
) -> List[AgentTool]:
    """Return ``[discover, interpret, search, get_origin]`` as :class:`AgentTool` instances.

    Args:
        client: An authenticated :class:`copass_core.CopassClient`.
        sandbox_id: Sandbox all retrieval runs against.
        project_id: Optional project scoping applied to every call.
        window: Optional :class:`WindowLike` (typically a
            :class:`ContextWindow`). When set, every retrieval call
            is window-aware — repeated ``discover`` calls skip items
            already surfaced earlier in this conversation.
        preset: Preset for ``discover`` / ``interpret`` / ``search``.
            Defaults to ``"copass/copass_1.0"``. Under
            ``"copass/copass_2.0"`` discover items carry ``subgraph``
            (pre-rendered ASCII tree) and ``matched_query_nodes``
            fields. Append ``":thinking"`` (e.g.
            ``"copass/copass_2.0:thinking"``) to enable task
            decomposition on ``search``.

    Returns:
        ``[discover, interpret, search, get_origin]`` ready to pass to
        :meth:`AgentToolRegistry.extend`. The first three are
        window-aware; ``get_origin`` is a cheap windowless lookup that
        maps canonical_ids to source files.
    """
    return [
        _CopassDiscoverTool(
            client=client,
            sandbox_id=sandbox_id,
            project_id=project_id,
            window=window,
            preset=preset,
        ),
        _CopassInterpretTool(
            client=client,
            sandbox_id=sandbox_id,
            project_id=project_id,
            window=window,
            preset=preset,
        ),
        _CopassSearchTool(
            client=client,
            sandbox_id=sandbox_id,
            project_id=project_id,
            window=window,
            preset=preset,
        ),
        _CopassGetOriginTool(
            client=client,
            sandbox_id=sandbox_id,
        ),
    ]


__all__ = ["copass_retrieval_tools"]
