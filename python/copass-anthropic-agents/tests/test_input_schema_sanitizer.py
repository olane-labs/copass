"""Regression tests for the Anthropic input_schema sanitizer.

Anthropic's tool-registration API rejects ``$schema``,
``additionalProperties``, and other JSON-Schema fields outside its
narrow allowlist with HTTP 400 ``Extra inputs are not permitted``.
The sanitizer in
``copass_anthropic_agents.backends._input_schema`` strips them
recursively at the API boundary so every consumer that hands a
``ToolSpec`` to Anthropic gets the right wire shape.

These tests pin the strip behaviour so a future regression (e.g.
someone adds a new spec field that Anthropic rejects, or removes
``additionalProperties`` from the forbidden set without thinking)
fails CI loudly rather than silently shipping a 400 to users.
"""

from __future__ import annotations

from copass_anthropic_agents.backends._input_schema import (
    ANTHROPIC_FORBIDDEN_INPUT_SCHEMA_KEYS,
    sanitize_anthropic_input_schema,
)


def test_strips_forbidden_top_level_keys() -> None:
    raw = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {"slug": {"type": "string"}},
        "required": ["slug"],
        "additionalProperties": False,
    }
    out = sanitize_anthropic_input_schema(raw)
    assert "$schema" not in out
    assert "additionalProperties" not in out
    assert out["type"] == "object"
    assert out["properties"] == {"slug": {"type": "string"}}
    assert out["required"] == ["slug"]


def test_strips_forbidden_keys_recursively() -> None:
    raw = {
        "type": "object",
        "properties": {
            "filters": {
                "$schema": "leak",
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "tag": {"type": "string"},
                },
            },
            "items": {
                "type": "array",
                "items": {
                    "$id": "leak",
                    "type": "string",
                },
            },
        },
        "additionalProperties": False,
    }
    out = sanitize_anthropic_input_schema(raw)
    assert "additionalProperties" not in out
    assert "$schema" not in out["properties"]["filters"]
    assert "additionalProperties" not in out["properties"]["filters"]
    assert "$id" not in out["properties"]["items"]["items"]


def test_passes_through_anthropic_accepted_keys() -> None:
    raw = {
        "type": "object",
        "description": "A tool input",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Page size",
                "enum": [10, 20, 50],
            },
            "status": {
                "type": "string",
                "enum": ["active", "archived"],
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["limit"],
    }
    out = sanitize_anthropic_input_schema(raw)
    assert out == raw, "no forbidden keys were present; output should match input"


def test_returns_deep_copy_not_reference() -> None:
    raw = {
        "type": "object",
        "properties": {"a": {"type": "string"}},
    }
    out = sanitize_anthropic_input_schema(raw)
    out["properties"]["a"]["type"] = "mutated"
    assert raw["properties"]["a"]["type"] == "string", (
        "sanitize must not mutate the input"
    )


def test_handles_non_dict_inputs_gracefully() -> None:
    assert sanitize_anthropic_input_schema("string") == "string"
    assert sanitize_anthropic_input_schema(42) == 42
    assert sanitize_anthropic_input_schema(None) is None
    assert sanitize_anthropic_input_schema([1, 2, 3]) == [1, 2, 3]


def test_forbidden_set_contains_expected_keys() -> None:
    """Pin the contents — accidental shrinking would silently let
    rejected keys through; accidental growth would over-strip."""
    expected = {
        "$schema",
        "$id",
        "$defs",
        "$ref",
        "$comment",
        "additionalProperties",
    }
    assert set(ANTHROPIC_FORBIDDEN_INPUT_SCHEMA_KEYS) == expected
