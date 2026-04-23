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
    INTERPRET_DESCRIPTION,
    INTERPRET_ITEMS_PARAM,
    INTERPRET_QUERY_PARAM,
    SEARCH_DESCRIPTION,
    SEARCH_QUERY_PARAM,
)
from copass_core import CopassClient, SearchPreset
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from copass_langchain.types import ContextWindowLike


@dataclass(frozen=True)
class CopassTools:
    """Bundle of the three Copass retrieval tools as
    ``StructuredTool`` instances. Pass ``tools.discover``,
    ``tools.interpret``, ``tools.search`` (or ``tools.all()``) to the
    agent framework."""

    discover: StructuredTool
    interpret: StructuredTool
    search: StructuredTool

    def all(self) -> List[StructuredTool]:
        return [self.discover, self.interpret, self.search]


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


def copass_tools(
    *,
    client: CopassClient,
    sandbox_id: str,
    project_id: Optional[str] = None,
    window: Optional[ContextWindowLike] = None,
    preset: SearchPreset = "auto",
) -> CopassTools:
    """Return a :class:`CopassTools` bundle wired to ``client``.

    Args:
        client: Authenticated :class:`CopassClient`.
        sandbox_id: Sandbox every retrieval call runs against.
        project_id: Optional project narrowing.
        window: Optional :class:`ContextWindowLike` — when provided,
            every retrieval call is window-aware.
        preset: Retrieval preset for ``interpret`` / ``search``.
            Ignored by ``discover``. Defaults to ``"auto"`` —
            ``interpret`` requires ``auto`` in the current server
            release (``fast`` silently returns
            "No supporting context could be retrieved").

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
        )
        return {
            "header": response.get("header", ""),
            "items": [
                {
                    "score": item.get("score"),
                    "summary": item.get("summary"),
                    "canonical_ids": item.get("canonical_ids", []),
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
    )


__all__ = ["CopassTools", "copass_tools"]
