# Copass Management Tool Spec — `v1`

Single source of truth for the Copass management tool surface. Both
**read** and **write** tools live under this directory; the backend
Concierge, `@copass/management` (TypeScript), and `copass-management`
(Python) all consume it.

## Surface

`v1/` ships **20 tools**:

- **14 read tools** (Phase 1, `since: "v1"`): `list_sandboxes`,
  `list_sources`, `get_source`, `list_agents`, `get_agent`,
  `list_triggers`, `list_runs`, `get_run_trace`,
  `list_trigger_components`, `list_apps`, `list_connected_accounts`,
  `list_api_keys`, `list_agent_tools`, `list_sandbox_connections`.
- **6 write tools** (Phase 2A, `since: "v1.1"`): `create_agent`,
  `update_agent_prompt`, `update_agent_tools`,
  `update_agent_tool_sources`, `add_user_mcp_source`,
  `wire_integration_to_agent`.

Six destructive / sensitive Concierge tools (key-minting, grant
revocation, etc.) are **CLI-only by policy** and are intentionally
not surfaced here. See the file-header carve-out at
`frame_graph/copass_id/concierge/tools/mutations.py:1-13` and the
inline policy comments at each tool's `ManagementTool` definition.

Eleven additional reversible-write tools (triggers, model settings,
trigger registry, `test_agent`) are deferred to a later spec
release.

## File shape

Every tool has one JSON Schema file at `<tool_name>.json`:

```json
{
  "name":         "<tool_name>",
  "description":  "<LLM-facing prose, redacted of internal vendor names>",
  "inputSchema":  { "...JSON Schema 2020-12..." },
  "outputSchema": { "...JSON Schema 2020-12..." },
  "since":        "v1"
}
```

`name` matches `ToolSpec.name` in
`frame_graph/copass_id/concierge/tools/registry.py`. `inputSchema` mirrors
`ToolSpec.input_schema`. `outputSchema` is authored from the handler's return
shape (the `_project(...)` field lists in `registry.py`).

## Sibling fixtures

For every `<tool>.json` there is a sibling
`examples/<tool>.example.json` of shape:

```json
{
  "input":  { "...sample arguments..." },
  "output": { "...sample response..." }
}
```

Fixtures use realistic-but-synthetic payloads. Real user data, real OAuth
tokens, real internal hostnames, etc. are never permitted. The conformance
test (Phase 1B) loads each fixture and asserts both Zod and Pydantic accept
`input` against `inputSchema` and `output` against `outputSchema`, then diffs
the parsed values for byte-equivalent JSON.

## Versioning

- `v1/` is the current major.
- **In-version-line `since` tags** track which package release first
  shipped a given tool. Phase 1 (read-only) tools are tagged
  `"since": "v1"`. Phase 2A additions ship `"since": "v1.1"`.
  Within a major version line, additions bump the minor (`v1.1`,
  `v1.2`, …) — purely additive, backward-compatible, callers never
  need to migrate.
- A **breaking tool change** is a `v1` → `v2` bump. That requires a
  new `v2/` directory **and** a backend deploy that supports both
  versions during a bounded deprecation window. SDK packages
  declare `min_spec_version` and `max_spec_version` constants so
  callers can pin.
- Non-breaking additions (new optional input fields, new optional
  output fields, new tools) stay inside `v1/` and bump the SDK
  package versions only.

The spec version is **independent of the backend Concierge prompt template
version** (today `copass-concierge-v17`). Prompt evolution and tool-shape
evolution have different cadences.

## Redaction policy

`description` and `inputSchema.description` strings published to SDK consumers
must not contain internal vendor names. The wordlist enforced by
`copass-harness/scripts/lint_redaction.py`:

- `Pipedream`
- `Scalekit`
- `vault` (when used as a vendor / store noun)
- `Highway`
- `Olane internal`
- `MotherDuck`

Generic substitutions: "OAuth provider", "tool-source provider", "managed
secret store", "trigger-provider registry", etc. The spec linter rejects PRs
that introduce a forbidden term into a published string.

## Concierge system prompt — backend-only

The full Concierge system prompt is **not published** as part of this spec.
It is loaded by the hosted Copass platform from a private template and is
not part of the SDK contract. SDK consumers register the same tool surface
defined here and supply their own system prompt for their own agents.

## Conformance contract (Phase 1B)

Phase 1B introduces the Zod (TypeScript) + Pydantic (Python) conformance test
that pins both languages to this directory:

1. For every `<tool>.json` in `v1/`, parse `examples/<tool>.example.json`
   `input` against `inputSchema` and `output` against `outputSchema` in both
   Zod and Pydantic.
2. Round-trip the parsed values to JSON, sort keys, and assert byte-equality
   between languages.
3. Run `scripts/lint_redaction.py` against the corpus.

Failing any step blocks the merge.

## Phase 2A scope (most recent additions)

- Spec files for the 6 write ship-tools listed above.
- Sibling fixtures for each.
- 2 new backend HTTP endpoints (sibling routes, not `UpdateAgentRequest`
  extensions): `PATCH /agents/{slug}/tool-sources` and
  `POST /agents/{slug}/wire-integration`.
- Python `copass-core.AgentsResource.update_tool_sources` and
  `wire_integration` methods + the public `WireIntegrationResult`
  result type (TS + Python parity).
- Audit follow-ups: `json-schema-to-zod` description preservation
  and a real cross-language `conformance_check.sh` diff.

Out of scope (Phase 2B):

- The 6 SDK tool handlers under `@copass/management/src/tools/` and
  `copass-management/src/copass_management/tools/`.
- The conformance test extensions for the 6 new tools.

Out of scope (later phases):

- Backend `tool_resolver.py` swap to spec-driven loading (Phase 3).
- `@copass/mcp` consumer wiring (Phase 4).
- `o-network-cli/src/mcp/server.ts` deprecation (Phase 5).
- Public npm / PyPI publication — gated on per-key API rate limits
  landing first.
