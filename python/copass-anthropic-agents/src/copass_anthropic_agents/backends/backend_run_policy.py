"""BackendRunPolicy — per-run bounds for ``ManagedAgentBackendV2``.

ADR 0001 Decision 4 locks the default values at ``max_cycles=20``,
``cycle_timeout_s=60``, ``total_timeout_s=300``. The three knobs map
onto three different enforcement points inside the backend's stream
loop:

- ``max_cycles``: hard cap on the number of ``requires_action`` cycles
  a single ``stream()`` will service. Exceeding it yields
  ``AgentFinish(stop_reason="error")``.
- ``cycle_timeout_s``: wraps the per-cycle wait for the SSE stream to
  deliver the ``agent.*_tool_use`` events whose ids the
  ``requires_action`` cites. Enforced via ``asyncio.wait_for(...)``.
  Hitting it POSTs ``user.interrupt`` and yields
  ``AgentFinish(stop_reason="error")``.
- ``total_timeout_s``: wraps the ENTIRE ``stream()`` body including
  the ``finally`` cleanup (so a wedged session can't hold a coroutine
  open past the policy budget — Risk 8 in the ADR). Enforced via a
  deadline + per-``__anext__`` :func:`asyncio.wait_for` wrapper around
  the inner generator; the wrapper supports Python 3.10 (where
  :func:`asyncio.timeout` doesn't exist) by accumulating budget
  across each iteration. Python 3.11+ could collapse this to
  ``async with asyncio.timeout(...)`` once the package raises its
  minimum Python.

This module is provider-neutral on purpose: when v2 stabilizes and a
second backend with the same tool-use-cycle shape lands, ADR 0001
Decision 4's lift trigger promotes :class:`BackendRunPolicy` into
``copass-core-agents`` (along with :class:`RequiresActionCycle` and
:class:`ProviderBindingRegistry`). For Phase 1 it ships inside
``copass-anthropic-agents``.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BackendRunPolicy:
    """Per-run bounds.

    Default (via :meth:`default`) is ``max_cycles=20``,
    ``cycle_timeout_s=60.0``, ``total_timeout_s=300.0`` — locked by
    ADR 0001 Decision 4.
    """

    max_cycles: int
    cycle_timeout_s: float
    total_timeout_s: float

    @classmethod
    def default(cls) -> "BackendRunPolicy":
        """Return the ADR-0001-locked default policy."""
        return cls(max_cycles=20, cycle_timeout_s=60.0, total_timeout_s=300.0)


__all__ = ["BackendRunPolicy"]
