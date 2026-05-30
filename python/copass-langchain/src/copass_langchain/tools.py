"""LangChain tool adapters for Copass retrieval.

Python mirror of ``typescript/packages/langchain/src/tools.ts`` — uses
``StructuredTool.from_function`` (the LangChain-python equivalent of
the TS ``tool()`` factory) so tool names + descriptions come
programmatically from ``copass-config``.

The three returned tools — ``discover``, ``interpret``, ``search`` —
are window-aware when a ``window`` is supplied: the server will
exclude items already surfaced earlier in the conversation. Keeps
repeated ``discover`` calls cheap and productive.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from copass_config import (
    DISCOVER_DESCRIPTION,
    DISCOVER_QUERY_PARAM,
    GET_ORIGIN_DESCRIPTION,
    INTERPRET_DESCRIPTION,
    INTERPRET_ITEMS_PARAM,
    INTERPRET_QUERY_PARAM,
    ORIGIN_CANONICAL_IDS_PARAM,
    ORIGIN_LIMIT_PARAM,
    SEARCH_DESCRIPTION,
    SEARCH_QUERY_PARAM,
)
from copass_core import CopassClient, SearchPreset
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from copass_langchain.types import ContextWindowLike


@dataclass(frozen=True)
class CopassTools:
    """Bundle of the four Copass retrieval tools as
    ``StructuredTool`` instances. Pass ``tools.discover``,
    ``tools.interpret``, ``tools.search``, ``tools.get_origin``
    (or ``tools.all()``) to the agent framework."""

    discover: StructuredTool
    interpret: StructuredTool
    search: StructuredTool
    get_origin: StructuredTool

    def all(self) -> List[StructuredTool]:
        return [self.discover, self.interpret, self.search, self.get_origin]


class _DiscoverArgs(BaseModel):
    query: str = Field(..., description=DISCOVER_QUERY_PARAM)


class _InterpretArgs(BaseModel):
    query: str = Field(..., description=INTERPRET_QUERY_PARAM)
    items: List[List[str]] = Field(
        ...,
        min_length=1,
        description=INTERPRET_ITEMS_PARAM,
    )


class _SearchArgs(BaseModel):
    query: str = Field(..., description=SEARCH_QUERY_PARAM)


class _GetOriginArgs(BaseModel):
    canonical_ids: List[str] = Field(
        ...,
        min_length=1,
        max_length=100,
        description=ORIGIN_CANONICAL_IDS_PARAM,
    )
    limit_per_canonical: Optional[int] = Field(
        default=None,
        ge=1,
        le=50,
        description=ORIGIN_LIMIT_PARAM,
    )


def copass_tools(
    *,
    client: CopassClient,
    sandbox_id: str,
    project_id: Optional[str] = None,
    window: Optional[ContextWindowLike] = None,
    preset: SearchPreset = "copass/copass_1.0",
) -> CopassTools:
    """Return a :class:`CopassTools` bundle wired to ``client``.

    Args:
        client: Authenticated :class:`CopassClient`.
        sandbox_id: Sandbox every retrieval call runs against.
        project_id: Optional project narrowing.
        window: Optional :class:`ContextWindowLike` — when provided,
            every retrieval call is window-aware.
        preset: Retrieval preset for ``discover`` / ``interpret`` /
            ``search``. Defaults to ``"copass/copass_1.0"``. Under
            ``"copass/copass_2.0"`` discover items carry ``subgraph``
            (pre-rendered ASCII tree) and ``matched_query_nodes``
            fields. Append ``":thinking"`` (e.g.
            ``"copass/copass_2.0:thinking"``) to enable task
            decomposition before retrieval on ``search``.

    Example::

        from copass_core import CopassClient, ApiKeyAuth
        from copass_langchain import copass_tools

        client = CopassClient(auth=ApiKeyAuth(key="olk_..."))
        tools = copass_tools(client=client, sandbox_id="sb_...")
        # Hand `tools.all()` to LangGraph's create_react_agent.
    """

    async def _discover(query: str) -> Dict[str, Any]:
        response = await client.retrieval.discover(
            sandbox_id=sandbox_id,
            query=query,
            project_id=project_id,
            window=window,
            preset=preset,
        )
        return {
            "header": response.get("header", ""),
            "items": [
                # Project the v2 fields (``subgraph`` + ``matched_query_nodes``)
                # alongside the v1 fields. Populated only under
                # ``copass/copass_2.0`` (or its ``copass/2.0`` alias);
                # ``None`` under v1.
                {
                    "score": item.get("score"),
                    "summary": item.get("summary"),
                    "canonical_ids": item.get("canonical_ids", []),
                    "subgraph": item.get("subgraph"),
                    "matched_query_nodes": item.get("matched_query_nodes"),
                }
                for item in response.get("items", [])
            ],
            "next_steps": response.get("next_steps", ""),
        }

    async def _interpret(query: str, items: List[List[str]]) -> Dict[str, Any]:
        response = await client.retrieval.interpret(
            sandbox_id=sandbox_id,
            query=query,
            items=items,
            project_id=project_id,
            window=window,
            preset=preset,
        )
        return {"brief": response.get("brief", "")}

    async def _search(query: str) -> Dict[str, Any]:
        response = await client.retrieval.search(
            sandbox_id=sandbox_id,
            query=query,
            project_id=project_id,
            window=window,
            preset=preset,
        )
        return {"answer": response.get("answer", "")}

    async def _get_origin(
        canonical_ids: List[str],
        limit_per_canonical: Optional[int] = None,
    ) -> Dict[str, Any]:
        response = await client.retrieval.get_origin(
            sandbox_id=sandbox_id,
            canonical_ids=canonical_ids,
            limit_per_canonical=limit_per_canonical,
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

    return CopassTools(
        discover=StructuredTool.from_function(
            coroutine=_discover,
            name="discover",
            description=DISCOVER_DESCRIPTION,
            args_schema=_DiscoverArgs,
        ),
        interpret=StructuredTool.from_function(
            coroutine=_interpret,
            name="interpret",
            description=INTERPRET_DESCRIPTION,
            args_schema=_InterpretArgs,
        ),
        search=StructuredTool.from_function(
            coroutine=_search,
            name="search",
            description=SEARCH_DESCRIPTION,
            args_schema=_SearchArgs,
        ),
        get_origin=StructuredTool.from_function(
            coroutine=_get_origin,
            name="get_origin",
            description=GET_ORIGIN_DESCRIPTION,
            args_schema=_GetOriginArgs,
        ),
    )


__all__ = ["CopassTools", "copass_tools"]
