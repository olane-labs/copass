"""Conformance test — validates every spec fixture against its
JSON Schema in both directions and asserts byte-equivalent JSON
round-trip.

This is the Python side of the cross-language equivalence contract
established by ADR 0007 — it must produce the same parsed structures
as the TypeScript ``conformance.test.ts`` for the same fixture corpus.

Phase 2A audit follow-up: when the ``CONFORMANCE_PY_OUT`` env var is
set, every per-tool round-trip emits its parsed (post-validation)
output to ``$CONFORMANCE_PY_OUT/<tool>.json`` so the shell harness
can ``diff -r`` against the TypeScript-emitted tree.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from copass_management import (
    MAX_SPEC_VERSION,
    MIN_SPEC_VERSION,
    load_management_specs,
)
from copass_management.tools import TOOL_HANDLERS


REPO_ROOT = Path(__file__).resolve().parents[3]
SPEC_DIR = REPO_ROOT / "spec" / "management" / "v1"

_PARSED_OUTPUT_DIR_ENV = os.environ.get("CONFORMANCE_PY_OUT")
PARSED_OUTPUT_DIR: Path | None = (
    Path(_PARSED_OUTPUT_DIR_ENV) if _PARSED_OUTPUT_DIR_ENV else None
)


def _stable_canonical(value: object) -> object:
    """Recursively sort dict keys so the JSON form is deterministic."""
    if isinstance(value, dict):
        return {k: _stable_canonical(value[k]) for k in sorted(value)}
    if isinstance(value, list):
        return [_stable_canonical(v) for v in value]
    return value


@pytest.fixture(scope="module", autouse=True)
def _wipe_parsed_output_dir():
    if PARSED_OUTPUT_DIR is not None:
        if PARSED_OUTPUT_DIR.exists():
            shutil.rmtree(PARSED_OUTPUT_DIR)
        PARSED_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    yield
    if PARSED_OUTPUT_DIR is not None:
        # Sanity gate so a missing-write doesn't slip through as a
        # silently-passing `diff -r` against an empty tree.
        written = sorted(p.stem for p in PARSED_OUTPUT_DIR.glob("*.json"))
        expected = sorted(p.stem for p in SPEC_DIR.glob("*.json"))
        assert written == expected, (
            f"conformance: expected {len(expected)} parsed-output files "
            f"in {PARSED_OUTPUT_DIR}, found {len(written)} "
            f"(missing: {set(expected) - set(written)})"
        )


@pytest.fixture(scope="module")
def corpus():
    return load_management_specs(spec_dir=SPEC_DIR)


def test_supported_spec_versions() -> None:
    assert MIN_SPEC_VERSION == "v1"
    assert MAX_SPEC_VERSION == "v1"


def test_corpus_loads_phase1_reads_and_phase2_writes(corpus) -> None:
    expected = {
        # Phase 1 read tools.
        "get_agent",
        "get_run_trace",
        "get_source",
        "list_agent_tools",
        "list_agents",
        "list_api_keys",
        "list_apps",
        "list_connected_accounts",
        "list_runs",
        "list_sandbox_connections",
        "list_sandboxes",
        "list_sources",
        "list_trigger_components",
        "list_triggers",
        # Phase 2 write tools.
        "add_user_mcp_source",
        "create_agent",
        "update_agent_prompt",
        "update_agent_tool_sources",
        "update_agent_tools",
        "wire_integration_to_agent",
        # Chunk B write tools.
        "connect_linear",
        "create_trigger",
        "grant_sandbox_connection",
        "pause_trigger",
        "provision_source",
        "resume_trigger",
        "revoke_sandbox_connection",
        "revoke_user_mcp_source",
        "start_integration_connect",
        "test_user_mcp_source",
        "update_agent_model_settings",
        "update_source",
        "update_trigger",
    }
    assert set(corpus.specs.keys()) == expected
    assert len(corpus.specs) == 33


def test_handler_bound_for_every_tool(corpus) -> None:
    for name in corpus.specs:
        assert name in TOOL_HANDLERS, f"missing handler for {name!r}"


def test_fixture_present_for_every_tool(corpus) -> None:
    for name in corpus.specs:
        assert name in corpus.fixtures, f"missing fixture for {name!r}"


def _stable_json(value):
    return json.dumps(value, sort_keys=True, default=str)


@pytest.mark.parametrize(
    "spec_name",
    sorted(
        Path(p).stem for p in SPEC_DIR.glob("*.json")
    ),
)
def test_fixture_input_matches_input_schema(corpus, spec_name: str) -> None:
    spec = corpus.specs[spec_name]
    fixture = corpus.fixtures[spec_name]
    Draft202012Validator(spec.input_schema).validate(fixture.input)


@pytest.mark.parametrize(
    "spec_name",
    sorted(
        Path(p).stem for p in SPEC_DIR.glob("*.json")
    ),
)
def test_fixture_output_matches_output_schema(corpus, spec_name: str) -> None:
    spec = corpus.specs[spec_name]
    fixture = corpus.fixtures[spec_name]
    Draft202012Validator(spec.output_schema).validate(fixture.output)


@pytest.mark.parametrize(
    "spec_name",
    sorted(
        Path(p).stem for p in SPEC_DIR.glob("*.json")
    ),
)
def test_fixture_round_trip_byte_equivalent(corpus, spec_name: str) -> None:
    fixture = corpus.fixtures[spec_name]
    # Parse-and-redump preserves shape because validators don't transform.
    assert _stable_json(json.loads(_stable_json(fixture.input))) == _stable_json(fixture.input)
    assert _stable_json(json.loads(_stable_json(fixture.output))) == _stable_json(fixture.output)

    if PARSED_OUTPUT_DIR is not None:
        # Emit the canonical post-validation form for cross-language
        # `diff -r`. jsonschema validators don't coerce values, but
        # if Pydantic ever swaps in we want every test run's parsed
        # output on disk so a real divergence shows up immediately.
        target = PARSED_OUTPUT_DIR / f"{spec_name}.json"
        payload = {
            "input": _stable_canonical(fixture.input),
            "output": _stable_canonical(fixture.output),
        }
        target.write_text(json.dumps(payload, indent=2, ensure_ascii=False))


def test_input_and_output_schemas_have_no_json_schema_meta_keys() -> None:
    """Anthropic's tool-registration API rejects ``$schema`` (and other
    JSON-Schema metadata keys) on tool input shapes with HTTP 400.
    Spec files declare ``$schema`` for tooling/lint purposes; the loader
    must strip it before tools land at the wire.
    """
    forbidden = {"$schema", "$id", "$defs", "$ref", "$comment"}
    corpus = load_management_specs()

    def walk(node, path):
        if isinstance(node, dict):
            leaked = forbidden & set(node)
            assert not leaked, f"{path}: leaked {leaked}"
            for k, v in node.items():
                walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")

    for name, spec in corpus.specs.items():
        walk(spec.input_schema, f"{name}.inputSchema")
        walk(spec.output_schema, f"{name}.outputSchema")
