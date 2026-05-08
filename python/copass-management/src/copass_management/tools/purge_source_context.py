"""Purge ingested knowledge for a data source (``POST …/purge``)."""

from __future__ import annotations

from typing import Any, Dict, TYPE_CHECKING

if TYPE_CHECKING:
    from copass_management.registrar import ToolContext


async def purge_source_context(ctx: "ToolContext", input: Dict[str, Any]) -> Any:
    source_id = str(input["data_source_id"])
    delete = input.get("delete_source")
    if isinstance(delete, bool):
        return await ctx.client.sources.purge(
            ctx.sandbox_id, source_id, delete_source=delete,
        )
    return await ctx.client.sources.purge(ctx.sandbox_id, source_id)
