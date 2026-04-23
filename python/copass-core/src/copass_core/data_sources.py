"""Data source primitives.

Port of ``typescript/packages/core/src/data-sources/base.ts``. Binds
a registered ``DataSource`` record to the code that actually pushes
bytes through it.

Subclasses implement provider-specific scan/watch/pull logic and call
:meth:`BaseDataSource.push` to route content through the source. The
base class handles lifecycle pass-throughs (pause / resume /
disconnect) so subclasses don't re-wire them.

:func:`ensure_data_source` is an idempotent registration helper: it
reuses an existing source by ``(provider, name)`` or registers a new
one.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, Optional

if TYPE_CHECKING:
    from copass_core.client import CopassClient


class BaseDataSource:
    """Base class for data source drivers.

    Subclasses override :meth:`start` / :meth:`stop` for long-lived
    watchers/pollers, and call :meth:`push` whenever they have
    content to ingest.
    """

    def __init__(
        self,
        *,
        client: "CopassClient",
        sandbox_id: str,
        data_source_id: str,
        project_id: Optional[str] = None,
    ) -> None:
        if not sandbox_id:
            raise ValueError("BaseDataSource: sandbox_id is required")
        if not data_source_id:
            raise ValueError("BaseDataSource: data_source_id is required")
        self._client = client
        self.sandbox_id = sandbox_id
        self.data_source_id = data_source_id
        self.project_id = project_id

    async def push(
        self,
        text: str,
        *,
        source_type: Optional[str] = None,
        storage_only: Optional[bool] = None,
        project_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Push bytes through this data source. Every ingestion in
        subclasses should route here so attribution stays coherent."""
        return await self._client.sources.ingest(
            self.sandbox_id,
            self.data_source_id,
            text=text,
            source_type=source_type,
            storage_only=storage_only,
            project_id=project_id if project_id is not None else self.project_id,
        )

    async def get_job(self, job_id: str) -> Dict[str, Any]:
        """Poll an ingestion job status in this sandbox."""
        return await self._client.ingest.get_sandbox_job(self.sandbox_id, job_id)

    async def describe(self) -> Dict[str, Any]:
        """Fetch the underlying ``DataSource`` record."""
        return await self._client.sources.retrieve(
            self.sandbox_id, self.data_source_id
        )

    async def pause(self) -> Dict[str, Any]:
        return await self._client.sources.pause(
            self.sandbox_id, self.data_source_id
        )

    async def resume(self) -> Dict[str, Any]:
        return await self._client.sources.resume(
            self.sandbox_id, self.data_source_id
        )

    async def disconnect(self) -> Dict[str, Any]:
        return await self._client.sources.disconnect(
            self.sandbox_id, self.data_source_id
        )

    async def start(self) -> None:
        """Start the driver. Default no-op; subclasses that run
        continuously should override."""
        return None

    async def stop(self) -> None:
        """Stop the driver. Default no-op; subclasses that hold
        resources should override."""
        return None


async def ensure_data_source(
    client: "CopassClient",
    sandbox_id: str,
    *,
    provider: str,
    name: str,
    reuse_existing: bool = True,
    ingestion_mode: Optional[str] = None,
    kind: Optional[str] = None,
    external_account_id: Optional[str] = None,
    adapter_config: Optional[Dict[str, Any]] = None,
    poll_interval_seconds: Optional[int] = None,
) -> Dict[str, Any]:
    """Idempotent registration: return an existing source matching
    ``(provider, name)`` in the sandbox or register a new one.

    Useful in subclass factories so callers can instantiate a driver
    without manually registering a source up-front.
    """
    if reuse_existing:
        existing = await client.sources.list(sandbox_id, provider=provider)
        for source in existing.get("sources", []) if isinstance(existing, dict) else []:
            if source.get("name") == name:
                return source
    return await client.sources.register(
        sandbox_id,
        provider=provider,
        name=name,
        ingestion_mode=ingestion_mode,
        kind=kind,
        external_account_id=external_account_id,
        adapter_config=adapter_config,
        poll_interval_seconds=poll_interval_seconds,
    )


__all__ = ["BaseDataSource", "ensure_data_source"]
