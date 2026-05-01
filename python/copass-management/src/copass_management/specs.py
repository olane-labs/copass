"""Spec corpus loader.

Resolves the management spec directory in this order:

1. ``spec_dir`` keyword argument when passed.
2. ``COPASS_MANAGEMENT_SPEC_DIR`` env override.
3. Vendored copy bundled inside the package
   (``copass_management/_spec/v1/``).
4. Source tree
   (``copass/spec/management/v1/``) — only resolved during local
   dev when the package is installed editable from the harness checkout.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from importlib import resources
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

MIN_SPEC_VERSION = "v1"
MAX_SPEC_VERSION = "v1"

_ENV_OVERRIDE = "COPASS_MANAGEMENT_SPEC_DIR"


@dataclass(frozen=True)
class ManagementSpec:
    name: str
    description: str
    input_schema: Dict[str, Any]
    output_schema: Dict[str, Any]
    since: str

    @classmethod
    def from_json(cls, data: Dict[str, Any]) -> "ManagementSpec":
        for required in ("name", "description", "inputSchema", "outputSchema", "since"):
            if required not in data:
                raise ValueError(f"spec {data.get('name', '?')!r} missing required field {required!r}")
        if not isinstance(data["name"], str) or not isinstance(data["description"], str):
            raise ValueError("spec name/description must be strings")
        if not isinstance(data["since"], str):
            raise ValueError("spec since must be a string")
        if not isinstance(data["inputSchema"], dict) or not isinstance(data["outputSchema"], dict):
            raise ValueError("inputSchema/outputSchema must be objects")
        return cls(
            name=data["name"],
            description=data["description"],
            input_schema=_strip_json_schema_meta(data["inputSchema"]),
            output_schema=_strip_json_schema_meta(data["outputSchema"]),
            since=data["since"],
        )


_JSON_SCHEMA_META_KEYS = frozenset({"$schema", "$id", "$defs", "$ref", "$comment"})


def _strip_json_schema_meta(value: Any) -> Any:
    """Strip JSON-Schema metadata keys from inputSchema / outputSchema
    before they reach LLM tool registries (Anthropic). Spec files declare
    ``$schema`` for tooling/lint purposes; provider APIs reject the wire
    shape with HTTP 400 ``Extra inputs are not permitted``.
    """
    if isinstance(value, dict):
        return {
            k: _strip_json_schema_meta(v)
            for k, v in value.items()
            if k not in _JSON_SCHEMA_META_KEYS
        }
    if isinstance(value, list):
        return [_strip_json_schema_meta(v) for v in value]
    return value


@dataclass(frozen=True)
class ManagementFixture:
    input: Dict[str, Any]
    output: Dict[str, Any]


@dataclass(frozen=True)
class LoadedManagementCorpus:
    spec_dir: Path
    specs: Dict[str, ManagementSpec] = field(default_factory=dict)
    fixtures: Dict[str, ManagementFixture] = field(default_factory=dict)


def _bundled_spec_dir() -> Optional[Path]:
    try:
        with resources.as_file(resources.files("copass_management") / "_spec" / "v1") as path:
            if path.exists():
                # `as_file` may yield a temp path; copy semantics are safe
                # because we only read.
                return Path(path)
    except (ModuleNotFoundError, FileNotFoundError):
        return None
    return None


def _source_tree_spec_dir() -> Optional[Path]:
    here = Path(__file__).resolve().parent
    candidate = here.parent.parent.parent.parent.parent / "spec" / "management" / "v1"
    if candidate.exists():
        return candidate
    return None


def _resolve_default_spec_dir() -> Path:
    env_override = os.environ.get(_ENV_OVERRIDE, "").strip()
    if env_override:
        return Path(env_override).resolve()

    bundled = _bundled_spec_dir()
    if bundled is not None:
        return bundled

    source = _source_tree_spec_dir()
    if source is not None:
        return source

    raise FileNotFoundError(
        "load_management_specs: could not locate spec directory. Set "
        f"{_ENV_OVERRIDE} to override."
    )


def _iter_specs(root: Path) -> Iterable[Path]:
    for entry in sorted(root.iterdir()):
        if entry.is_file() and entry.suffix == ".json":
            yield entry


def load_management_specs(*, spec_dir: Optional[Path] = None) -> LoadedManagementCorpus:
    """Load every ``<tool>.json`` and matching example fixture from the
    management spec directory."""
    root = Path(spec_dir).resolve() if spec_dir is not None else _resolve_default_spec_dir()
    if not root.is_dir():
        raise NotADirectoryError(f"load_management_specs: {root} is not a directory")

    specs: Dict[str, ManagementSpec] = {}
    for spec_file in _iter_specs(root):
        raw = json.loads(spec_file.read_text(encoding="utf-8"))
        spec = ManagementSpec.from_json(raw)
        specs[spec.name] = spec

    fixtures: Dict[str, ManagementFixture] = {}
    examples_dir = root / "examples"
    if examples_dir.is_dir():
        for fixture_file in sorted(examples_dir.iterdir()):
            if not (fixture_file.is_file() and fixture_file.name.endswith(".example.json")):
                continue
            tool_name = fixture_file.name[: -len(".example.json")]
            raw = json.loads(fixture_file.read_text(encoding="utf-8"))
            if not isinstance(raw, dict) or "input" not in raw or "output" not in raw:
                raise ValueError(f"fixture {fixture_file.name!r} must have 'input' and 'output' keys")
            fixtures[tool_name] = ManagementFixture(input=raw["input"], output=raw["output"])

    return LoadedManagementCorpus(spec_dir=root, specs=specs, fixtures=fixtures)


__all__ = [
    "MIN_SPEC_VERSION",
    "MAX_SPEC_VERSION",
    "ManagementSpec",
    "ManagementFixture",
    "LoadedManagementCorpus",
    "load_management_specs",
]
