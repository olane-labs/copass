"""Smoke tests: constants are non-empty strings and importable from the
public surface."""

from __future__ import annotations

import copass_config as cfg


def test_version_present() -> None:
    """Version must be importable and look like a semver string. We
    deliberately don't pin the literal value — the release workflow
    stamps it from ``python/VERSION`` at build time, so a hardcoded
    assertion would always fail on a lockstep release."""
    import re
    assert isinstance(cfg.__version__, str)
    assert re.match(r"^\d+\.\d+\.\d+(\D.*)?$", cfg.__version__), cfg.__version__


def test_tool_descriptions_non_empty() -> None:
    for name in (
        "DISCOVER_DESCRIPTION",
        "MCP_DISCOVER_DESCRIPTION",
        "INTERPRET_DESCRIPTION",
        "SEARCH_DESCRIPTION",
    ):
        value = getattr(cfg, name)
        assert isinstance(value, str), name
        assert value.strip(), name


def test_param_descriptions_non_empty() -> None:
    for name in (
        "DISCOVER_QUERY_PARAM",
        "INTERPRET_QUERY_PARAM",
        "SEARCH_QUERY_PARAM",
        "INTERPRET_ITEMS_PARAM",
        "PROJECT_ID_PARAM",
        "PRESET_PARAM",
    ):
        value = getattr(cfg, name)
        assert isinstance(value, str), name
        assert value.strip(), name


def test_sdk_system_prompt_drills_via_search_not_interpret() -> None:
    """Drill-in guidance is unified on ``search`` across MCP and SDK
    surfaces. ``interpret`` is still registered by SDK adapters for
    backward compat but is no longer the recommended drill-in path."""
    prompt = cfg.COPASS_AGENT_SDK_SYSTEM_PROMPT
    assert "discover" in prompt
    assert "search" in prompt
    assert "interpret" not in prompt


def test_mcp_system_prompt_drops_interpret_and_auto_fire() -> None:
    """MCP gives no auto-fire guarantee (that is an SDK / host
    convention) and no longer exposes ``interpret``."""
    prompt = cfg.COPASS_AGENT_MCP_SYSTEM_PROMPT
    assert "interpret" not in prompt
    assert "auto-fire" not in prompt
    assert "auto-inject" not in prompt
    assert "discover" in prompt
    assert "search" in prompt


def test_mcp_prompt_uses_mcp_tool_names() -> None:
    prompt = cfg.COPASS_AGENT_MCP_SYSTEM_PROMPT
    assert "mcp__copass__discover" in prompt
    assert "mcp__copass__search" in prompt


def test_search_description_carries_per_turn_rule() -> None:
    """Per-turn enforcement lives in ``SEARCH_DESCRIPTION`` so it
    survives if a hook's injected context is compacted out."""
    desc = cfg.SEARCH_DESCRIPTION
    assert "every user turn" in desc.lower()


def test_sdk_prompt_uses_bare_tool_names() -> None:
    prompt = cfg.COPASS_AGENT_SDK_SYSTEM_PROMPT
    assert "mcp__copass__" not in prompt
