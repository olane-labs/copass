"""Integrations resource — provider-neutral OAuth → DataSource flow.

Port of ``typescript/packages/core/src/resources/integrations.ts``.

Phase 1A scope (read-only): ``catalog``, ``list``, plus the new
``list_accounts`` method that targets the
``GET /sandboxes/{id}/sources/integrations/accounts`` route added in
Phase 1A. Write methods (``connect``, ``disconnect``, ``reconcile``)
are included for parity with the TS surface — they're thin wrappers
over existing endpoints. Spec-driven write tools land in Phase 2.

The backing tool-source provider is server-side config; the SDK sees
a single unified surface. OAuth tokens stay with the provider — Copass
never persists them.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from copass_core.resources.base import BaseResource


def _base(sandbox_id: str) -> str:
    return f"/api/v1/storage/sandboxes/{sandbox_id}/sources/integrations"


class IntegrationsResource(BaseResource):
    """``/api/v1/storage/sandboxes/{id}/sources/integrations``.

    Browse available apps via :meth:`catalog`, list active connections
    via :meth:`list`, list raw upstream OAuth grants via
    :meth:`list_accounts`, start an OAuth flow via :meth:`connect`,
    and reconcile / disconnect for safety-net operations.
    """

    async def catalog(
        self,
        sandbox_id: str,
        *,
        q: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List or search the app catalog for a sandbox.

        Every item has ``supported: true``. Use ``has_ingestion_defaults``
        to see which slugs ship curated firehose pull defaults after OAuth.
        """
        query: Dict[str, Any] = {}
        if q is not None:
            query["q"] = q
        if limit is not None:
            query["limit"] = str(limit)
        if cursor is not None:
            query["cursor"] = cursor
        return await self._get(
            f"{_base(sandbox_id)}/catalog",
            query=query or None,
        )

    async def list_accounts(
        self,
        sandbox_id: str,
        *,
        app_slug: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List the user's raw OAuth accounts upstream.

        Distinct from :meth:`list`: connections are local DataSource
        rows materialised by the connect webhook; accounts are the raw
        grants on the upstream provider. Backs the ``list_connected_accounts``
        management tool.
        """
        query: Dict[str, Any] = {}
        if app_slug is not None:
            query["app_slug"] = app_slug
        return await self._get(
            f"{_base(sandbox_id)}/accounts",
            query=query or None,
        )

    async def connect(
        self,
        sandbox_id: str,
        app: str,
        *,
        success_redirect_uri: str,
        error_redirect_uri: str,
        scope: Optional[str] = None,
        project_id: Optional[str] = None,
        webhook_uri: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Mint a provider Connect URL for the given app.

        The returned ``connect_url`` is a provider-hosted OAuth page.
        The provider calls Copass's webhook on completion, creating a
        DataSource asynchronously.

        ``webhook_uri`` is an optional override forwarded verbatim to
        the upstream provider; webhook-using providers honor it,
        providers that do not use webhooks ignore it. Defaults to a
        URL composed server-side from the deployment's public base
        URL.
        """
        body: Dict[str, Any] = {
            "success_redirect_uri": success_redirect_uri,
            "error_redirect_uri": error_redirect_uri,
        }
        if scope is not None:
            body["scope"] = scope
        if project_id is not None:
            body["project_id"] = project_id
        if webhook_uri is not None:
            body["webhook_uri"] = webhook_uri
        return await self._post(f"{_base(sandbox_id)}/{app}/connect", body)

    async def list(
        self,
        sandbox_id: str,
        *,
        app: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List active integration-sourced connections in the sandbox.

        Optionally filter by ``app`` slug.
        """
        query: Dict[str, Any] = {}
        if app is not None:
            query["app"] = app
        return await self._get(
            f"{_base(sandbox_id)}/connections",
            query=query or None,
        )

    async def disconnect(self, sandbox_id: str, source_id: str) -> None:
        """Revoke the provider account (best-effort) and archive the
        DataSource locally. Idempotent in both directions.
        """
        await self._delete(f"{_base(sandbox_id)}/connections/{source_id}")

    async def reconcile(
        self,
        sandbox_id: str,
        *,
        scope: Optional[str] = None,
        project_id: Optional[str] = None,
        app: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Idempotently backfill missing DataSources from the provider.

        Safety net for dropped webhook deliveries. Always returns the
        post-reconcile state.
        """
        body: Dict[str, Any] = {}
        if scope is not None:
            body["scope"] = scope
        if project_id is not None:
            body["project_id"] = project_id
        if app is not None:
            body["app"] = app
        return await self._post(f"{_base(sandbox_id)}/reconcile", body)


__all__ = ["IntegrationsResource"]
