"""ADR 0029 — bearer mint flows through ``vault_ids`` on session create.

Per ADR 0029 §Implementation Plan §2 the caller (typically
:class:`PassthroughRuntime` in the backend repo) mints a per-session
``olk_`` bearer, mirrors it via
``client.beta.vaults.credentials.create(...)`` with
:class:`BetaManagedAgentsStaticBearerCreateParams`, and threads the
resulting vault id(s) into the harness via
``context.handles[VAULT_IDS_HANDLE]``. The harness then forwards them
verbatim to ``sessions.create(vault_ids=...)``.

The harness does NOT own bearer minting itself — that path requires a
repo-internal helper (:func:`generate_key`) and the brief explicitly
keeps the harness off ``frame_graph.config``. This test verifies the
handoff is wired correctly: when the runtime stashes vault_ids in
handles, they reach Anthropic; when it doesn't, ``sessions.create``
receives no ``vault_ids`` kwarg.
"""

from __future__ import annotations

import pytest

from copass_anthropic_agents.backends.in_memory_provider_binding_registry import (
    InMemoryProviderBindingRegistry,
)
from copass_anthropic_agents.backends.managed_agent_backend_v2 import (
    VAULT_IDS_HANDLE,
    ManagedAgentBackendV2,
)


def _make_backend(**kwargs) -> ManagedAgentBackendV2:
    return ManagedAgentBackendV2(
        api_key="sk-fake-test",
        registry=InMemoryProviderBindingRegistry(),
        **kwargs,
    )


@pytest.mark.asyncio
async def test_create_session_threads_vault_ids_when_supplied() -> None:
    """When the caller provides ``vault_ids`` the harness must include
    them in the ``sessions.create`` call — that's how Anthropic
    resolves the gateway's per-session bearer at tool-call time."""
    captured: list[dict] = []

    class _FakeSessions:
        async def create(self, **kwargs):
            captured.append(kwargs)

            class _S:
                id = "sesn_minted_1"

            return _S()

    class _FakeBeta:
        def __init__(self) -> None:
            self.sessions = _FakeSessions()

    class _Client:
        def __init__(self) -> None:
            self.beta = _FakeBeta()

    backend = _make_backend(use_gateway_mcp=True)
    backend._client = _Client()

    session_id = await backend._create_session(
        agent_id="agnt_1",
        environment_id="env_1",
        title="copass:trace-1",
        vault_ids=["vlt_user_a_1"],
    )
    assert session_id == "sesn_minted_1"
    assert captured[0]["vault_ids"] == ["vlt_user_a_1"]


@pytest.mark.asyncio
async def test_create_session_omits_vault_ids_when_caller_supplied_none() -> None:
    """When ``vault_ids`` is None the harness must omit the kwarg
    entirely. Sending ``vault_ids=None`` (or ``[]``) is rejected by
    the SDK validator on flag-off deployments that never minted a
    credential. The omission preserves the legacy code path
    byte-identically."""
    captured: list[dict] = []

    class _FakeSessions:
        async def create(self, **kwargs):
            captured.append(kwargs)

            class _S:
                id = "sesn_legacy_1"

            return _S()

    class _FakeBeta:
        def __init__(self) -> None:
            self.sessions = _FakeSessions()

    class _Client:
        def __init__(self) -> None:
            self.beta = _FakeBeta()

    backend = _make_backend(use_gateway_mcp=False)
    backend._client = _Client()

    await backend._create_session(
        agent_id="agnt_1",
        environment_id="env_1",
        title="copass:trace-legacy",
        vault_ids=None,
    )
    assert "vault_ids" not in captured[0]


# NOTE: ``test_vault_ids_handle_constant_is_exported`` (the top-level
# re-export assertion) is intentionally dropped in Phase 1. Per ADR
# 0001 Q2, v2 lives in ``copass_anthropic_agents.backends`` only and
# is NOT exported from ``copass_anthropic_agents`` at the top level
# until Phase 4 of the ADR (v1 removal). Re-add the assertion then.
