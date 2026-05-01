"""Sanitizer for tool ``input_schema`` payloads handed to Anthropic.

Anthropic's tool-registration API strict-validates ``input_schema``
and rejects any field outside its narrow JSON-Schema-like subset with
HTTP 400 ``Extra inputs are not permitted``. Even semantically
meaningful JSON-Schema fields (``additionalProperties``,
``$schema``, ``$defs``, etc.) are rejected.

This module is the single source of truth for "what does Anthropic
accept on input_schema." Every backend that hands a ``ToolSpec`` to
Anthropic should route through :func:`sanitize_anthropic_input_schema`
so consumers (backends, SDK adapters, third-party tools) don't have
to re-derive the rules.

Strategy: denylist (not allowlist) recursively. The schema fragment
may legitimately carry per-property fields like ``enum``, ``items``,
``format``, ``minimum``, etc. that ARE accepted; we don't want to
strip those. The forbidden set below is what's been observed to
trigger 400s, plus the JSON-Schema metadata keys that are pure
tooling hints. Add to the set when new failures emerge — Anthropic's
exact validation surface evolves.
"""

from __future__ import annotations

from typing import Any

# Top-level + nested JSON-Schema fields Anthropic's tool-registration
# validator rejects. Stripped recursively from input_schema fragments.
ANTHROPIC_FORBIDDEN_INPUT_SCHEMA_KEYS: frozenset[str] = frozenset({
    # Core JSON-Schema metadata — pure tooling/lint hints.
    "$schema",
    "$id",
    "$defs",
    "$ref",
    "$comment",
    # Validation-mode field Anthropic rejects despite its semantic
    # meaning. Equivalent strictness lives at handler layer (Pydantic).
    "additionalProperties",
})


def sanitize_anthropic_input_schema(schema: Any) -> Any:
    """Return a deep copy of ``schema`` with Anthropic-forbidden keys
    stripped at every nesting level. Non-dict / non-list values are
    returned as-is.

    Centralizes the wire-shape rules so every consumer that hands a
    tool spec to Anthropic gets the same sanitization without
    re-implementing it. Source of truth for the forbidden set is
    :data:`ANTHROPIC_FORBIDDEN_INPUT_SCHEMA_KEYS`.
    """
    if isinstance(schema, dict):
        return {
            k: sanitize_anthropic_input_schema(v)
            for k, v in schema.items()
            if k not in ANTHROPIC_FORBIDDEN_INPUT_SCHEMA_KEYS
        }
    if isinstance(schema, list):
        return [sanitize_anthropic_input_schema(v) for v in schema]
    return schema


__all__ = [
    "ANTHROPIC_FORBIDDEN_INPUT_SCHEMA_KEYS",
    "sanitize_anthropic_input_schema",
]
