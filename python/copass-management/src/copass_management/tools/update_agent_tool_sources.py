from __future__ import annotations

from typing import Any, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from copass_management.registrar import ToolContext


async def update_agent_tool_sources(
    ctx: "ToolContext", input: Dict[str, Any],
) -> Any:
    slug = str(input["slug"])
    raw = input.get("tool_sources")
    tool_sources: Optional[List[str]]
    if raw is None:
        tool_sources = None
    elif isinstance(raw, list):
        tool_sources = [str(x) for x in raw]
    else:
        tool_sources = None
    agent = await ctx.client.agents.update_tool_sources(
        ctx.sandbox_id, slug, tool_sources,
    )
    return {"agent": agent}
