"""ManagedAgentBackend — message normalization, fingerprinting, tools payload.

Integration-level flow (``stream``, ``run``) is exercised by the
server-side Copass repo's end-to-end tests with a live Anthropic key.
Here we verify the vendor-neutral plumbing that can be tested without
network I/O.
"""

from __future__ import annotations

from copass_anthropic_agents import (
    AgentTool,
    AgentToolRegistry,
    ManagedAgentBackend,
    ToolSpec,
)


class _DummyTool(AgentTool):
    def __init__(self, name: str) -> None:
        self._name = name

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name=self._name,
            description=self._name,
            input_schema={"type": "object", "properties": {}},
        )

    async def invoke(self, arguments, *, context=None):
        return {}


def _make_backend() -> ManagedAgentBackend:
    return ManagedAgentBackend(api_key="sk-fake-test")


def test_normalize_messages_from_string() -> None:
    backend = _make_backend()
    out = backend._normalize_messages("hello")
    assert out == [
        {"type": "user.message", "content": [{"type": "text", "text": "hello"}]}
    ]


def test_normalize_messages_from_list() -> None:
    backend = _make_backend()
    out = backend._normalize_messages(
        [{"role": "user", "content": "one"}, {"role": "user", "content": "two"}]
    )
    assert len(out) == 2
    assert out[0]["content"][0]["text"] == "one"
    assert out[1]["content"][0]["text"] == "two"


def test_normalize_messages_skips_non_user() -> None:
    backend = _make_backend()
    out = backend._normalize_messages(
        [
            {"role": "assistant", "content": "should be dropped"},
            {"role": "user", "content": "kept"},
        ]
    )
    assert len(out) == 1
    assert out[0]["content"][0]["text"] == "kept"


def test_specs_to_tools_without_builtin_toolset() -> None:
    backend = _make_backend()
    specs = [
        ToolSpec(name="a", description="tool a", input_schema={"type": "object"}),
        ToolSpec(name="b", description="tool b", input_schema={"type": "object"}),
    ]
    tools = backend._specs_to_tools(specs)
    assert len(tools) == 2
    assert {t["type"] for t in tools} == {"custom"}
    assert [t["name"] for t in tools] == ["a", "b"]


def test_specs_to_tools_with_builtin_toolset() -> None:
    backend = ManagedAgentBackend(api_key="sk-fake", include_builtin_toolset=True)
    specs = [ToolSpec(name="a", description="tool a", input_schema={"type": "object"})]
    tools = backend._specs_to_tools(specs)
    assert tools[0] == {"type": "agent_toolset_20260401"}
    assert tools[1]["type"] == "custom"


def test_fingerprint_stable_for_identical_config() -> None:
    backend = _make_backend()

    class _A:
        model = "m"
        system_prompt = "sp"
        identity = "id"

    reg = AgentToolRegistry()
    reg.add(_DummyTool("tool"))
    fp1 = backend._fingerprint_agent(_A(), reg)
    fp2 = backend._fingerprint_agent(_A(), reg)
    assert fp1 == fp2


def test_fingerprint_differs_when_prompt_changes() -> None:
    backend = _make_backend()

    class _A:
        model = "m"
        system_prompt = "sp-one"
        identity = "id"

    class _B:
        model = "m"
        system_prompt = "sp-two"
        identity = "id"

    reg = AgentToolRegistry()
    reg.add(_DummyTool("tool"))
    assert backend._fingerprint_agent(_A(), reg) != backend._fingerprint_agent(_B(), reg)


def test_fingerprint_differs_when_tools_change() -> None:
    backend = _make_backend()

    class _A:
        model = "m"
        system_prompt = "sp"
        identity = "id"

    reg_one = AgentToolRegistry()
    reg_one.add(_DummyTool("alpha"))
    reg_two = AgentToolRegistry()
    reg_two.add(_DummyTool("alpha"))
    reg_two.add(_DummyTool("beta"))
    assert backend._fingerprint_agent(_A(), reg_one) != backend._fingerprint_agent(_A(), reg_two)
