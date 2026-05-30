"""Minimal async retrieval client for the Copass REST API.

Covers only the three retrieval endpoints (``discover``, ``interpret``,
``search``) — enough to power the Pydantic AI tool adapters without
requiring a full Python port of the TypeScript ``@copass/core`` SDK.
"""

from __future__ import annotations

from typing import Any, Optional

import httpx

from .types import SearchPreset, WindowLike


def _turns_from(window: Optional[WindowLike]) -> list[dict[str, str]]:
    """Extract turns from a window-like object, or empty list if absent."""
    if window is None:
        return []
    turns = window.get_turns()
    return list(turns) if turns else []


class CopassRetrievalClient:
    """Minimal async client for Copass retrieval.

    Example::

        client = CopassRetrievalClient(
            api_url="https://ai.copass.id",
            api_key="olk_...",
        )
        menu = await client.discover("sandbox_id", query="why is checkout flaky?")

    The ``api_key`` accepts both long-lived API keys (``olk_`` prefix) and
    raw bearer tokens — both are sent as ``Authorization: Bearer <token>``.
    """

    def __init__(
        self,
        *,
        api_url: str = "https://ai.copass.id",
        api_key: str,
        timeout: float = 30.0,
    ) -> None:
        self._api_url = api_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    async def discover(
        self,
        sandbox_id: str,
        *,
        query: str,
        project_id: Optional[str] = None,
        window: Optional[WindowLike] = None,
        preset: Optional[SearchPreset] = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"query": query, "history": _turns_from(window)}
        if project_id:
            body["project_id"] = project_id
        if preset is not None:
            body["preset"] = preset
        return await self._post(f"/api/v1/query/sandboxes/{sandbox_id}/discover", body)

    async def interpret(
        self,
        sandbox_id: str,
        *,
        query: str,
        items: list[list[str]],
        project_id: Optional[str] = None,
        window: Optional[WindowLike] = None,
        preset: SearchPreset = "copass/copass_1.0",
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "query": query,
            "items": items,
            "history": _turns_from(window),
            "preset": preset,
        }
        if project_id:
            body["project_id"] = project_id
        return await self._post(f"/api/v1/query/sandboxes/{sandbox_id}/interpret", body)

    async def search(
        self,
        sandbox_id: str,
        *,
        query: str,
        project_id: Optional[str] = None,
        window: Optional[WindowLike] = None,
        preset: SearchPreset = "copass/copass_1.0",
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "query": query,
            "history": _turns_from(window),
            "preset": preset,
        }
        if project_id:
            body["project_id"] = project_id
        return await self._post(f"/api/v1/query/sandboxes/{sandbox_id}/search", body)

    async def get_origin(
        self,
        sandbox_id: str,
        *,
        canonical_ids: list[str],
        limit_per_canonical: Optional[int] = None,
    ) -> dict[str, Any]:
        """POST ``/api/v1/query/sandboxes/{sandbox_id}/origins``.

        Returns the source files each canonical was extracted from.
        ``canonical_ids`` must be at least 1 element and at most 100;
        ``limit_per_canonical`` (1-50) caps the files per canonical.
        """
        body: dict[str, Any] = {"canonical_ids": canonical_ids}
        if limit_per_canonical is not None:
            body["limit_per_canonical"] = limit_per_canonical
        return await self._post(
            f"/api/v1/query/sandboxes/{sandbox_id}/origins", body,
        )

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self._timeout) as http:
            response = await http.post(
                f"{self._api_url}{path}",
                headers=self._headers(),
                json=body,
            )
            response.raise_for_status()
            return response.json()
