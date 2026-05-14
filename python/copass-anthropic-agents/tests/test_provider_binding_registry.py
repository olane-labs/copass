"""ProviderBindingRegistry — in-memory race-safety tests.

Maps to ADR 0001 §7 net-new tests **#3 (cross-process duplicate-create
resistance, in-memory mirror)** and **#4 (for_version cache miss on
version bump)**.

The MySQL mirror (``test_mysql_provider_binding_registry.py``) is
skipped by default; ADR 0001 §7 test #3's MySQL flavor activates only
when ``COPASS_INTEGRATION=1`` is set.
"""

from __future__ import annotations

import asyncio

import pytest

from copass_anthropic_agents.backends.in_memory_provider_binding_registry import (
    InMemoryProviderBindingRegistry,
)
from copass_anthropic_agents.backends.provider_binding_registry import (
    ProviderBinding,
)


def _binding(agent_id: str, for_version: int = 1) -> ProviderBinding:
    return ProviderBinding(
        agent_id=agent_id,
        environment_id=f"env_{agent_id}",
        for_version=for_version,
        provisioned_at="2026-05-14T13:50:00Z",
    )


@pytest.mark.asyncio
async def test_get_binding_returns_none_for_unknown_key() -> None:
    """Cold registry returns ``None`` for any read — caller treats this
    as a cache miss and provisions."""
    registry = InMemoryProviderBindingRegistry()

    result = await registry.get_binding(
        user_id="u-1",
        agent_id="a-1",
        provider="anthropic_managed",
        for_version=1,
    )

    assert result is None


@pytest.mark.asyncio
async def test_get_binding_returns_stored_binding_for_matching_version() -> None:
    """A binding stored for ``for_version=N`` returns on reads asking
    for the same version (or any older version — older ``for_version``
    requests still get the stored value, by the registry's monotonic
    semantic)."""
    registry = InMemoryProviderBindingRegistry()
    expected = _binding("agent_01_xyz", for_version=5)

    # Provision once.
    await registry.get_or_provision(
        user_id="u-1",
        agent_id="a-1",
        provider="anthropic_managed",
        for_version=5,
        provision=lambda: _async_return(expected),
    )

    # Read.
    result = await registry.get_binding(
        user_id="u-1",
        agent_id="a-1",
        provider="anthropic_managed",
        for_version=5,
    )

    assert result == expected


@pytest.mark.asyncio
async def test_get_or_provision_is_atomic_under_concurrency() -> None:
    """ADR 0001 §7 test #3 (in-memory): spawn two coroutines racing
    against the same key; assert exactly one ``provision`` invocation
    and both coroutines receive the same binding.

    Without the per-key lock, two coroutines would each see a cache
    miss, both call ``provision``, and produce two duplicate Anthropic
    ``agents.create`` calls per fingerprint revision — the cost-
    surprise vector ADR 0001 §1.2 calls out.
    """
    registry = InMemoryProviderBindingRegistry()
    provision_calls = 0

    async def provision() -> ProviderBinding:
        nonlocal provision_calls
        # Small await so the two coroutines genuinely race on the
        # check-then-set rather than completing inline.
        await asyncio.sleep(0)
        provision_calls += 1
        return _binding(f"agent_provisioned_{provision_calls}")

    # Spawn two racing get_or_provision calls.
    results = await asyncio.gather(
        registry.get_or_provision(
            user_id="u-1",
            agent_id="a-1",
            provider="anthropic_managed",
            for_version=1,
            provision=provision,
        ),
        registry.get_or_provision(
            user_id="u-1",
            agent_id="a-1",
            provider="anthropic_managed",
            for_version=1,
            provision=provision,
        ),
    )

    # Exactly one provision call across both races.
    assert provision_calls == 1
    # Both coroutines see the same binding.
    assert results[0] == results[1]
    assert results[0].agent_id == "agent_provisioned_1"


@pytest.mark.asyncio
async def test_get_or_provision_invokes_provision_on_version_bump() -> None:
    """ADR 0001 §7 test #4: a binding stored for an older version
    must miss on a request for a newer version, re-provision, and
    overwrite.

    The MySQL CAS WHERE clause encodes the same rule via
    ``JSON_EXTRACT(provider_bindings, '$.<provider>.for_version') < :version``.
    """
    registry = InMemoryProviderBindingRegistry()

    # Pre-populate with for_version=12.
    old_binding = _binding("agent_old", for_version=12)
    await registry.get_or_provision(
        user_id="u-1",
        agent_id="a-1",
        provider="anthropic_managed",
        for_version=12,
        provision=lambda: _async_return(old_binding),
    )

    # Request for_version=13; provision should fire again.
    new_binding = _binding("agent_new", for_version=13)
    provision_invoked = False

    async def provision() -> ProviderBinding:
        nonlocal provision_invoked
        provision_invoked = True
        return new_binding

    result = await registry.get_or_provision(
        user_id="u-1",
        agent_id="a-1",
        provider="anthropic_managed",
        for_version=13,
        provision=provision,
    )

    assert provision_invoked is True
    assert result == new_binding

    # Subsequent read at for_version=13 returns the new binding.
    stored = await registry.get_binding(
        user_id="u-1",
        agent_id="a-1",
        provider="anthropic_managed",
        for_version=13,
    )
    assert stored == new_binding


@pytest.mark.asyncio
async def test_get_binding_returns_none_when_stored_version_older() -> None:
    """The companion to the version-bump test: ``get_binding`` itself
    surfaces the stale binding as ``None`` so the caller's read-then-
    provision pattern works without a separate staleness check."""
    registry = InMemoryProviderBindingRegistry()
    await registry.get_or_provision(
        user_id="u-1",
        agent_id="a-1",
        provider="anthropic_managed",
        for_version=12,
        provision=lambda: _async_return(_binding("agent_old", for_version=12)),
    )

    result = await registry.get_binding(
        user_id="u-1",
        agent_id="a-1",
        provider="anthropic_managed",
        for_version=13,
    )

    assert result is None


@pytest.mark.asyncio
async def test_different_keys_do_not_collide() -> None:
    """A binding for one ``(user_id, agent_id, provider)`` does not
    satisfy reads against a different tuple — otherwise tenancy
    isolation breaks."""
    registry = InMemoryProviderBindingRegistry()
    await registry.get_or_provision(
        user_id="u-1",
        agent_id="a-1",
        provider="anthropic_managed",
        for_version=1,
        provision=lambda: _async_return(_binding("agent_for_u1")),
    )

    other = await registry.get_binding(
        user_id="u-2",  # different user
        agent_id="a-1",
        provider="anthropic_managed",
        for_version=1,
    )

    assert other is None


async def _async_return(value):
    return value
