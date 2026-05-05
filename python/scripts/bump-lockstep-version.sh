#!/usr/bin/env bash
#
# Bump the lockstep release version for every Python package.
#
# Single source of truth is ``python/VERSION``. Each package's
# ``pyproject.toml`` reads ``python/VERSION`` directly via
# ``[tool.hatch.version] source = regex`` — no stamping needed.
# The ``release-python.yml`` workflow simply runs ``python -m build``
# from each package directory; hatchling resolves the version at
# build time.
#
# Usage:
#   python/scripts/bump-lockstep-version.sh patch     # 0.4.0 -> 0.4.1
#   python/scripts/bump-lockstep-version.sh minor     # 0.4.0 -> 0.5.0
#   python/scripts/bump-lockstep-version.sh major     # 0.4.0 -> 1.0.0
#   python/scripts/bump-lockstep-version.sh 1.2.3     # explicit
#
# After bumping:
#   git -C copass add python/VERSION
#   git -C copass commit -m "release: <reason>"
#   git -C copass push origin production
#
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION_FILE="VERSION"
if [ ! -f "$VERSION_FILE" ]; then
  echo "Error: $PWD/$VERSION_FILE missing" >&2
  exit 1
fi

current=$(tr -d '[:space:]' < "$VERSION_FILE")
arg="${1:-}"

if [ -z "$arg" ]; then
  echo "Current: $current"
  echo "Usage: $0 [patch|minor|major|<X.Y.Z>]" >&2
  exit 1
fi

case "$arg" in
  patch|minor|major)
    IFS=. read -r maj min pat <<EOF
$current
EOF
    case "$arg" in
      patch) pat=$((pat + 1)) ;;
      minor) min=$((min + 1)); pat=0 ;;
      major) maj=$((maj + 1)); min=0; pat=0 ;;
    esac
    new="${maj}.${min}.${pat}"
    ;;
  [0-9]*.[0-9]*.[0-9]*)
    new="$arg"
    ;;
  *)
    echo "Error: '$arg' is not patch|minor|major or X.Y.Z" >&2
    exit 1
    ;;
esac

echo "$new" > "$VERSION_FILE"
echo "Bumped python/VERSION: $current -> $new"
echo ""
echo "Next:"
echo "  git add python/VERSION"
echo "  git commit -m 'release: bump python lockstep to $new'"
echo "  git push origin production"
