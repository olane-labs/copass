from __future__ import annotations

from typing import Any, Dict, TYPE_CHECKING

if TYPE_CHECKING:
    from copass_management.registrar import ToolContext


async def add_user_mcp_source(ctx: "ToolContext", input: Dict[str, Any]) -> Any:
    kwargs: Dict[str, Any] = {
        "name": str(input["name"]),
        "base_url": str(input["base_url"]),
        "auth_kind": str(input["auth_kind"]),
    }
    if input.get("token") is not None:
        kwargs["token"] = str(input["token"])
    if input.get("auth_header") is not None:
        kwargs["auth_header"] = str(input["auth_header"])
    if input.get("app_namespace") is not None:
        kwargs["app_namespace"] = str(input["app_namespace"])
    if isinstance(input.get("allowed_tools"), list):
        kwargs["allowed_tools"] = [str(x) for x in input["allowed_tools"]]
    if isinstance(input.get("ingest_tool_calls"), list):
        kwargs["ingest_tool_calls"] = list(input["ingest_tool_calls"])
    if input.get("rate_cap_per_minute") is not None:
        kwargs["rate_cap_per_minute"] = int(input["rate_cap_per_minute"])
    if input.get("webhook_rate_cap_per_minute") is not None:
        kwargs["webhook_rate_cap_per_minute"] = int(
            input["webhook_rate_cap_per_minute"]
        )
    return await ctx.client.sources.register_user_mcp(ctx.sandbox_id, **kwargs)
