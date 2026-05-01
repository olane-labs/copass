from __future__ import annotations

from typing import Any, Dict, TYPE_CHECKING

if TYPE_CHECKING:
    from copass_management.registrar import ToolContext


async def create_agent(ctx: "ToolContext", input: Dict[str, Any]) -> Any:
    backend = str(input.get("backend") or "anthropic")
    default_model = (
        "claude-sonnet-4-6" if backend == "anthropic" else "gemini-2.5-flash"
    )
    model_settings: Dict[str, Any] = {
        "backend": backend,
        "model": str(input.get("model") or default_model),
    }
    if "temperature" in input:
        model_settings["temperature"] = float(input["temperature"])
    if "max_tokens" in input:
        model_settings["max_tokens"] = int(input["max_tokens"])
    if "max_turns" in input:
        model_settings["max_turns"] = int(input["max_turns"])
    if "timeout_s" in input:
        model_settings["timeout_s"] = int(input["timeout_s"])

    kwargs: Dict[str, Any] = {
        "slug": str(input["slug"]),
        "name": str(input["name"]),
        "system_prompt": str(input["system_prompt"]),
        "tool_allowlist": list(input.get("tool_allowlist") or []),
        "model_settings": model_settings,
    }
    if "description" in input and input["description"] is not None:
        kwargs["description"] = str(input["description"])

    agent = await ctx.client.agents.create(ctx.sandbox_id, **kwargs)
    return {"agent": agent}
