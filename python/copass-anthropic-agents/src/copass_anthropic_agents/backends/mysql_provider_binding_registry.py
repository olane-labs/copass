"""MysqlProviderBindingRegistry — CAS UPDATE backed by ``copass_agents.provider_bindings``.

The production registry for our deployment. Backs
:class:`ProviderBindingRegistry` with a JSON column on the existing
``copass_agents`` table (added by PR-A's migration). Race safety is
delivered by the CAS UPDATE pattern from ADR 0001 §3:

```sql
UPDATE copass_agents
SET provider_bindings = JSON_SET(
      COALESCE(provider_bindings, JSON_OBJECT()),
      '$.<provider>',
      JSON_OBJECT(
          'agent_id', :agent_id,
          'environment_id', :environment_id,
          'for_version', :for_version,
          'provisioned_at', :provisioned_at))
WHERE user_id = :user_id AND agent_id = :agent_id
  AND (JSON_EXTRACT(provider_bindings, '$.<provider>.for_version') IS NULL
       OR JSON_EXTRACT(provider_bindings, '$.<provider>.for_version') < :for_version);
```

``rows_affected == 0`` means another process won the race — re-SELECT
and return the winner's binding. The local Anthropic
``agents.create`` becomes a one-time orphan; that is acceptable and
bounded (one per process per fingerprint revision, not per request).

The MySQL driver (``aiomysql`` / ``asyncmy`` / whichever the repo
standardizes on) is imported lazily so library adopters who don't
install it never crash at module load. The exact pool / connection
API is left opaque — the v2 runtime injects whatever pool backs the
rest of ``copass_agents`` access.

Phase 1 CI does NOT exercise this class: the integration test that
covers it is gated behind ``COPASS_INTEGRATION=1`` and a staging DB
URL. The class ships as code regardless of PR-A's deploy state so
the Phase 2 runtime brief has it ready when the schema lands.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Optional

from copass_anthropic_agents.backends.provider_binding_registry import (
    ProviderBinding,
    ProviderBindingRegistry,
)

if TYPE_CHECKING:
    # MySQL driver imports stay type-only at module scope. The actual
    # driver call sites import lazily inside method bodies.
    pass

logger = logging.getLogger(__name__)


def _now_iso_utc() -> str:
    """Return current time as an ISO-8601 UTC string with second
    precision.

    Matches the JSON column's storage shape per ADR 0001 §3.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_binding(
    raw: Any, provider: str, requested_for_version: int
) -> Optional[ProviderBinding]:
    """Parse the JSON column value into a :class:`ProviderBinding`.

    Returns ``None`` if no binding for ``provider`` exists OR if the
    stored binding's ``for_version`` is older than the requested
    version (a cache miss on version bump).
    """
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            logger.error(
                "MysqlProviderBindingRegistry: provider_bindings column "
                "is not valid JSON",
                extra={"provider": provider},
            )
            return None
    if not isinstance(raw, dict):
        return None
    entry = raw.get(provider)
    if not isinstance(entry, dict):
        return None
    try:
        stored = ProviderBinding(
            agent_id=str(entry["agent_id"]),
            environment_id=str(entry["environment_id"]),
            for_version=int(entry["for_version"]),
            provisioned_at=str(entry["provisioned_at"]),
        )
    except (KeyError, ValueError, TypeError):
        logger.error(
            "MysqlProviderBindingRegistry: malformed provider_bindings entry",
            extra={"provider": provider, "entry": entry},
        )
        return None
    if stored.for_version < requested_for_version:
        return None
    return stored


