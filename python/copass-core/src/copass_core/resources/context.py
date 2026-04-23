"""Context-for-agent resource — ``/api/v1/context/for-agent/*``.

Thin Python wrapper over the server-side tiered context endpoints
(``minimal`` / ``adaptive`` / ``comprehensive``). Shipped in v0.1.0
because SDK consumers (notably ``copass-anthropic-agents`` context
injection) need it.

The full server-side response shape is heterogeneous across tiers;
we return the decoded JSON dict directly rather than forcing a typed
response model. Callers pick the fields they care about.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from copass_core.resources.base import BaseResource


ContextTier = Literal["minimal", "adaptive", "comprehensive"]


class ContextResource(BaseResource):
    """``/api/v1/context/for-agent/{tier}``.

    Three tiers, ordered by breadth vs. cost:

    - ``"minimal"`` — tight context blob, fastest.
    - ``"adaptive"`` — lets the server pick tier based on a budget.
    - ``"comprehensive"`` — maximum breadth, heaviest.
    """

    async def for_agent(
        self,
        *,
        sandbox_id: str,
        tier: ContextTier = "adaptive",
        project_id: Optional[str] = None,
        query: Optional[str] = None,
        history: Optional[List[Dict[str, str]]] = None,
        max_tokens: Optional[int] = None,
        extra: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """POST to the configured tier endpoint. Returns the decoded
        JSON body.

        Args:
            sandbox_id: Sandbox to retrieve context from.
            tier: Which ``for-agent`` variant to hit.
            project_id: Narrow to a single project within the sandbox.
            query: Natural-language query to shape context around.
                Optional — some tiers retrieve window-based context
                without one.
            history: Recent chat turns to feed the window-aware
                retriever.
            max_tokens: Hint for the server's context-size budget.
            extra: Any additional body fields — escape hatch for
                server-side flags not yet exposed via typed kwargs.
        """
        body: Dict[str, Any] = {"sandbox_id": sandbox_id}
        if project_id is not None:
            body["project_id"] = project_id
        if query is not None:
            body["query"] = query
        if history is not None:
            body["history"] = history
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if extra:
            body.update(extra)
        return await self._post(f"/api/v1/context/for-agent/{tier}", body)


__all__ = ["ContextResource", "ContextTier"]
