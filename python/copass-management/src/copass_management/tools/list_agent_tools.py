from __future__ import annotations

from typing import Any, Dict, List, TYPE_CHECKING

if TYPE_CHECKING:
    from copass_management.registrar import ToolContext


async def list_agent_tools(ctx: "ToolContext", input: Dict[str, Any]) -> Any:
    """Surface the agent tool catalog grouped by ``app_slug``.

    Backend returns the flat ``{tools, count}`` shape; we add the
    ``by_app`` map the spec promises (``{app_slug: [Tool, ...]}``) so
    callers can render per-provider sections without re-grouping
    client-side. Optional ``app_slug`` input filters the flat list AND
    the ``by_app`` map to a single provider.
    """
    filter_slug = input.get("app_slug") if isinstance(input.get("app_slug"), str) else None

    catalog = await ctx.client.agents.list_tools(ctx.sandbox_id)
    raw_tools: List[Dict[str, Any]] = list(catalog.get("tools", []) if isinstance(catalog, dict) else [])
    if filter_slug:
        raw_tools = [t for t in raw_tools if t.get("app_slug") == filter_slug]

    by_app: Dict[str, List[Dict[str, Any]]] = {}
    for tool in raw_tools:
        slug = tool.get("app_slug") or "unknown"
        by_app.setdefault(slug, []).append(
            {"name": tool.get("name"), "description": tool.get("description")}
        )

    return {"tools": raw_tools, "by_app": by_app, "count": len(raw_tools)}
