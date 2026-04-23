"""Parameter descriptions for Copass retrieval tools.

Hand-ported from
``typescript/packages/config/src/param-descriptions.ts``.
"""

from __future__ import annotations


DISCOVER_QUERY_PARAM = "Natural-language query to surface relevant context for."
"""``query`` param — discover."""


INTERPRET_QUERY_PARAM = "The question the brief should answer."
"""``query`` param — interpret."""


SEARCH_QUERY_PARAM = "The question to answer."
"""``query`` param — search."""


INTERPRET_ITEMS_PARAM = " ".join(
    [
        "List of canonical_ids tuples — each tuple is the `canonical_ids` field",
        "from one discover item. Pass several to synthesize across items.",
    ]
)
"""``items`` param — interpret."""


PROJECT_ID_PARAM = "Override the server default project_id."
"""``project_id`` param — used by all three retrieval tools."""


PRESET_PARAM = "Override the server default preset."
"""``preset`` param — interpret and search."""


__all__ = [
    "DISCOVER_QUERY_PARAM",
    "INTERPRET_QUERY_PARAM",
    "SEARCH_QUERY_PARAM",
    "INTERPRET_ITEMS_PARAM",
    "PROJECT_ID_PARAM",
    "PRESET_PARAM",
]
