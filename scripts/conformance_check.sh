#!/usr/bin/env bash
# Cross-language equivalence check for the management spec corpus.
#
# Each language's conformance suite parses every fixture through its
# own JSON Schema validator (Zod for TS, jsonschema/Pydantic for Py)
# and emits the parsed output to a per-tool file under
# ``/tmp/conformance/{ts,py}/<tool>.json`` (canonical sorted-key
# form). This script runs both suites then `diff -r`s the trees.
#
# Phase 2A audit follow-up replaces the prior fixture-vs-fixture
# self-diff (which trivially passed) with a real cross-language
# parsed-value comparison. Any cross-language coercion divergence
# (Pydantic int-coerces a "5" where Zod rejects it, etc.) shows up
# as a real diff and fails the script.
#
# Phase 1 hard requirement per ADR 0007: spec corpus stays
# byte-equivalent across both languages.

set -euo pipefail

HARNESS_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SPEC_DIR="$HARNESS_ROOT/spec/management/v1"

CONFORMANCE_ROOT="${CONFORMANCE_ROOT:-/tmp/conformance}"
TS_OUT="$CONFORMANCE_ROOT/ts"
PY_OUT="$CONFORMANCE_ROOT/py"

echo "==> wipe and recreate $CONFORMANCE_ROOT"
rm -rf "$CONFORMANCE_ROOT"
mkdir -p "$TS_OUT" "$PY_OUT"

echo "==> redaction lint"
python3 "$HARNESS_ROOT/scripts/lint_redaction.py" "$SPEC_DIR"

echo "==> @copass/core build (so workspace symlink resolves new APIs)"
( cd "$HARNESS_ROOT/typescript/packages/core" && \
  ./node_modules/.bin/tsup >/dev/null )

echo "==> TS conformance suite (vitest) — emits parsed output to $TS_OUT"
( cd "$HARNESS_ROOT/typescript/packages/management" && \
  CONFORMANCE_TS_OUT="$TS_OUT" ./node_modules/.bin/vitest run )

echo "==> Python conformance suite (pytest) — emits parsed output to $PY_OUT"
if [[ -d "$HARNESS_ROOT/python/copass-management/.venv" ]]; then
  # shellcheck disable=SC1091
  source "$HARNESS_ROOT/python/copass-management/.venv/bin/activate"
fi
( cd "$HARNESS_ROOT/python/copass-management" && \
  CONFORMANCE_PY_OUT="$PY_OUT" pytest -q )

echo "==> diff -r $TS_OUT $PY_OUT"
if diff -r "$TS_OUT" "$PY_OUT"; then
  echo "==> cross-language parsed corpus: byte-equivalent across $(ls -1 "$TS_OUT" | wc -l | tr -d ' ') tools"
else
  echo "FAIL: TS and Python parsed corpora diverge"
  exit 1
fi

echo "==> conformance check passed"
