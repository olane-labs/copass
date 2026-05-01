from __future__ import annotations

from typing import Any, Dict, TYPE_CHECKING

if TYPE_CHECKING:
    from copass_management.registrar import ToolContext


async def update_agent_tools(ctx: "ToolContext", input: Dict[str, Any]) -> Any:
    slug = str(input["slug"])
    tool_allowlist = [str(x) for x in (input.get("tool_allowlist") or [])]
    agent = await ctx.client.agents.update(
        ctx.sandbox_id,
        slug,
        tool_allowlist=tool_allowlist,
    )
    return {"agent": agent}
