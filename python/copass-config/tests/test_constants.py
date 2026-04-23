"""Smoke tests: constants are non-empty strings and importable from the
public surface."""

from __future__ import annotations

import copass_config as cfg


def test_version_present() -> None:
    assert isinstance(cfg.__version__, str)
    assert cfg.__version__ == "0.1.0"


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


def test_system_prompts_mention_discover_and_interpret() -> None:
    for name in ("COPASS_AGENT_MCP_SYSTEM_PROMPT", "COPASS_AGENT_SDK_SYSTEM_PROMPT"):
        prompt = getattr(cfg, name)
        assert "discover" in prompt
        assert "interpret" in prompt
        assert "search" in prompt


def test_mcp_prompt_uses_mcp_tool_names() -> None:
    prompt = cfg.COPASS_AGENT_MCP_SYSTEM_PROMPT
    assert "mcp__copass__discover" in prompt
    assert "mcp__copass__interpret" in prompt


def test_sdk_prompt_uses_bare_tool_names() -> None:
    prompt = cfg.COPASS_AGENT_SDK_SYSTEM_PROMPT
    assert "mcp__copass__" not in prompt
