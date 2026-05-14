"""InMemoryProviderBindingRegistry — dict + asyncio.Lock implementation.

The default for library adopters without the Copass MySQL schema.
Same interface as :class:`MysqlProviderBindingRegistry` (the registry
protocol is defined in :mod:`.provider_binding_registry`); same CAS
semantics emulated in-process.

This is also the implementation Phase 1 tests run against — the MySQL
variant is gated behind ``COPASS_INTEGRATION=1`` and is not exercised
by CI in Phase 1.

Key shape: ``(user_id, agent_id, provider)``. A lock per key prevents
the cache-miss check-then-set race within a single process; for
cross-process safety the MySQL variant uses a CAS UPDATE.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, Dict, Optional, Tuple

from copass_anthropic_agents.backends.provider_binding_registry import (
    ProviderBinding,
    ProviderBindingRegistry,
)

logger = logging.getLogger(__name__)


_LockKey = Tuple[str, str, str]  # (user_id, agent_id, provider)


class InMemoryProviderBindingRegistry(ProviderBindingRegistry):
    """Dict-backed :class:`ProviderBindingRegistry` for in-process use.

    Phase 1 tests rely on this implementation; library adopters who
    don't run against the Copass MySQL schema use it in production
    too. Across-process race safety requires the MySQL variant.
    """

    def __init__(self) -> None:
        # Stored bindings by ``(user_id, agent_id, provider)``.
        self._bindings: Dict[_LockKey, ProviderBinding] = {}
        # Per-key lock so two coroutines provisioning the same key
        # serialize on the check-then-set.
        self._locks: Dict[_LockKey, asyncio.Lock] = {}
        # Guards mutation of ``self._locks`` itself; locks-of-locks
        # are necessary because constructing the per-key lock has to
        # be race-safe.
        self._locks_guard = asyncio.Lock()

    def _key(self, user_id: str, agent_id: str, provider: str) -> _LockKey:
        return (user_id, agent_id, provider)

    async def _get_lock(self, key: _LockKey) -> asyncio.Lock:
        """Return (creating if necessary) the per-key lock.

        Construction is itself race-safe: two callers racing to create
        the same lock would otherwise get distinct locks and the
        whole point of locking would be defeated.
        """
        lock = self._locks.get(key)
        if lock is not None:
            return lock
        async with self._locks_guard:
            lock = self._locks.get(key)
            if lock is None:
                lock = asyncio.Lock()
                self._locks[key] = lock
            return lock

    async def get_binding(
        self,
        *,
        user_id: str,
        agent_id: str,
        provider: str,
        for_version: int,
    ) -> Optional[ProviderBinding]:
        key = self._key(user_id, agent_id, provider)
        stored = self._bindings.get(key)
        if stored is None:
            return None
        if stored.for_version < for_version:
            # Stale — treat as miss so the caller re-provisions.
            # MySQL variant's CAS WHERE clause encodes the same rule.
            return None
        return stored

    async def get_or_provision(
        self,
        *,
        user_id: str,
        agent_id: str,
        provider: str,
        for_version: int,
        provision: Callable[[], Awaitable[ProviderBinding]],
    ) -> ProviderBinding:
        key = self._key(user_id, agent_id, provider)
        lock = await self._get_lock(key)

        async with lock:
            # Re-read under the lock. Mirrors the MySQL CAS pattern:
            # the loser of the race re-reads and returns the winner's
            # binding.
            stored = self._bindings.get(key)
            if stored is not None and stored.for_version >= for_version:
                return stored

            # Cache miss (or stale on version bump) — provision.
            new_binding = await provision()
            self._bindings[key] = new_binding
            logger.info(
                "InMemoryProviderBindingRegistry: provisioned binding",
                extra={
                    "user_id": user_id,
                    "agent_id": agent_id,
                    "provider": provider,
                    "for_version": for_version,
                    "provider_agent_id": new_binding.agent_id,
                },
            )
            return new_binding


__all__ = ["InMemoryProviderBindingRegistry"]