class MysqlProviderBindingRegistry(ProviderBindingRegistry):
    """:class:`ProviderBindingRegistry` backed by ``copass_agents.provider_bindings``.

    Args:
        pool: An async MySQL connection pool. Expected to expose an
            ``acquire()`` async context manager that yields a connection
            with an ``async cursor()`` API. The exact pool type is
            opaque so the runtime can inject any driver consistent
            with the rest of the Copass MySQL access layer.
        table: Table name. Defaults to ``"copass_agents"``. Overridable
            for testing / alternative schemas.
    """

    def __init__(self, pool: Any, *, table: str = "copass_agents") -> None:
        self._pool = pool
        self._table = table

    async def get_binding(
        self,
        *,
        user_id: str,
        agent_id: str,
        provider: str,
        for_version: int,
    ) -> Optional[ProviderBinding]:
        # SELECT the JSON column for this (user_id, agent_id) row.
        # The provider key is parsed client-side rather than via
        # ``JSON_EXTRACT`` so the read shape matches the in-memory
        # registry's read shape and tests can swap implementations.
        sql = (
            f"SELECT provider_bindings FROM {self._table} "
            "WHERE user_id = %s AND agent_id = %s LIMIT 1"
        )
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (user_id, agent_id))
                row = await cur.fetchone()
        if row is None:
            return None
        raw = row[0] if isinstance(row, (list, tuple)) else row
        return _parse_binding(raw, provider, for_version)

    async def get_or_provision(
        self,
        *,
        user_id: str,
        agent_id: str,
        provider: str,
        for_version: int,
        provision: Callable[[], Awaitable[ProviderBinding]],
    ) -> ProviderBinding:
        # Read first — a binding for the right version short-circuits
        # the provisioning call entirely.
        existing = await self.get_binding(
            user_id=user_id,
            agent_id=agent_id,
            provider=provider,
            for_version=for_version,
        )
        if existing is not None:
            return existing

        # Miss → provision. The provision call is the expensive one
        # (Anthropic ``agents.create`` + ``environments.create``); we
        # accept the orphan if we lose the CAS race.
        new_binding = await provision()

        update_sql = (
            f"UPDATE {self._table} "
            "SET provider_bindings = JSON_SET("
            "    COALESCE(provider_bindings, JSON_OBJECT()), "
            "    %s, "
            "    JSON_OBJECT("
            "        'agent_id', %s, "
            "        'environment_id', %s, "
            "        'for_version', %s, "
            "        'provisioned_at', %s)) "
            "WHERE user_id = %s AND agent_id = %s "
            "  AND (JSON_EXTRACT(provider_bindings, %s) IS NULL "
            "       OR JSON_EXTRACT(provider_bindings, %s) < %s)"
        )
        provider_path = f"$.{provider}"
        for_version_path = f"$.{provider}.for_version"
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    update_sql,
                    (
                        provider_path,
                        new_binding.agent_id,
                        new_binding.environment_id,
                        new_binding.for_version,
                        new_binding.provisioned_at,
                        user_id,
                        agent_id,
                        for_version_path,
                        for_version_path,
                        for_version,
                    ),
                )
                rows_affected = cur.rowcount

        if rows_affected == 0:
            # Another process won the CAS race. Re-read and return the
            # winner's binding. Our just-provisioned Anthropic agent
            # becomes a one-time orphan — bounded cost per fingerprint
            # revision per pod.
            winner = await self.get_binding(
                user_id=user_id,
                agent_id=agent_id,
                provider=provider,
                for_version=for_version,
            )
            if winner is None:
                # Race conditions on the database side or a missing row.
                # Surface as an error — the caller cannot proceed.
                raise RuntimeError(
                    "MysqlProviderBindingRegistry: CAS UPDATE affected zero "
                    "rows but re-SELECT returned no binding. Either the "
                    f"(user_id={user_id!r}, agent_id={agent_id!r}) row was "
                    "deleted concurrently, or the provider_bindings JSON is "
                    "corrupt."
                )
            logger.info(
                "MysqlProviderBindingRegistry: lost CAS race; reusing winner's binding",
                extra={
                    "user_id": user_id,
                    "agent_id": agent_id,
                    "provider": provider,
                    "for_version": for_version,
                    "winning_provider_agent_id": winner.agent_id,
                    "orphan_provider_agent_id": new_binding.agent_id,
                },
            )
            return winner

        logger.info(
            "MysqlProviderBindingRegistry: provisioned binding",
            extra={
                "user_id": user_id,
                "agent_id": agent_id,
                "provider": provider,
                "for_version": for_version,
                "provider_agent_id": new_binding.agent_id,
            },
        )
        return new_binding


__all__ = ["MysqlProviderBindingRegistry", "_now_iso_utc", "_parse_binding"]
