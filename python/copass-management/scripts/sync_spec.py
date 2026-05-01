#!/usr/bin/env python3
"""Sync the canonical spec corpus from the harness root into this
package's bundled ``_spec/v1/`` directory.

Run BEFORE ``python -m build`` so the wheel always carries the latest
spec corpus. The release-python.yml workflow invokes this in its
``release-production`` job before building copass-management. Local
developers can also run it manually after editing the harness source
specs:

    python python/copass-management/scripts/sync_spec.py

Idempotent. Honours ``--check`` to fail (non-zero exit) if the local
copy is out of sync — useful for CI to enforce that source-tree
modifications come paired with a fresh sync.
"""
from __future__ import annotations

import filecmp
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG_ROOT = HERE.parent
HARNESS_ROOT = PKG_ROOT.parent.parent
SOURCE = HARNESS_ROOT / "spec" / "management" / "v1"
DEST = PKG_ROOT / "src" / "copass_management" / "_spec" / "v1"


def _files_match(src: Path, dst: Path) -> bool:
    if not dst.exists():
        return False
    cmp_ = filecmp.dircmp(src, dst)
    if cmp_.left_only or cmp_.right_only or cmp_.diff_files:
        return False
    for sub in cmp_.common_dirs:
        if not _files_match(src / sub, dst / sub):
            return False
    return True


def main() -> int:
    if not SOURCE.is_dir():
        print(f"sync_spec: source not found: {SOURCE}", file=sys.stderr)
        return 2
    check_only = "--check" in sys.argv
    if check_only:
        in_sync = _files_match(SOURCE, DEST)
        if in_sync:
            print(f"sync_spec --check: {DEST} matches {SOURCE}")
            return 0
        print(
            f"sync_spec --check: {DEST} is out of sync with {SOURCE}. "
            f"Run `python {Path(__file__).relative_to(HARNESS_ROOT)}` "
            f"and commit.",
            file=sys.stderr,
        )
        return 1
    if DEST.exists():
        shutil.rmtree(DEST)
    shutil.copytree(SOURCE, DEST)
    n = sum(1 for _ in DEST.glob("*.json"))
    print(f"sync_spec: copied {SOURCE} -> {DEST} ({n} top-level specs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
