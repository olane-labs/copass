"""ProviderBindingRegistry — race-safe identity store for provider-side
agent / environment ids.

The v1 backend kept Anthropic ``agent_id`` and ``environment_id`` in
unlocked in-process dicts. Across N pods on a deploy with empty caches,
concurrent calls raced the check-then-set on cache miss → N duplicate
``agents.create`` calls per fingerprint revision. Each is a billable
provisioning op (ADR 0001 §1.2 — cost-surprise vector flagged in
CLAUDE.md).

ADR 0001 Decision 3 collapses this to one ``agents.create`` per
fingerprint revision across the entire fleet by moving the mapping
into persistent storage with a race-safe write pattern. Two
implementations ship:

- :class:`MysqlProviderBindingRegistry` — hits a JSON column on the
  existing ``copass_agents`` table with a compare-and-swap UPDATE.
  Used in our deployment.
- :class:`InMemoryProviderBindingRegistry` — dict-backed, default for
  library adopters who don't have the Copass MySQL schema. Same
  interface; same CAS semantics emulated via :class:`asyncio.Lock`
  per ``(user_id, agent_id, provider)`` key.

The v2 backend never imports a DB driver: the runtime injects whichever
implementation matches the deployment.

When the abstractions lift to ``copass-core-agents`` (Decision 4's
lift trigger), this protocol goes with them.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Optional, Protocol


@dataclass(frozen=True)
class ProviderBinding:
    """Persistent record of a provider-side agent/environment provisioning.

    Attributes:
        agent_id: Provider-side agent identifier (``agent_01...`` for
            Anthropic).
        environment_id: Provider-side environment identifier
            (``env_01...`` for Anthropic).
        for_version: The ``copass_agents.version`` this binding was
            provisioned against. When the source version bumps the
            binding is treated as stale and re-provisioned (Test #4
            in ADR §7).
        provisioned_at: ISO-8601 UTC string. String, not
            :class:`datetime`, so the value serializes / deserializes
            through JSON without TZ-handling code at the boundary.
    """

    agent_id: str
    environment_id: str
    for_version: int
    provisioned_at: str  # ISO-8601 UTC


class ProviderBindingRegistry(Protocol):
    """Race-safe identity store for provider-side agent/environment ids.

    Implementations: :class:`MysqlProviderBindingRegistry` (CAS UPDATE
    against ``copass_agents.provider_bindings``) and
    :class:`InMemoryProviderBindingRegistry` (dict + :class:`asyncio.Lock`).
    Library adopters who don't have the Copass MySQL schema use the
    in-memory variant — the v2 backend doesn't care which.

    All methods are async because both implementations are async at
    the I/O boundary (asyncio lock for the in-memory variant; aiomysql
    pool for the MySQL variant).
    """

    async def get_binding(
        self,
        *,
        user_id: str,
        agent_id: str,
        provider: str,
        for_version: int,
    ) -> Optional[ProviderBinding]:
        """Read the binding for the key, if present and current.

        Returns ``None`` if no binding exists OR if the stored binding's
        ``for_version`` is older than the requested ``for_version`` (a
        cache miss on version bump).
        """
        ...

    async def get_or_provision(
        self,
        *,
        user_id: str,
        agent_id: str,
        provider: str,
        for_version: int,
        provision: Callable[[], Awaitable[ProviderBinding]],
    ) -> ProviderBinding:
        """Atomic read-or-provision.

        Returns the existing binding for the version, or invokes
        ``provision()`` EXACTLY ONCE across racing callers and persists
        the result. The loser of the race re-reads under the lock and
        returns the winner's binding.

        The once-only contract is the registry's responsibility — the
        v2 backend assumes that calling ``get_or_provision`` from N
        coroutines (or N processes, against the MySQL variant)
        produces a single Anthropic ``agents.create``.
        """
        ...


__all__ = ["ProviderBinding", "ProviderBindingRegistry"]
