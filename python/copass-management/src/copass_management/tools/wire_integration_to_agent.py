from __future__ import annotations

from typing import Any, Dict, TYPE_CHECKING

if TYPE_CHECKING:
    from copass_management.registrar import ToolContext


async def wire_integration_to_agent(
    ctx: "ToolContext", input: Dict[str, Any],
) -> Any:
    agent_slug = str(input["agent_slug"])
    app_slug = str(input["app_slug"])
    return await ctx.client.agents.wire_integration(
        ctx.sandbox_id, agent_slug, app_slug,
    )
