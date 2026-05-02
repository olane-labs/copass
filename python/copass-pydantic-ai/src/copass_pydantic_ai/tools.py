"""Pydantic AI tool adapters for Copass retrieval.

``copass_tools(...)`` returns a tuple of three async callables — drop them
straight into ``Agent(tools=[...])``. Each function has a type-hinted
signature; its ``__doc__`` is set from the canonical descriptions in
``_strings`` (which mirrors the ``@copass/config`` TypeScript package), so
the schema + description Pydantic AI generates matches what every other
adapter in the copass surfaces.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from ._strings import (
    DISCOVER_DESCRIPTION,
    INTERPRET_DESCRIPTION,
    SEARCH_DESCRIPTION,
)
from .client import CopassRetrievalClient
from .types import SearchPreset, WindowLike


def copass_tools(
    *,
    client: CopassRetrievalClient,
    sandbox_id: str,
    project_id: Optional[str] = None,
    window: Optional[WindowLike] = None,
    preset: SearchPreset = "copass/1.0",
) -> tuple[Callable[..., Any], Callable[..., Any], Callable[..., Any]]:
    """Return Copass retrieval as three Pydantic AI-compatible tool callables.

    Args:
        client: A :class:`CopassRetrievalClient` for the target sandbox.
        sandbox_id: Sandbox all retrieval runs against.
        project_id: Optional project scoping.
        window: Optional :class:`WindowLike` (e.g. a Context Window handle).
            When provided, every retrieval call is window-aware.
        preset: Preset for ``interpret`` / ``search``. Defaults to
            ``"copass/1.0"``. Append ``":thinking"`` (e.g.
            ``"copass/2.0:thinking"``) to enable task decomposition
            before retrieval.

    Returns:
        ``(discover, interpret, search)`` — three async callables, ready to
        pass directly to ``pydantic_ai.Agent(tools=[...])``.

    Example::

        from pydantic_ai import Agent
        from copass_pydantic_ai import CopassRetrievalClient, copass_tools

        client = CopassRetrievalClient(api_url="...", api_key="olk_...")
        discover, interpret, search = copass_tools(
            client=client,
            sandbox_id="sandbox_abc",
        )

        agent = Agent("anthropic:claude-opus-4-7", tools=[discover, interpret, search])
        result = await agent.run("why is checkout flaky?")
    """

    async def discover(query: str) -> dict[str, Any]:
        response = await client.discover(
            sandbox_id, query=query, project_id=project_id, window=window
        )
        return {
            "header": response.get("header"),
            "items": [
                {
                    "score": item.get("score"),
                    "summary": item.get("summary"),
                    "canonical_ids": item.get("canonical_ids", []),
                }
                for item in response.get("items", [])
            ],
            "next_steps": response.get("next_steps"),
        }

    async def interpret(query: str, items: list[list[str]]) -> dict[str, Any]:
        response = await client.interpret(
            sandbox_id,
            query=query,
            items=items,
            project_id=project_id,
            window=window,
            preset=preset,
        )
        return {"brief": response.get("brief")}

    async def search(query: str) -> dict[str, Any]:
        response = await client.search(
            sandbox_id,
            query=query,
            project_id=project_id,
            window=window,
            preset=preset,
        )
        return {"answer": response.get("answer")}

    # Pydantic AI reads each tool's description from `fn.__doc__` at agent
    # construction. Setting it here (rather than inlining as source-level
    # docstrings) pins the LLM-facing copy to the shared `_strings` module
    # so the Python package can never drift from @copass/config.
    discover.__doc__ = DISCOVER_DESCRIPTION
    interpret.__doc__ = INTERPRET_DESCRIPTION
    search.__doc__ = SEARCH_DESCRIPTION

    return discover, interpret, search
