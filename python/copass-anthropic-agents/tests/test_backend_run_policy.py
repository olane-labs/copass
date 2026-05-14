"""BackendRunPolicy — defaults + policy timeout enforcement test.

The default-values assertion belongs here because the brief's
default-values test is short and this file is the natural home for
policy-shape tests. The end-to-end policy-timeout-enforcement test
lives in :mod:`test_managed_agent_backend_v2_stream` (it needs a stub
SDK stream that never yields ``end_turn``).
"""

from __future__ import annotations

from copass_anthropic_agents.backends.backend_run_policy import BackendRunPolicy


def test_default_policy_values_match_adr() -> None:
    """ADR 0001 Decision 4 locks the defaults: ``max_cycles=20``,
    ``cycle_timeout_s=60.0``, ``total_timeout_s=300.0``. Changing any
    of these is a public-contract change — pause and discuss before
    flipping."""
    policy = BackendRunPolicy.default()

    assert policy.max_cycles == 20
    assert policy.cycle_timeout_s == 60.0
    assert policy.total_timeout_s == 300.0


def test_policy_is_frozen() -> None:
    """``BackendRunPolicy`` is ``@dataclass(frozen=True)`` so callers
    can fan it out without worrying about mutation under their feet."""
    policy = BackendRunPolicy(max_cycles=1, cycle_timeout_s=1.0, total_timeout_s=2.0)

    try:
        policy.max_cycles = 99  # type: ignore[misc]
    except (AttributeError, Exception):
        return
    raise AssertionError("BackendRunPolicy mutated after construction")


def test_policy_can_be_constructed_with_custom_values() -> None:
    """Constructor accepts arbitrary values (no bounds checking) —
    bounds are enforced at the call-site by ``ManagedAgentBackendV2``,
    not at type construction. This keeps the dataclass shape lean."""
    policy = BackendRunPolicy(
        max_cycles=42, cycle_timeout_s=7.5, total_timeout_s=99.9,
    )

    assert policy.max_cycles == 42
    assert policy.cycle_timeout_s == 7.5
    assert policy.total_timeout_s == 99.9
