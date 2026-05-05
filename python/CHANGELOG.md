# copass — Python lockstep changelog

All Python packages in `python/<pkg>/` ship at a single, lockstep
version sourced from [`python/VERSION`](./VERSION). Each entry below
covers changes across **every** package in this repo at that version.

## 1.0.0 — 2026-05-05

### BREAKING
- `copass_google_agents.deploy.deploy_adk_agent` and `deploy_adk_agent_with_mcp_proxy` no longer accept `copass_api_key=`. The deployed engine no longer bakes a fixed API key — instead, the calling Copass server must populate `state["copass_api_key"]` on the ADK session via `async_create_session(state={...})`. Existing engines deployed under <1.0 keep working until redeployed (their `_proxy_tool` still reads from `os.environ`).
- Per-package `pyproject.toml` files now use dynamic versioning sourced from `python/VERSION` via `[tool.hatch.version] source = "regex"`. The literal `version = "X.Y.Z"` field is removed.

### Bumped baked requirements
- `google-cloud-aiplatform[agent_engines,adk]`: 1.148.1 → 1.149.0
- `google-adk`: 1.31.1 → 1.32.0

### Migration
1. Land 1.0.0 of `copass-google-agents` (and other lockstep-bumped packages).
2. In the calling Copass server, populate ADK session state with `copass_api_key` at session-create time. Without this, deployed engines under 1.0+ cannot authenticate to the Copass MCP / dispatch endpoints.
3. Redeploy engines (e.g., via `scripts/deploy_generalist_adk_agent.py` patched to drop `--copass-api-key`).
4. Switch consumer env vars to point at new engine ids.
