"""Shared value types for the Copass Python client.

Hand-ported from ``typescript/packages/core/src/types/common.ts`` and
the retrieval/context subsets actually needed by v0.1.0 consumers.
Richer resource-specific types land incrementally as more resources
are ported.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Final, List, Literal, Mapping, Optional, Protocol


AgentBackend = Literal["anthropic", "google", "hermes"]

# Compute provider for sandboxed runtimes. Required when
# ``backend == "hermes"``; must be omitted otherwise. Daytona is
# planned but blocked on upstream; ``"e2b"`` is the only accepted
# value today. Matches the TS source-of-truth at
# ``typescript/packages/core/src/types/agents.ts``.
AgentComputeProvider = Literal["e2b"]


# Hermes models are namespaced ``hermes/<openrouter-model-id>`` — the
# ``hermes/`` prefix is consumed by Hermes' provider router; the
# remaining segment is forwarded to the managed LLM gateway as the
# literal OpenRouter model id.
DEFAULT_MODEL_BY_BACKEND: Final[Mapping[AgentBackend, str]] = {
    "anthropic": "claude-sonnet-4-6",
    "google": "gemini-2.5-flash",
    "hermes": "hermes/anthropic/claude-sonnet-4-5",
}


BackoffStrategy = Literal["exponential", "linear", "fixed"]


@dataclass(frozen=True)
class RetryConfig:
    """Retry configuration for transient HTTP failures.

    Attributes:
        max_attempts: Max total attempts (including the first). Default 3.
        backoff_base_ms: Base delay in milliseconds.
        backoff_strategy: ``"exponential"`` (2^attempt * base),
            ``"linear"`` ((attempt + 1) * base), or ``"fixed"`` (base).
    """

    max_attempts: int = 3
    backoff_base_ms: int = 1000
    backoff_strategy: BackoffStrategy = "exponential"


ChatRole = Literal["user", "assistant", "system"]


@dataclass(frozen=True)
class ChatMessage:
    """One chat turn. Mirrors the TS ``ChatMessage``.

    The optional ``name`` field carries the named participant for this
    turn. Adapters that forward chat messages to the ingestion API
    use it as the envelope's ``speaker`` field, retiring the legacy
    ``[author=…]`` content-prefix convention. When absent, adapters
    typically fall back to capitalizing ``role``.
    """

    role: ChatRole
    content: str
    name: Optional[str] = None


class WindowLike(Protocol):
    """Structural contract the retrieval resource accepts in place of a
    raw ``history`` list. Any object with a ``get_turns()`` method
    returning a list of :class:`ChatMessage` satisfies this.

    Mirrors the TS ``WindowLike`` interface — the Python
    ``ContextWindow`` class (v0.2) will satisfy this protocol.
    """

    def get_turns(self) -> List[ChatMessage]: ...


SearchPreset = Literal[
    # Canonical names
    "copass/copass_1.0",
    "copass/copass_2.0",
    "copass/copass_1.0:thinking",
    "copass/copass_2.0:thinking",
    # Short aliases (kept for backward-compat)
    "copass/1.0",
    "copass/2.0",
    "copass/1.0:thinking",
    "copass/2.0:thinking",
]


# ─── Cost telemetry ──────────────────────────────────────────────────
#
# Optional ``cost`` sub-object the server attaches to the
# ``discover`` / ``interpret`` / ``search`` retrieval response
# envelopes. Absent / ``None`` when the deployment is configured with
# ``gate_mode == "off"``; populated in ``"shadow"`` and ``"enforce"``.

GateMode = Literal["off", "shadow", "enforce"]


@dataclass(frozen=True)
class CostInfo:
    """Per-call cost telemetry attached to retrieval responses.

    Matches the ``cost`` sub-object the server returns on
    ``discover`` / ``interpret`` / ``search``. ``microcents`` is the
    authoritative integer — use it as a join key against billing
    records you fetch from the server via ``deduction_id``.

    ``usd`` is a display-only convenience (``microcents / 1_000_000``,
    rounded to 6 decimals). **Do not sum ``usd`` across many responses**
    — float-rounding drift accumulates. Sum ``microcents`` and divide
    once at display.

    The four shapes a client may observe:

    * ``gate_mode="enforce"`` with ``deduction_id`` — production path,
      a billable ledger entry was written.
    * ``gate_mode="shadow"`` with ``deduction_id`` — shadow path, a
      ledger entry was written but not enforced.
    * ``gate_mode="shadow"`` with ``deduction_id is None`` — shadow
      path where the gate would have denied; callers learn the figure
      the call would have cost without a ledger entry being written.
    * The whole ``cost`` field absent / ``None`` — deployment runs
      with ``gate_mode="off"`` (no cost surfacing).

    Attributes:
        microcents: USD microcents (1e-6 USD). Required; ``>= 0``.
        usd: ``microcents / 1_000_000`` rounded to 6 decimals.
            Display-only.
        deduction_id: Opaque ledger identifier returned by the server;
            use it as a join key against billing records you fetch
            from the server. ``None`` when no ledger entry was
            written for this call.
        gate_mode: Echoes the gate mode that processed this request
            (``"off"`` / ``"shadow"`` / ``"enforce"``). Required.
    """

    microcents: int
    gate_mode: GateMode
    usd: Optional[float] = None
    deduction_id: Optional[str] = None

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "CostInfo":
        """Parse a ``cost`` sub-object out of a retrieval response dict.

        The retrieval methods currently return ``Dict[str, Any]`` (see
        the TODO in ``copass_core.resources.retrieval``); consumers
        that want a typed ``CostInfo`` call this on ``response["cost"]``.
        Tolerates the server omitting ``usd`` / ``deduction_id`` (both
        optional) and raises ``KeyError`` only on the two required
        fields (``microcents``, ``gate_mode``).
        """
        return cls(
            microcents=int(payload["microcents"]),
            gate_mode=payload["gate_mode"],
            usd=(
                float(payload["usd"])
                if payload.get("usd") is not None
                else None
            ),
            deduction_id=(
                str(payload["deduction_id"])
                if payload.get("deduction_id") is not None
                else None
            ),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize back to the wire dict shape (all four keys present,
        ``None`` preserved for the two optional fields)."""
        return {
            "microcents": self.microcents,
            "usd": self.usd,
            "deduction_id": self.deduction_id,
            "gate_mode": self.gate_mode,
        }


__all__ = [
    "AgentBackend",
    "BackoffStrategy",
    "ChatMessage",
    "ChatRole",
    "CostInfo",
    "DEFAULT_MODEL_BY_BACKEND",
    "GateMode",
    "RetryConfig",
    "SearchPreset",
    "WindowLike",
]
