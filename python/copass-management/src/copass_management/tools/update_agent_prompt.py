from __future__ import annotations

from typing import Any, Dict, TYPE_CHECKING

if TYPE_CHECKING:
    from copass_management.registrar import ToolContext


async def update_agent_prompt(ctx: "ToolContext", input: Dict[str, Any]) -> Any:
    slug = str(input["slug"])
    agent = await ctx.client.agents.update(
        ctx.sandbox_id,
        slug,
        system_prompt=str(input["system_prompt"]),
    )
    return {"agent": agent}
