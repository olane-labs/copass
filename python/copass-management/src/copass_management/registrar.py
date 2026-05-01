"""Transport-agnostic management-tool registrar.

Loads the management spec corpus, builds JSON-Schema validators for each
tool's input/output schema, wires every spec entry to its
``copass-core`` handler, and calls ``register(...)`` once per tool.

The transport (MCP SDK, backend tool resolver, plain function table) is
the caller's concern — only the optional ``adapters/mcp.py`` knows about
MCP.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from copass_core import CopassClient
from jsonschema import Draft202012Validator

from copass_management.specs import (
    ManagementSpec,
    load_management_specs,
)
from copass_management.tools import TOOL_HANDLERS


@dataclass(frozen=True)
class ToolContext:
    client: CopassClient
    sandbox_id: str


ToolHandler = Callable[[ToolContext, Dict[str, Any]], Awaitable[Any]]


@dataclass(frozen=True)
class ToolRegistration:
    name: str
    description: str
    input_schema: Dict[str, Any]
    output_schema: Dict[str, Any]
    input_validator: Draft202012Validator
    output_validator: Draft202012Validator
    handler: Callable[[Dict[str, Any]], Awaitable[Any]]
    spec: ManagementSpec


Register = Callable[[ToolRegistration], None]


@dataclass(frozen=True)
class RegistrarOptions:
    sandbox_id: str
    spec_dir: Optional[Path] = None
    validate_output: bool = False
    # Phase 2A spec-only landings (where a JSON Schema + fixture
    # exists but the per-tool handler is deferred to Phase 2B) need
    # the registrar to skip rather than raise. Production wiring
    # leaves this off so missing handlers fail loudly.
    allow_missing_handlers: bool = False


def register_management_tools(
    register: Register,
    client: CopassClient,
    options: RegistrarOptions,
) -> List[ToolRegistration]:
    """Walk the spec corpus, wire handlers, and call ``register`` per tool.

    Returns the list of registrations in spec-name order.
    """
    corpus = load_management_specs(spec_dir=options.spec_dir)
    ctx = ToolContext(client=client, sandbox_id=options.sandbox_id)
    registrations: List[ToolRegistration] = []

    for name in sorted(corpus.specs):
        spec = corpus.specs[name]
        handler = TOOL_HANDLERS.get(name)
        if handler is None:
            if options.allow_missing_handlers:
                continue
            raise RuntimeError(
                f"register_management_tools: no handler implementation for tool "
                f"{name!r}. Add one in copass_management/tools/."
            )

        input_validator = Draft202012Validator(spec.input_schema)
        output_validator = Draft202012Validator(spec.output_schema)

        async def wrapped(
            raw_input: Dict[str, Any] | None,
            *,
            _handler: ToolHandler = handler,
            _input_validator: Draft202012Validator = input_validator,
            _output_validator: Draft202012Validator = output_validator,
            _ctx: ToolContext = ctx,
        ) -> Any:
            payload = raw_input or {}
            _input_validator.validate(payload)
            result = await _handler(_ctx, payload)
            if options.validate_output:
                _output_validator.validate(result)
            return result

        registration = ToolRegistration(
            name=spec.name,
            description=spec.description,
            input_schema=spec.input_schema,
            output_schema=spec.output_schema,
            input_validator=input_validator,
            output_validator=output_validator,
            handler=wrapped,
            spec=spec,
        )
        register(registration)
        registrations.append(registration)

    return registrations


__all__ = [
    "ToolContext",
    "ToolHandler",
    "ToolRegistration",
    "Register",
    "RegistrarOptions",
    "register_management_tools",
]
