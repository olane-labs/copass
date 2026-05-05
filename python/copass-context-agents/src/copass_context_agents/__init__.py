"""Copass context-engineering primitives for the core agent runtime.

Three provider-neutral pieces every Copass-aware agent composes:

* :func:`copass_retrieval_tools` — ``discover`` / ``interpret`` /
  ``search`` as :class:`AgentTool` instances.
* :func:`copass_ingest_tool` — ``ingest`` as an :class:`AgentTool`.
* :class:`CopassTurnRecorder` — mirror conversation turns into a
  Copass :class:`ContextWindow`.

Sits between :mod:`copass_core_agents` (the ABCs / runtime) and the
per-provider adapter packages
(:mod:`copass_anthropic_agents`, :mod:`copass_google_agents`) which
compose these primitives into their ``run()`` / ``stream()`` loops.
"""

from copass_context_agents.ingest_tool import copass_ingest_tool
from copass_context_agents.retrieval_tools import copass_retrieval_tools
from copass_context_agents.turn_recorder import CopassTurnRecorder

__all__ = [
    "copass_retrieval_tools",
    "copass_ingest_tool",
    "CopassTurnRecorder",
]
