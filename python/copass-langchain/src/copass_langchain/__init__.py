"""LangChain adapters for Copass.

Python mirror of ``@copass/langchain``. Three entry points:

- :func:`copass_tools` — bundle of LangChain ``StructuredTool``
  instances for the three Copass retrieval endpoints
  (``discover`` / ``interpret`` / ``search``).
- :class:`CopassWindowCallback` — a
  ``langchain_core.callbacks.BaseCallbackHandler`` that auto-mirrors
  a chat model's conversation into a Copass Context Window.
- :func:`create_copass_agent` — convenience factory wiring tools +
  callback into ``langgraph.prebuilt.create_react_agent``. Requires
  the ``[agent]`` extra.

The ``ContextWindow`` primitive is deferred in ``copass-core`` v0.1 —
until then, :class:`CopassWindowCallback` and :func:`create_copass_agent`
accept any object satisfying :class:`ContextWindowLike` (``get_turns()``
+ async ``add_turn()``). When ``copass-core`` v0.2 lands
``ContextWindow``, it will satisfy the protocol without changes here.
"""

from copass_langchain.callback import CopassWindowCallback
from copass_langchain.tools import CopassTools, copass_tools
from copass_langchain.types import ContextWindowLike

__version__ = "0.1.0"


def __getattr__(name: str) -> object:
    """Lazy-import :func:`create_copass_agent` so importing the
    package does not pull ``langgraph`` unless the caller actually
    uses the helper."""
    if name == "create_copass_agent":
        from copass_langchain.agent import create_copass_agent

        return create_copass_agent
    raise AttributeError(f"module 'copass_langchain' has no attribute {name!r}")


__all__ = [
    "__version__",
    "copass_tools",
    "CopassTools",
    "CopassWindowCallback",
    "ContextWindowLike",
    "create_copass_agent",
]
