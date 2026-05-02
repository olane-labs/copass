"""Convenience factory for a Copass-wired LangGraph ReAct agent.

Python mirror of ``typescript/packages/langchain/src/agent.ts`` — wires
:func:`copass_tools` + :class:`CopassWindowCallback` (when a window is
supplied) into ``langgraph.prebuilt.create_react_agent``. Returns the
agent with the callback pre-bound via ``agent.with_config(...)``.

``langgraph`` is an **optional** dependency — install with
``pip install copass-langchain[agent]`` to use :func:`create_copass_agent`.
The core :func:`copass_tools` + :class:`CopassWindowCallback` exports
work without it.
"""

from __future__ import annotations

from typing import Any, List, Optional

from copass_core import CopassClient, SearchPreset

from copass_langchain.callback import CopassWindowCallback
from copass_langchain.tools import copass_tools
from copass_langchain.types import ContextWindowLike


def create_copass_agent(
    *,
    client: CopassClient,
    sandbox_id: str,
    llm: Any,
    window: Optional[ContextWindowLike] = None,
    tools: Optional[List[Any]] = None,
    project_id: Optional[str] = None,
    preset: SearchPreset = "copass/1.0",
    include_tool_messages: bool = False,
    **react_agent_options: Any,
) -> Any:
    """Build a LangGraph ReAct agent pre-wired with Copass retrieval.

    Args:
        client: Authenticated :class:`CopassClient`.
        sandbox_id: Sandbox every retrieval call runs against.
        llm: A LangChain chat model instance (``ChatAnthropic(...)``,
            ``ChatOpenAI(...)``, etc.).
        window: Optional :class:`ContextWindowLike`. When supplied, a
            :class:`CopassWindowCallback` is bound so conversation
            history auto-mirrors into the window and retrieval
            becomes window-aware.
        tools: Additional tools to mix in alongside the three Copass
            retrieval tools.
        project_id: Optional project narrowing for retrieval.
        preset: Preset for ``interpret`` / ``search``.
        include_tool_messages: Whether :class:`CopassWindowCallback`
            mirrors tool-result messages. Default ``False``.
        **react_agent_options: Forwarded to
            ``langgraph.prebuilt.create_react_agent`` (e.g.,
            ``checkpointer``, ``state_schema``, ``prompt``).

    Returns:
        A LangChain ``Runnable`` — call ``.ainvoke({"messages": [...]})``.

    Raises:
        ImportError: If ``langgraph`` isn't installed. Install with
            ``pip install copass-langchain[agent]``.

    Example::

        from copass_core import ApiKeyAuth, CopassClient
        from copass_langchain import create_copass_agent
        from langchain_anthropic import ChatAnthropic

        client = CopassClient(auth=ApiKeyAuth(key="olk_..."))
        agent = create_copass_agent(
            client=client,
            sandbox_id="sb_...",
            llm=ChatAnthropic(model="claude-opus-4-7"),
        )
        result = await agent.ainvoke(
            {"messages": [("user", "why is checkout flaky?")]},
        )
    """
    try:
        from langgraph.prebuilt import create_react_agent
    except ImportError as e:
        raise ImportError(
            "create_copass_agent requires `langgraph`. Install with "
            "`pip install copass-langchain[agent]`."
        ) from e

    copass = copass_tools(
        client=client,
        sandbox_id=sandbox_id,
        project_id=project_id,
        window=window,
        preset=preset,
    )

    all_tools: List[Any] = copass.all() + list(tools or [])
    agent = create_react_agent(model=llm, tools=all_tools, **react_agent_options)

    if window is not None:
        callback = CopassWindowCallback(
            window=window,
            include_tool_messages=include_tool_messages,
        )
        return agent.with_config({"callbacks": [callback]})

    return agent


__all__ = ["create_copass_agent"]
