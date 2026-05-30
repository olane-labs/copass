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


ORIGIN_CANONICAL_IDS_PARAM = " ".join(
    [
        "Canonical IDs to look up source files for. Typically the",
        "`canonical_ids` arrays from items the caller picked out of `discover`.",
        "At least one is required; up to 100 per call.",
    ]
)
"""``canonical_ids`` param — get_origin."""


ORIGIN_LIMIT_PARAM = " ".join(
    [
        "Per-canonical cap on returned files (1–50). Files are ordered by how",
        "many extractions of the canonical came from each, descending.",
        "Defaults to 10 when omitted.",
    ]
)
"""``limit_per_canonical`` param — get_origin."""


__all__ = [
    "DISCOVER_QUERY_PARAM",
    "INTERPRET_QUERY_PARAM",
    "SEARCH_QUERY_PARAM",
    "INTERPRET_ITEMS_PARAM",
    "PROJECT_ID_PARAM",
    "PRESET_PARAM",
    "ORIGIN_CANONICAL_IDS_PARAM",
    "ORIGIN_LIMIT_PARAM",
]
