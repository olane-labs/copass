"""Unit tests for :class:`copass_core.CostInfo`.

``CostInfo`` is the optional ``cost`` sub-object on retrieval response
envelopes — populated by the server when retrieval has a billable
cost, parsed by the SDK. These tests cover:

* Direct dataclass instantiation across the four field combinations
  clients may observe (enforce with deduction_id, shadow with
  deduction_id, shadow with null deduction_id, and the no-ledger-row
  case).
* ``CostInfo.from_dict`` round-trip against the server's wire shape.
* ``to_dict`` symmetry — the dict shape sent over the wire round-trips
  through ``from_dict`` → ``to_dict`` unchanged.
* ``CostInfo`` is importable both from ``copass_core`` (top-level) and
  ``copass_core.types`` so consumers don't have to learn a new path.

No network / no httpx — pure dataclass plumbing.
"""

from __future__ import annotations

import pytest

from copass_core import CostInfo as CostInfoTopLevel
from copass_core import GateMode as GateModeTopLevel
from copass_core.types import CostInfo, GateMode


# ─── Importability ───────────────────────────────────────────────────


def test_cost_info_is_exported_from_top_level_package() -> None:
    """``copass_core.CostInfo`` is the documented import path; the
    re-export from ``copass_core.types`` is identical (same class
    object, not a copy)."""
    assert CostInfo is CostInfoTopLevel
    assert GateMode is GateModeTopLevel


# ─── Instantiation across the field combinations a client may see ───


def test_cost_info_enforce_with_deduction_id_full_payload() -> None:
    """``"enforce"`` is the production path — every field populated,
    including ``deduction_id`` (a ledger entry was written)."""
    cost = CostInfo(
        microcents=1234,
        gate_mode="enforce",
        usd=0.001234,
        deduction_id="5f3e8b9c-1234-4abc-9def-0123456789ab",
    )
    assert cost.microcents == 1234
    assert cost.gate_mode == "enforce"
    assert cost.usd == 0.001234
    assert cost.deduction_id == "5f3e8b9c-1234-4abc-9def-0123456789ab"


def test_cost_info_shadow_with_deduction_id_full_payload() -> None:
    """Shadow mode with a ledger entry written — the call was let
    through and an entry exists, but enforcement was a no-op.
    ``deduction_id`` is present."""
    cost = CostInfo(
        microcents=500,
        gate_mode="shadow",
        usd=0.0005,
        deduction_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    )
    assert cost.gate_mode == "shadow"
    assert cost.deduction_id is not None


def test_cost_info_shadow_with_null_deduction_id() -> None:
    """Shadow mode with no ledger entry written — the caller learns
    what the call would have cost but ``deduction_id`` is ``None``."""
    cost = CostInfo(microcents=999, gate_mode="shadow")
    assert cost.microcents == 999
    assert cost.gate_mode == "shadow"
    assert cost.deduction_id is None
    assert cost.usd is None


def test_cost_info_enforce_without_deduction_id() -> None:
    """``deduction_id`` is ``None`` when no ledger entry was written
    for this call (e.g. the request short-circuited)."""
    cost = CostInfo(microcents=0, gate_mode="enforce")
    assert cost.deduction_id is None


def test_cost_info_microcents_required() -> None:
    """``microcents`` is required — omitting raises ``TypeError`` from
    the dataclass machinery (positional-or-keyword required arg)."""
    with pytest.raises(TypeError):
        CostInfo(gate_mode="enforce")  # type: ignore[call-arg]


def test_cost_info_gate_mode_required() -> None:
    """``gate_mode`` is required — same dataclass-machinery error."""
    with pytest.raises(TypeError):
        CostInfo(microcents=100)  # type: ignore[call-arg]


def test_cost_info_is_frozen() -> None:
    """Frozen dataclass — assignment after construction raises."""
    cost = CostInfo(microcents=100, gate_mode="enforce")
    with pytest.raises(Exception):  # FrozenInstanceError on 3.10+
        cost.microcents = 200  # type: ignore[misc]


# ─── from_dict — parsing the wire shape ──────────────────────────────


def test_from_dict_full_payload() -> None:
    """The four-field dict the server serializes round-trips into a
    ``CostInfo`` with all attributes set."""
    wire = {
        "microcents": 1234,
        "usd": 0.001234,
        "deduction_id": "5f3e8b9c-1234-4abc-9def-0123456789ab",
        "gate_mode": "enforce",
    }
    cost = CostInfo.from_dict(wire)
    assert cost.microcents == 1234
    assert cost.usd == 0.001234
    assert cost.deduction_id == "5f3e8b9c-1234-4abc-9def-0123456789ab"
    assert cost.gate_mode == "enforce"


def test_from_dict_omitted_usd_and_deduction_id_yield_none() -> None:
    """The server MAY omit ``usd`` and ``deduction_id`` (both optional).
    ``from_dict`` tolerates absent keys."""
    cost = CostInfo.from_dict({"microcents": 50, "gate_mode": "shadow"})
    assert cost.microcents == 50
    assert cost.gate_mode == "shadow"
    assert cost.usd is None
    assert cost.deduction_id is None


def test_from_dict_explicit_null_usd_and_deduction_id_yield_none() -> None:
    """JSON ``null`` over the wire → Python ``None`` after parse →
    ``CostInfo`` keeps ``None``, doesn't try to coerce."""
    cost = CostInfo.from_dict(
        {
            "microcents": 100,
            "usd": None,
            "deduction_id": None,
            "gate_mode": "enforce",
        }
    )
    assert cost.usd is None
    assert cost.deduction_id is None


def test_from_dict_missing_microcents_raises() -> None:
    """``microcents`` is required in the wire shape too."""
    with pytest.raises(KeyError):
        CostInfo.from_dict({"gate_mode": "enforce"})


def test_from_dict_missing_gate_mode_raises() -> None:
    """``gate_mode`` is required in the wire shape too."""
    with pytest.raises(KeyError):
        CostInfo.from_dict({"microcents": 100})


def test_from_dict_coerces_microcents_to_int() -> None:
    """A server that sends ``microcents`` as a JSON number landing in
    Python as ``float`` (e.g. ``1234.0``) is normalized to ``int``."""
    cost = CostInfo.from_dict({"microcents": 1234.0, "gate_mode": "enforce"})
    assert cost.microcents == 1234
    assert isinstance(cost.microcents, int)


# ─── to_dict — round-trip ────────────────────────────────────────────


def test_to_dict_round_trips_full_payload() -> None:
    """``to_dict`` produces the exact wire shape ``from_dict`` consumes —
    sending a parsed ``CostInfo`` back over the wire is lossless."""
    wire = {
        "microcents": 1234,
        "usd": 0.001234,
        "deduction_id": "5f3e8b9c-1234-4abc-9def-0123456789ab",
        "gate_mode": "enforce",
    }
    assert CostInfo.from_dict(wire).to_dict() == wire


def test_to_dict_preserves_none_for_optional_fields() -> None:
    """Shadow-with-null-deduction-id shape: ``usd`` and ``deduction_id``
    are explicit ``None`` in the dict, not absent."""
    cost = CostInfo(microcents=999, gate_mode="shadow")
    assert cost.to_dict() == {
        "microcents": 999,
        "usd": None,
        "deduction_id": None,
        "gate_mode": "shadow",
    }
