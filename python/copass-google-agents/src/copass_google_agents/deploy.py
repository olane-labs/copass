"""``deploy_adk_agent`` — one-time ops helper to deploy an ADK agent.

Vertex AI Agent Engine agents are **pre-deployed resources**, not
created per-run. This helper wraps the deploy flow so developers can
ship an ADK agent with:

- The single ``copass_dispatch`` proxy function tool (see
  :data:`copass_google_agents.DISPATCH_TOOL_NAME`) wired in, pointing
  at the dev's Copass service endpoint.
- A system prompt baked in at deploy time.
- Optional extra MCP toolsets alongside the proxy (e.g. a dev who
  wants a specific MCP server reachable natively from the deployed
  agent, in addition to server-side resolver routing).

Identity / auth model — **no API key is baked into the engine**. The
proxy tool reads ``COPASS_API_URL`` (and optional
``COPASS_DISPATCH_PATH``) from environment variables stamped at deploy
time — those describe the *target* and are not user-secret. The
per-call ``copass_api_key`` flows through the ADK session: the calling
Copass server populates it via
``async_create_session(state={"copass_api_key": ...})`` and the proxy
tool reads it from ``tool_context.state`` on every invocation. This
keeps deployed engines reusable across users and avoids embedding a
long-lived credential in the reasoning-engine resource.

Example::

    from copass_google_agents.deploy import deploy_adk_agent

    engine = deploy_adk_agent(
        display_name="support-agent",
        project="my-gcp-project",
        staging_bucket="gs://my-bucket",
        system_prompt="You are a support agent. Call copass_dispatch "
                      "to invoke any tool available to the current user.",
        copass_api_url="https://api.copass.id",
    )
    print(engine.api_resource.name)
    # projects/.../reasoningEngines/... — feed into
    # CopassGoogleAgent(reasoning_engine_id=...)

Re-deploy is idempotent only in the narrow sense that creating with
the same ``display_name`` produces a *new* resource with a *new*
``reasoning_engine_id``. Manage lifecycle (update/delete) via
``vertexai.Client().agent_engines.update(...)`` /
``.delete(...)`` — not covered by this helper.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Optional

from copass_google_agents._proxy_tool import copass_dispatch
from copass_google_agents.backends.google_agent_backend import (
    DEFAULT_LOCATION,
)

if TYPE_CHECKING:
    from google.auth.credentials import Credentials


logger = logging.getLogger(__name__)


DEFAULT_REQUIREMENTS = [
    "google-cloud-aiplatform[agent_engines,adk]==1.149.0",
    "google-adk==1.32.0",
    "cloudpickle>=3.1.2",
    "pydantic>=2.0.0",
    "httpx>=0.27",
]
"""Minimum pip requirements baked into a deployed Copass agent.
Caller can override via the ``requirements=`` kwarg; these are the
floor when none is supplied."""


def deploy_adk_agent(
    *,
    display_name: str,
    project: str,
    system_prompt: str,
    copass_api_url: str,
    location: str = DEFAULT_LOCATION,
    model: str = "gemini-3.1-pro-preview",
    staging_bucket: Optional[str] = None,
    credentials: "Optional[Credentials]" = None,
    extra_tools: Optional[list[Any]] = None,
    requirements: Optional[list[str]] = None,
    dispatch_path: Optional[str] = None,
    vertex_client: Any = None,
) -> Any:
    """Deploy an ADK agent to Vertex AI Agent Engine.

    No API key is baked in. The deployed engine reads the per-call
    ``copass_api_key`` from ``tool_context.state`` at invocation time;
    the calling Copass server populates it on the ADK session via
    ``async_create_session(state={"copass_api_key": ...})``.

    Args:
        display_name: Human-readable name shown in the GCP console.
        project: GCP project to deploy into.
        system_prompt: System prompt baked into the deployed agent.
            Describe the tools available via ``copass_dispatch`` here
            — the model can't learn them at runtime since the proxy
            takes opaque ``tool_name`` strings.
        copass_api_url: Base URL of the Copass service the
            ``copass_dispatch`` proxy calls back into
            (e.g. ``https://api.copass.id``). Baked in as the
            ``COPASS_API_URL`` env var on the deployed engine.
        location: GCP region. Defaults to :data:`DEFAULT_LOCATION`.
        model: Gemini model id. Defaults to
            ``gemini-3.1-pro-preview`` — the current latest 3.1 Pro
            preview. Bump when 3.x graduates to GA.
        staging_bucket: GCS bucket for ADK agent artifacts
            (``gs://...``). Required by the Agent Engine API when an
            ``agent`` object is supplied; this helper raises upfront
            rather than letting the API surface the error.
        credentials: Optional pre-resolved credentials. When omitted,
            ADC is used.
        extra_tools: Optional additional ADK tool objects to bake in
            *alongside* ``copass_dispatch`` (e.g. MCP toolsets a dev
            wants the agent to use natively, bypassing the proxy).
            Most deployments won't need this.
        requirements: Optional pip requirements list. Defaults to
            :data:`DEFAULT_REQUIREMENTS`.
        dispatch_path: Optional path override for the Copass
            dispatch endpoint. Baked in as ``COPASS_DISPATCH_PATH``.
            Defaults to the proxy tool's built-in default.
        vertex_client: Pre-built ``vertexai.Client`` (injectable for
            tests). When omitted, one is constructed from
            ``project``/``location``/``credentials``.

    Returns:
        The created ``vertexai.agent_engines.AgentEngine`` resource.
        ``.api_resource.name`` (or ``.resource_name`` on newer SDKs)
        is the string to feed into
        :class:`GoogleAgentBackend(reasoning_engine_id=...)`.

    Raises:
        ValueError: If required args are empty or
            ``staging_bucket`` doesn't start with ``gs://``.
    """
    if not display_name:
        raise ValueError("deploy_adk_agent: `display_name` is required")
    if not project:
        raise ValueError("deploy_adk_agent: `project` is required")
    if not system_prompt:
        raise ValueError("deploy_adk_agent: `system_prompt` is required")
    if not copass_api_url:
        raise ValueError("deploy_adk_agent: `copass_api_url` is required")
    if not staging_bucket or not staging_bucket.startswith("gs://"):
        raise ValueError(
            "deploy_adk_agent: `staging_bucket` is required and must "
            "start with 'gs://' (Agent Engine API constraint)"
        )

    from google.adk import Agent
    from vertexai.agent_engines import AdkApp

    # AdkApp reads project/location from vertexai's global config in its
    # constructor, so we must initialize the legacy aiplatform/vertexai
    # entry point BEFORE instantiating the app. The `vertexai.Client`
    # built further down is the newer surface used for `agent_engines.
    # create`, but it doesn't populate `initializer.global_config`.
    import vertexai as _vertexai

    _init_kwargs: dict = {"project": project, "location": location}
    if credentials is not None:
        _init_kwargs["credentials"] = credentials
    _vertexai.init(**_init_kwargs)

    tools: list[Any] = [copass_dispatch]
    if extra_tools:
        tools.extend(extra_tools)

    raw_agent = Agent(
        name="copass_agent",
        model=model,
        instruction=system_prompt,
        tools=tools,
    )
    # Vertex Agent Engine's `agent_engines.create` validates that the
    # supplied agent exposes one of `query`/`async_query`/`stream_query`/
    # `async_stream_query`/`bidi_stream_query`/`register_operations`.
    # `google.adk.Agent` itself doesn't — it's just the tool/instruction
    # graph. AdkApp wraps it into a runnable with `async_stream_query`,
    # which is what `GoogleAgentBackend.stream` calls at invocation time.
    local_agent = AdkApp(agent=raw_agent)

    client = vertex_client
    if client is None:
        import vertexai

        client_kwargs: dict = {"project": project, "location": location}
        if credentials is not None:
            client_kwargs["credentials"] = credentials
        client = vertexai.Client(**client_kwargs)

    env_vars: dict = {
        "COPASS_API_URL": copass_api_url,
    }
    if dispatch_path:
        env_vars["COPASS_DISPATCH_PATH"] = dispatch_path

    config: dict = {
        "display_name": display_name,
        "staging_bucket": staging_bucket,
        "requirements": list(requirements) if requirements else list(DEFAULT_REQUIREMENTS),
        "env_vars": env_vars,
        "agent_framework": "google-adk",
    }

    engine = client.agent_engines.create(agent=local_agent, config=config)
    logger.info(
        "deploy_adk_agent: created Agent Engine resource",
        extra={
            "display_name": display_name,
            "project": project,
            "region": location,
        },
    )
    return engine


DEFAULT_MCP_PROXY_REQUIREMENTS = [
    "google-cloud-aiplatform[agent_engines,adk]==1.149.0",
    "google-adk==1.32.0",
    "cloudpickle>=3.1.2",
    "pydantic>=2.0.0",
    "httpx>=0.27",
    "mcp>=1.0.0",
]
"""Pip requirements baked into a Copass MCP-proxy-backed agent.
Supersets :data:`DEFAULT_REQUIREMENTS` with ``mcp`` (needed by
``google.adk.tools.mcp_tool.McpToolset`` at runtime to open the
streamable-http client to the Copass MCP server)."""


def deploy_adk_agent_with_mcp_proxy(
    *,
    display_name: str,
    project: str,
    system_prompt: str,
    copass_mcp_url: str,
    location: str = DEFAULT_LOCATION,
    model: str = "gemini-3.1-pro-preview",
    staging_bucket: Optional[str] = None,
    credentials: "Optional[Credentials]" = None,
    extra_tools: Optional[list[Any]] = None,
    requirements: Optional[list[str]] = None,
    vertex_client: Any = None,
) -> Any:
    """Deploy an ADK agent wired to the Copass Remote MCP proxy.

    Alternate shape to :func:`deploy_adk_agent` for deployments that
    prefer native MCP tooling over the ``copass_dispatch`` function-tool
    proxy. Instead of baking a custom HTTP-to-dispatch Python function
    into the reasoning engine, this variant baks an
    :class:`google.adk.tools.mcp_tool.McpToolset` that opens a
    streamable-http connection to the Copass MCP server
    (``olane-copass-remote``) on every session.

    The MCP server exposes exactly one tool,
    ``invoke_integration_tool(tool_name, arguments)``, which forwards
    back to the Copass backend's ``/api/v1/agents/dispatch`` endpoint.
    The per-session identity (``user_scope``) is carried as an HTTP
    header — **not** as a tool argument — populated by ADK's
    ``header_provider`` from ``ReadonlyContext.user_id`` on every tool
    execution. That value is the scope-prefixed string our backend
    mints at ``/agents/run`` time via ``scope_to_user_id(scope)`` and
    passes to ``async_create_session(user_id=...)``. Keeping the scope
    in a header (set by ADK runtime, not by the model) removes the
    prompt-injection risk that a static-header + tool-argument layout
    would have exposed.

    Identity / auth model — **no API key is baked into the engine**.
    The bearer token is read at runtime from
    ``readonly_context.state['copass_api_key']`` by the
    ``header_provider`` callable on every tool invocation. The calling
    Copass server populates that key when it creates the ADK session
    (``async_create_session(state={"copass_api_key": ...})``). When the
    state is missing the key, the header_provider returns headers
    WITHOUT an Authorization header — the MCP server will then reject
    with a 401, surfacing a clear authentication error rather than
    silently using a stale, baked-in credential.

    Args:
        display_name: Human-readable name.
        project: GCP project id.
        system_prompt: System prompt baked into the deployed agent.
            Must describe the ``invoke_integration_tool`` calling
            convention (scope-prefixed user id, pd_<app>_<tool>
            tool-name shape). See the script shipped under
            ``scripts/deploy_generalist_adk_agent.py`` for a working
            template.
        copass_mcp_url: Full URL of the Copass MCP streamable-http
            endpoint (e.g. ``https://mcp.copass.com/mcp``). Pass the
            exact ``/mcp`` suffix — ADK doesn't append it.
        location: GCP region.
        model: Gemini model id.
        staging_bucket: GCS bucket for ADK artifacts (``gs://...``).
        credentials: Optional pre-resolved credentials.
        extra_tools: Optional additional ADK tools baked in alongside
            the MCP toolset. Rarely needed — the MCP server is the
            single tool surface by design.
        requirements: Optional pip requirements override. Defaults to
            :data:`DEFAULT_MCP_PROXY_REQUIREMENTS`.
        vertex_client: Pre-built ``vertexai.Client`` (injectable for
            tests).

    Returns:
        The created ``vertexai.agent_engines.AgentEngine`` resource.
    """
    if not display_name:
        raise ValueError("deploy_adk_agent_with_mcp_proxy: `display_name` is required")
    if not project:
        raise ValueError("deploy_adk_agent_with_mcp_proxy: `project` is required")
    if not system_prompt:
        raise ValueError("deploy_adk_agent_with_mcp_proxy: `system_prompt` is required")
    if not copass_mcp_url:
        raise ValueError("deploy_adk_agent_with_mcp_proxy: `copass_mcp_url` is required")
    if not staging_bucket or not staging_bucket.startswith("gs://"):
        raise ValueError(
            "deploy_adk_agent_with_mcp_proxy: `staging_bucket` is required and must "
            "start with 'gs://' (Agent Engine API constraint)"
        )

    from google.adk import Agent
    from google.adk.tools.mcp_tool.mcp_session_manager import (
        StreamableHTTPConnectionParams,
    )
    from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
    from vertexai.agent_engines import AdkApp

    # Initialize vertexai globals before AdkApp construction — see
    # the matching comment in :func:`deploy_adk_agent`.
    import vertexai as _vertexai

    _init_kwargs: dict = {"project": project, "location": location}
    if credentials is not None:
        _init_kwargs["credentials"] = credentials
    _vertexai.init(**_init_kwargs)

    # Build the MCP toolset that connects to the Copass MCP server on
    # each deployed-agent session.
    #
    # Auth + scope propagation via `header_provider` — a callable ADK
    # invokes per tool execution with the session's
    # :class:`ReadonlyContext`. We return:
    #
    #     {
    #       "Authorization": f"Bearer {state['copass_api_key']}",
    #       "x-copass-user-scope": ctx.user_id,   # set by async_create_session
    #     }
    #
    # The API key authenticates the CALLER to the MCP server; it is
    # read from per-session state populated by the calling Copass
    # server at ``async_create_session(state={"copass_api_key": ...})``
    # time — NEVER baked into the deployed engine. ``x-copass-user-
    # scope`` carries the per-session identity the Copass backend
    # minted at ``/agents/run`` time. Because ADK populates the header
    # from ``ReadonlyContext.user_id`` (not from model output), the
    # model cannot forge a different scope via prompt injection or a
    # confused tool-call — the value is outside the LLM's control
    # surface entirely.
    #
    # If session state is missing ``copass_api_key`` (misconfigured
    # caller), the header_provider returns headers WITHOUT an
    # ``Authorization`` entry. The MCP server will reject the request
    # and surface a clear 401, instead of falling back on a stale
    # baked-in credential.
    #
    # See https://github.com/google/adk-python/discussions/2482 for the
    # canonical "per-user tokens to MCP" pattern this follows.

    def _header_provider(readonly_context: Any) -> dict:
        # Auth, scope, and any extra headers all flow from the per-
        # session ``readonly_context.state`` populated by the calling
        # Copass server at ``async_create_session`` time. No closure
        # over deploy-time secrets.
        headers: dict = {}
        state = getattr(readonly_context, "state", None)
        api_key: Optional[str] = None
        sig: Optional[str] = None
        if state is not None and hasattr(state, "get"):
            value = state.get("copass_api_key")
            if value:
                api_key = str(value)
            sig_value = state.get("scope_sig")
            if sig_value:
                sig = str(sig_value)
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        user_id = getattr(readonly_context, "user_id", None)
        if user_id:
            headers["x-copass-user-scope"] = str(user_id)
        if sig:
            # Optional HMAC-based defense-in-depth signature from the
            # backend's ``async_create_session`` state.
            headers["x-copass-scope-sig"] = sig
        return headers

    mcp_toolset = McpToolset(
        connection_params=StreamableHTTPConnectionParams(
            url=copass_mcp_url,
            # No static headers — header_provider owns the full set.
            headers=None,
            timeout=30.0,
        ),
        header_provider=_header_provider,
    )

    tools: list[Any] = [mcp_toolset]
    if extra_tools:
        tools.extend(extra_tools)

    raw_agent = Agent(
        name="copass_agent",
        model=model,
        instruction=system_prompt,
        tools=tools,
    )
    local_agent = AdkApp(agent=raw_agent)

    client = vertex_client
    if client is None:
        import vertexai

        client_kwargs: dict = {"project": project, "location": location}
        if credentials is not None:
            client_kwargs["credentials"] = credentials
        client = vertexai.Client(**client_kwargs)

    # No env_vars needed — this variant has no `_proxy_tool` looking
    # up COPASS_API_URL. The MCP toolset already carries its URL baked
    # into the toolset object's connection_params, which cloudpickles
    # into the deployed engine. The bearer token is sourced per-call
    # from session state (see ``_header_provider`` above), not env vars.
    config: dict = {
        "display_name": display_name,
        "staging_bucket": staging_bucket,
        "requirements": (
            list(requirements) if requirements else list(DEFAULT_MCP_PROXY_REQUIREMENTS)
        ),
        "env_vars": {},
        "agent_framework": "google-adk",
    }

    engine = client.agent_engines.create(agent=local_agent, config=config)
    logger.info(
        "deploy_adk_agent_with_mcp_proxy: created Agent Engine resource",
        extra={
            "display_name": display_name,
            "project": project,
            "region": location,
            "copass_mcp_url": copass_mcp_url,
        },
    )
    return engine


__all__ = [
    "deploy_adk_agent",
    "deploy_adk_agent_with_mcp_proxy",
    "DEFAULT_REQUIREMENTS",
    "DEFAULT_MCP_PROXY_REQUIREMENTS",
]
