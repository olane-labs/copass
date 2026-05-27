"""Re-export canonical tool/parameter strings from ``copass_config``.

Historically this module hardcoded the strings locally to avoid a
dependency on ``copass-config``. That created drift the moment the
canonical copy moved. We now depend on ``copass-config`` and re-export
its constants so the adapter cannot drift.

Keep importing from ``._strings`` at call sites — this module is the
adapter-local stable surface, ``copass_config`` is the upstream.
"""

from __future__ import annotations

from copass_config import (  # noqa: F401  (re-export)
    DISCOVER_DESCRIPTION,
    DISCOVER_QUERY_PARAM,
    INTERPRET_DESCRIPTION,
    INTERPRET_ITEMS_PARAM,
    INTERPRET_QUERY_PARAM,
    PRESET_PARAM,
    PROJECT_ID_PARAM,
    SEARCH_DESCRIPTION,
    SEARCH_QUERY_PARAM,
)

__all__ = [
    "DISCOVER_DESCRIPTION",
    "DISCOVER_QUERY_PARAM",
    "INTERPRET_DESCRIPTION",
    "INTERPRET_ITEMS_PARAM",
    "INTERPRET_QUERY_PARAM",
    "PRESET_PARAM",
    "PROJECT_ID_PARAM",
    "SEARCH_DESCRIPTION",
    "SEARCH_QUERY_PARAM",
]
