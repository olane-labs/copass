from __future__ import annotations

from typing import Any, Dict, TYPE_CHECKING

if TYPE_CHECKING:
    from copass_management.registrar import ToolContext


async def list_sandbox_connections(ctx: "ToolContext", input: Dict[str, Any]) -> Any:
    """Wrap the bare-array SDK response in the ``{connections, count}``
    envelope the spec requires. MCP's ``structuredContent`` rejects
    bare arrays — every list-style tool must return an object.
    """
    connections = await ctx.client.sandbox_connections.list(
        ctx.sandbox_id,
        include_revoked=bool(input.get("include_revoked")),
    )
    rows = list(connections) if not isinstance(connections, list) else connections
    return {"connections": rows, "count": len(rows)}
