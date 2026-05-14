"""MySQL provider-binding registry integration test (gated).

ADR 0001 §7 net-new test **#3 (MySQL mirror)** — cross-process
duplicate-create resistance against the CAS UPDATE pattern. Gated
behind ``COPASS_INTEGRATION=1`` + ``COPASS_STAGING_MYSQL_URL`` so
Phase 1 CI does NOT run this. The runtime team (Phase 2) flips the
gates on staging-canary runs.

The test inserts a synthetic ``copass_agents`` row keyed on a UUID
prefixed with ``test-integration-`` and removes it in ``finally``.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest

from copass_anthropic_agents.backends.mysql_provider_binding_registry import (
    MysqlProviderBindingRegistry,
)
from copass_anthropic_agents.backends.provider_binding_registry import (
    ProviderBinding,
)


pytestmark = pytest.mark.skipif(
    os.getenv("COPASS_INTEGRATION") != "1"
    or not os.getenv("COPASS_STAGING_MYSQL_URL"),
    reason=(
        "Integration test; requires COPASS_INTEGRATION=1 and "
        "COPASS_STAGING_MYSQL_URL"
    ),
)


def _binding(agent_id: str, for_version: int = 1) -> ProviderBinding:
    return ProviderBinding(
        agent_id=agent_id,
        environment_id=f"env_{agent_id}",
        for_version=for_version,
        provisioned_at="2026-05-14T13:50:00Z",
    )


async def _connect_pool():
    """Build an async MySQL pool from ``COPASS_STAGING_MYSQL_URL``.

    Driver choice is intentionally lazy here — the runtime team picks
    whichever driver is consistent with the rest of
    ``o-twin-data-pipeline``'s MySQL access (per brief §5 Additional
    Risk B). This helper imports lazily so the unskipped test
    environment doesn't need the driver installed.
    """
    import aiomysql  # type: ignore[import-not-found]
    from urllib.parse import urlparse

    url = urlparse(os.environ["COPASS_STAGING_MYSQL_URL"])
    pool = await aiomysql.create_pool(
        host=url.hostname,
        port=url.port or 3306,
        user=url.username,
        password=url.password,
        db=url.path.lstrip("/"),
        autocommit=True,
    )
    return pool


@pytest.mark.asyncio
async def test_cas_update_resolves_race_between_two_clients() -> None:
    """Two concurrent ``get_or_provision`` calls against the MySQL
    registry produce exactly one CAS-winning row update; both callers
    return the same binding.

    Uses a synthetic ``copass_agents`` row that the test inserts up
    front and cleans up in ``finally``. The row's ``user_id`` /
    ``agent_id`` are UUIDs prefixed with ``test-integration-`` so
    operators can spot stray rows from failed runs.
    """
    pool = await _connect_pool()
    test_id = f"test-integration-{uuid.uuid4()}"
    user_id = test_id
    agent_id = f"{test_id}-agent"

    try:
        # Insert the test row.
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "INSERT INTO copass_agents (user_id, agent_id, version) "
                    "VALUES (%s, %s, %s)",
                    (user_id, agent_id, 1),
                )

        registry = MysqlProviderBindingRegistry(pool)

        provision_call_counter = 0

        async def provision() -> ProviderBinding:
            nonlocal provision_call_counter
            await asyncio.sleep(0)
            provision_call_counter += 1
            return _binding(f"agent_provisioned_{provision_call_counter}")

        # Race two concurrent provisioners.
        results = await asyncio.gather(
            registry.get_or_provision(
                user_id=user_id,
                agent_id=agent_id,
                provider="anthropic_managed",
                for_version=1,
                provision=provision,
            ),
            registry.get_or_provision(
                user_id=user_id,
                agent_id=agent_id,
                provider="anthropic_managed",
                for_version=1,
                provision=provision,
            ),
        )

        # Both callers see the same binding. The CAS UPDATE allows
        # both ``provision()`` calls to fire (we accept the orphan
        # cost — one extra Anthropic ``agents.create`` per fingerprint
        # revision per pod, not per request); but only one's binding
        # ends up persisted, and both callers return THAT binding.
        assert results[0].agent_id == results[1].agent_id

        # Persisted binding matches.
        stored = await registry.get_binding(
            user_id=user_id,
            agent_id=agent_id,
            provider="anthropic_managed",
            for_version=1,
        )
        assert stored is not None
        assert stored.agent_id == results[0].agent_id
    finally:
        # Cleanup.
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "DELETE FROM copass_agents WHERE user_id = %s",
                    (user_id,),
                )
        pool.close()
        await pool.wait_closed()
