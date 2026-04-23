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
        "signal — never duplicates. This makes `discover` the primary context-",
        "engineering primitive: call it freely whenever you need more context. Repeated",
        "calls progressively map the relevant slice of the knowledge graph, and because",
        "results skip what's already been seen, you never waste tokens re-consuming",
        "known material.",
        "",
        "After calling, pass an item's canonical_ids tuple to `interpret` for a deeper",
        "brief, or call `discover` again for more items.",
    ]
)
"""Description for the ``discover`` retrieval tool.

Leads with what the tool does, then emphasises the window-awareness /
fresh-signal property that makes repeated calls cheap and productive.
LLMs reading this should understand: call ``discover`` any time more
context is needed, not just as the first step."""


MCP_DISCOVER_DESCRIPTION = "\n".join(
    [
        "Return a ranked menu of context items relevant to a query. Each item is a",
        "pointer (canonical_ids + short summary), not prose.",
        "",
        "Window-aware by construction: when a Context Window is active (pre-attached via",
        "COPASS_CONTEXT_WINDOW_ID or created via `context_window_create`), results",
        "automatically exclude items already surfaced earlier in this conversation.",
        "Every call returns genuinely NEW signal — never duplicates.",
        "",
        "This makes `discover` the primary context-engineering primitive: call it",
        "freely whenever you need more context. Repeated calls progressively map the",
        "relevant slice of the knowledge graph, and because results skip what's",
        "already been seen, you never waste tokens re-consuming known material.",
        "",
        "After calling, pass an item's canonical_ids tuple to `interpret` for a deeper",
        "brief, or call `discover` again for more items.",
    ]
)
"""MCP-specific variant of :data:`DISCOVER_DESCRIPTION`.

Identical content plus one clarifying clause about how the server's
Context Window is bound — MCP consumers don't construct a
``ContextWindow`` object themselves, they inherit one via
``COPASS_CONTEXT_WINDOW_ID`` env var or the ``context_window_create``
tool."""


INTERPRET_DESCRIPTION = "\n".join(
    [
        "Return a 1–2 paragraph synthesized brief pinned to specific items picked from",
        "`discover`. Pass one or more canonical_ids tuples (one per item you want to",
        "include). Use this AFTER `discover` when you know which items matter.",
    ]
)
"""Description for the ``interpret`` retrieval tool."""


SEARCH_DESCRIPTION = "\n".join(
    [
        "Return a full synthesized natural-language answer in one call. Use for",
        "self-contained questions that do NOT benefit from a staged discover→interpret flow.",
        "Heaviest of the three tools.",
    ]
)
"""Description for the ``search`` retrieval tool."""


__all__ = [
    "DISCOVER_DESCRIPTION",
    "MCP_DISCOVER_DESCRIPTION",
    "INTERPRET_DESCRIPTION",
    "SEARCH_DESCRIPTION",
]
