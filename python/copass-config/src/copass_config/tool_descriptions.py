"""Tool descriptions presented to the LLM.

Hand-ported from ``typescript/packages/config/src/tool-descriptions.ts``.
The single source of truth lives in the TS package; this module
mirrors it verbatim so Python Copass adapters (``copass-pydantic-ai``,
future ``copass-langchain``, ``copass-anthropic-agents``) show the LLM
the same tool semantics regardless of framework wrapping.

If the TS side changes, update this file to match and bump the
package's minor version.
"""

from __future__ import annotations

DISCOVER_DESCRIPTION = "\n".join(
    [
        "Return a ranked menu of context items relevant to a query. Each item is a",
        "pointer (canonical_ids + short summary), not prose.",
        "",
        "Window-aware by construction: results automatically exclude items already",
        "surfaced earlier in this conversation, so every call returns genuinely NEW",
        "signal — never duplicates. Repeated calls progressively map the relevant",
        "slice of the knowledge graph, and because results skip what's already been",
        "seen, you never waste tokens re-consuming known material.",
        "",
        "To drill into a menu item, call `search` with a focused natural-language",
        "question.",
    ]
)
"""Description for the ``discover`` retrieval tool.

Leads with what the tool does, then emphasises the window-awareness /
fresh-signal property that makes repeated calls cheap and productive.
LLMs reading this should understand: call ``discover`` any time more
context is needed, not just as the first step."""


MCP_DISCOVER_DESCRIPTION = "\n".join(
    [
        "Ranked menu of items from the user's knowledge graph. Window-aware:",
        "each call returns only items not already surfaced — no duplicates.",
        "",
        "To drill into a menu item, call `search` with a focused natural-language",
        "question.",
    ]
)
"""MCP-specific variant of :data:`DISCOVER_DESCRIPTION`.

Distinct from the SDK variant because the MCP surface drops the
``interpret`` tool (backend-only) — drill-in goes through ``search``.
No auto-fire framing here: that is an SDK / host convention, not an
MCP guarantee."""


INTERPRET_DESCRIPTION = "\n".join(
    [
        "Legacy: prefer `search` with a natural-language question for drill-in.",
        "Returns a 1–2 paragraph brief pinned to specific items picked from",
        "`discover`. Still exposed by SDK adapters for backward compatibility.",
    ]
)
"""Description for the ``interpret`` retrieval tool (legacy — SDK adapters only)."""


SEARCH_DESCRIPTION = "\n".join(
    [
        "Synthesized natural-language answer grounded in the user's knowledge",
        "graph. Phrase the query as a natural-language question, not keywords.",
        "",
        "Hard rule: every user turn must be informed by EITHER the `discover`",
        "menu OR at least one `search` call before you answer.",
    ]
)
"""Description for the ``search`` retrieval tool."""


GET_ORIGIN_DESCRIPTION = "\n".join(
    [
        "Look up source files for one or more canonical entities. Pair with",
        "`discover`: pass the `canonical_ids` from the items you picked, and",
        "get back the files those entities were extracted from. Cheap (no LLM",
        "legs) and meant to be called right before opening a file with your",
        "native read tool.",
        "",
        "A single canonical can span multiple files; each file comes with an",
        "`extraction_count` so you can prefer the file the entity is most",
        "concentrated in.",
    ]
)
"""Description for the ``get_origin`` retrieval tool.

The third leg of the three-step retrieval flow alongside ``discover``
and ``search``: cheap, read-only entity → source-file lookup. Use it
after a ``discover`` call to localize the agent's next action without
paying for another LLM-driven ``search``."""


MCP_GET_ORIGIN_DESCRIPTION = "\n".join(
    [
        "Map canonical_ids (from `discover`) to source files. Cheap, no LLM.",
        "Returns one entry per canonical with the files it was extracted from,",
        "ordered by extraction frequency.",
    ]
)
"""MCP-specific variant of :data:`GET_ORIGIN_DESCRIPTION`.

Same semantics, terser framing — MCP hosts already render tool names
prominently, so the description leads with the action."""


__all__ = [
    "DISCOVER_DESCRIPTION",
    "MCP_DISCOVER_DESCRIPTION",
    "INTERPRET_DESCRIPTION",
    "SEARCH_DESCRIPTION",
    "GET_ORIGIN_DESCRIPTION",
    "MCP_GET_ORIGIN_DESCRIPTION",
]
