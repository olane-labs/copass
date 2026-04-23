"""Base resource — shared :class:`HttpClient` reference + typed HTTP
convenience methods.

Mirrors ``typescript/packages/core/src/resources/base.ts``.
"""

from __future__ import annotations

from typing import Any, Optional

from copass_core.http.http_client import HttpClient, RequestOptions


class BaseResource:
    """Base class for all API resource modules.

    Concrete resources (retrieval, context, future sandboxes/etc.)
    subclass this and call the protected helpers (:meth:`_post`,
    :meth:`_get`, :meth:`_patch`, :meth:`_delete`) rather than going
    through :class:`HttpClient` directly. Keeps every resource's
    surface narrow and consistent.
    """

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    async def _post(
        self,
        path: str,
        body: Any = None,
        *,
        query: Optional[dict] = None,
        headers: Optional[dict] = None,
    ) -> Any:
        return await self._http.request(
            path,
            RequestOptions(method="POST", body=body, query=query, headers=headers),
        )

    async def _get(
        self,
        path: str,
        *,
        query: Optional[dict] = None,
        headers: Optional[dict] = None,
    ) -> Any:
        return await self._http.request(
            path,
            RequestOptions(method="GET", query=query, headers=headers),
        )

    async def _patch(
        self,
        path: str,
        body: Any = None,
        *,
        query: Optional[dict] = None,
        headers: Optional[dict] = None,
    ) -> Any:
        return await self._http.request(
            path,
            RequestOptions(method="PATCH", body=body, query=query, headers=headers),
        )

    async def _delete(
        self,
        path: str,
        *,
        query: Optional[dict] = None,
        headers: Optional[dict] = None,
    ) -> Any:
        return await self._http.request(
            path,
            RequestOptions(method="DELETE", query=query, headers=headers),
        )


__all__ = ["BaseResource"]
