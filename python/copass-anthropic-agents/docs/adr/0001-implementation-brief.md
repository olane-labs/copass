# ADR 0001 — Phase 1 Implementation Brief

- **Source ADR (locked):** `/Users/brendon/Development/olane/copass-harness/.claude/worktrees/managed-agent-v2-phase1/python/copass-anthropic-agents/docs/adr/0001-managed-agent-backend-v2.md`
- **Phase:** 1 — schema + v2 class + tests; no traffic.
- **Worktrees:**
  - **PR-A (schema only):** `/Users/brendon/Development/olane/o-twin-data-pipeline/.claude/worktrees/managed-agent-v2-schema/` — branch `feat/managed-agent-v2-schema` → PR base `staging`.
  - **PR-B (Python code + tests):** `/Users/brendon/Development/olane/copass-harness/.claude/worktrees/managed-agent-v2-phase1/` — branch `feat/managed-agent-v2-phase1` → PR base `main`.
- **Cross-PR independence:** PR-A and PR-B may be implemented and merged in parallel. The Phase 1 deliverable is non-traffic: the schema column is unused by code until Phase 2 wires the runtime; v2 backend code reads/writes through `ProviderBindingRegistry` and the in-memory implementation is sufficient for all Phase 1 tests.

---

## Section 1 — Pre-implementation audit

### 1.1 Reuse map (v1 helper/constant/type → disposition)

| v1 symbol | v1 file:line | Disposition | Rationale |
|---|---|---|---|
| `_normalize_messages` | `managed_agent_backend.py:1125-1153` | KEEP-AS-IS | Pure message-shape adapter; contract unchanged. Move to module-level helper or static method on `ManagedAgentBackendV2`. Skip-non-user behavior preserved (Risk 5). |
| `_session_title` | `managed_agent_backend.py:1156-1160` | KEEP-AS-IS | Pure helper, identity-and-trace concatenation; reused verbatim. |
| `_serialize_tool_result` | `managed_agent_backend.py:1163-1170` | KEEP-WITH-CHANGES | Used only by `CustomToolCall.execute_and_build_reply()`; move into that variant's module (`pending_tool_call.py`) as a private helper. No semantic change. |
| `_build_user_event_for_tool_use` | `managed_agent_backend.py:1173-1220` | REPLACE-WITH-NEW | The string-dispatch ladder is what Decision 2 explicitly removes. Replaced by per-variant `build_reply()` on `CustomToolCall`, `ServerToolCall`, `McpToolCall`. The fallback branch for "unknown source type" disappears — v2's union type forbids the case. |
| `_specs_to_tools` | `managed_agent_backend.py:1078-1123` | KEEP-AS-IS | Tools-payload shape (custom + `mcp_toolset` + builtin) is unchanged in v2. Preserve `effective_tools.list_specs()` ordering (no re-sort) so fingerprint inputs stay deterministic; v1 already sorts implicitly via `list_specs()` and v2 must not regress this. |
| `_fingerprint_agent` | `managed_agent_backend.py:1054-1076` | KEEP-WITH-CHANGES | Algorithm unchanged. Output is the registry's lookup key in addition to driving Anthropic-agent provisioning. Document this dual role in the docstring. Sort stability of `effective_tools.list_specs()` is load-bearing (Risk 4). |
| `_TOOL_USE_EVENT_TYPES` | `managed_agent_backend.py:133-146` | REPLACE-WITH-NEW | Replaced by the `PendingToolCall` union; the three envelope strings live as class-level constants on each variant for parser routing. Tests that assert "the three envelopes are recognized" repoint to `isinstance(call, (CustomToolCall, ServerToolCall, McpToolCall))` on a synthetic SSE event. |
| `_IDLE_EVENT_TYPES` | `managed_agent_backend.py:153-156` | KEEP-AS-IS | Stream parser still needs the SDK-vs-thread-scoped alias set. Move to a stream-parser submodule (e.g. `_stream_event_types.py`) shared by v2's stream loop. |
| `_TERMINATED_EVENT_TYPES` | `managed_agent_backend.py:158-161` | KEEP-AS-IS | Same as `_IDLE_EVENT_TYPES`. |
| `_KNOWN_NOOP_EVENT_TYPES` | `managed_agent_backend.py:168-183` | KEEP-AS-IS | Lifecycle / observability allowlist; reused verbatim. |
| `DEFAULT_ENVIRONMENT_CONFIG` | `managed_agent_backend.py:71-74` | KEEP-AS-IS | Out of scope per Decision 8 (environment-config defaults unchanged). Re-export from the v2 module so adopters can import from either v1 or v2 location. |
| `DEFAULT_GATEWAY_MCP_URL` | `managed_agent_backend.py:115-122` | KEEP-AS-IS | ADR 0029 invariant; v2 inherits unchanged. |
| `DEFAULT_GATEWAY_MCP_NAME` | `managed_agent_backend.py:125-130` | KEEP-AS-IS | Same as `DEFAULT_GATEWAY_MCP_URL`. |
| `SESSION_ID_HANDLE` | `managed_agent_backend.py:77-82` | KEEP-AS-IS | Caller-side handle name; preserve string value (`"managed_agent_session_id"`) for backward compat across both backends running in parallel. |
| `VAULT_IDS_HANDLE` | `managed_agent_backend.py:85-101` | KEEP-AS-IS | Same — preserve string value (`"managed_agent_vault_ids"`). |
| `USE_GATEWAY_MCP_HANDLE` | `managed_agent_backend.py:104-112` | KEEP-AS-IS | Same — preserve string value (`"managed_agent_use_gateway_mcp"`). |
| `name` vs `tool_name` extra-kwarg convention | `managed_agent_backend.py:478-484, 800-803` | KEEP-AS-IS | Documented load-bearing detail: `name` collides with `LogRecord.name` and raises `KeyError` at log time. v2's logging in `RequiresActionCycle.calls()` and `PendingToolCall.execute_and_build_reply()` MUST use `tool_name`. |
| `_rehydrate_pending_tool_events` | `managed_agent_backend.py:739-813` | DELETE | The prod failure's root cause (Decision 2). No equivalent in v2 — `events.list()` is never called during a live stream. |
| `_send_events_soft` | `managed_agent_backend.py:889-931` | DELETE | v1-only soft-error wrapper. v2's send path lives on `RequiresActionCycle.send_replies()` and distinguishes `BadRequestError` from transient 5xx via typed exception (Risk 6). |
| `_execute_pending_tools` | `managed_agent_backend.py:815-887` | DELETE | Helper folded into per-variant `PendingToolCall.execute_and_build_reply()`. The `src_type != "agent.custom_tool_use"` confirm-only branch becomes `ServerToolCall.build_reply()` / `McpToolCall.build_reply()`; the local-execute branch becomes `CustomToolCall.execute_and_build_reply()`. |

### 1.2 Parent-class fit

`ManagedAgentBackendV2` subclasses `AgentBackend` from `copass_core_agents.backends.base_backend` (declared at `base_backend.py:47-84`). It implements both abstract methods:

| ABC method | v2 method | Signature compatibility |
|---|---|---|
| `async def run(agent, messages, context) -> AgentRunResult` (`base_backend.py:64-73`) | `async def run(agent, messages, context) -> AgentRunResult` | Direct match; reuses v1's `run()` body verbatim (drains `stream()` into a reduced result). |
| `def stream(agent, messages, context) -> AsyncIterator[AgentEvent]` (`base_backend.py:75-84`) | `async def stream(agent, messages, context) -> AsyncIterator[AgentEvent]` (async-generator using `yield`) | **See ABC-shape note below.** Python accepts an async-generator method as the implementation of a `def`-returning-`AsyncIterator` ABC method. No `# type: ignore` required. Risk 1 resolution: document the pattern at the top of `managed_agent_backend_v2.py` so future agents don't refactor it back to `async def stream(...) -> AsyncIterator[...]: return self._stream_impl(...)` (which is wrong — the ABC expects a generator-shaped method, not a method that returns one). |

### 1.3 Billing & Cost Impact

- **Phase 1 introduces no new paid call surfaces.** `ManagedAgentBackendV2.stream()` calls Anthropic's managed-agents API exactly where v1 does today — `agents.create`, `environments.create`, `sessions.create`, `sessions.events.stream`, `sessions.events.send`. The credit-gate `reserve`/`settle` lifecycle lives in `PassthroughRuntime` (`frame_graph/copass_id/agents/runtime.py`), not in the backend. v2 has the same call shape as v1 from `PassthroughRuntime`'s perspective.
- **Decision 3's CAS UPDATE *reduces* a known cost-surprise vector** documented in CLAUDE.md and ADR §1.2: v1's in-process `_agent_ids` cache races on warmup → N orphan `agents.create` calls per fingerprint revision across N pods on every deploy. v2's `ProviderBindingRegistry.get_or_provision()` collapses this to at most one `agents.create` per fingerprint revision across the whole fleet. This is a positive billing side-effect; flag it in the PR-B description.
- **No new gate path is anticipated for Phase 2.** When `PassthroughRuntime` flips to v2 (Phase 2 of the ADR), the existing `CreditGate.reserve(...)` → `... await backend.stream(...) ...` → `settle()` wrap already in place at `frame_graph/copass_id/agents/runtime.py` continues to wrap v2's `stream()` unchanged. The runtime PR (out of scope for Phase 1) handles ledger-row attribution via `agent_runs.credit_transaction_id` per CLAUDE.md "Billing — every paid call goes through the credit gate".
- **Per-surface posture unchanged.** Triggered / autonomous calls share the same `config.stripe.gate_mode` as user-initiated calls. Phase 1 changes nothing here.

### 1.4 Per-test classification (file-level edits)

From ADR §7 plus the four affected test-import blocks. **All four test files require their `from copass_anthropic_agents.backends.managed_agent_backend import (...)` block rewritten to point at v2.** Line ranges below match the file as it stands in the PR-B worktree.

| Test file | Lines to edit | New import block target | Notes |
|---|---|---|---|
| `tests/test_managed_agent_backend.py` | `:19-25` | Replace import of `_IDLE_EVENT_TYPES`, `_KNOWN_NOOP_EVENT_TYPES`, `_TERMINATED_EVENT_TYPES`, `_TOOL_USE_EVENT_TYPES`, `_build_user_event_for_tool_use` with imports from `copass_anthropic_agents.backends.managed_agent_backend_v2` (event-type sets) and from `copass_anthropic_agents.backends.pending_tool_call` (`CustomToolCall`, `ServerToolCall`, `McpToolCall`). The `_TOOL_USE_EVENT_TYPES` assertion (`:216-218`) asserts the three variants are members of the `PendingToolCall` union (use `typing.get_args(PendingToolCall) == (CustomToolCall, ServerToolCall, McpToolCall)` or an equivalent check). | The `test_build_user_event_for_unknown_source_does_not_raise` test (`:194-208`) flips to `pytest.raises(TypeError)` per ADR §7 (unknown envelope is a programmer error in v2). |
| `tests/test_mcp_tool_use_handler.py` | `:17-20` | Replace import of `_TOOL_USE_EVENT_TYPES`, `_build_user_event_for_tool_use` with import of `McpToolCall` from `copass_anthropic_agents.backends.pending_tool_call`. | Single assertion: `McpToolCall(event_id="sevt_mcp_handler_1", name="x").build_reply()` returns `{"type": "user.tool_confirmation", "tool_use_id": "sevt_mcp_handler_1", "result": "allow"}`. |
| `tests/test_gateway_wiring.py` | `:23-26` | Replace import of `DEFAULT_GATEWAY_MCP_NAME`, `DEFAULT_GATEWAY_MCP_URL` with imports of the same names from `copass_anthropic_agents.backends.managed_agent_backend_v2`. The `ManagedAgentBackend` import (`:17-22`) is renamed to `ManagedAgentBackendV2`; constructor calls take a `registry=InMemoryProviderBindingRegistry()` kwarg. | The `_DummyTool` fixture (`:29-…`) carries over unchanged. |
| `tests/test_bearer_mint.py` | `:25-27` | Replace import of `VAULT_IDS_HANDLE` from `managed_agent_backend` with import from `managed_agent_backend_v2`. The `ManagedAgentBackend` import (`:24`) flips to `ManagedAgentBackendV2`; `_make_backend()` (`:30-31`) gains `registry=InMemoryProviderBindingRegistry()`. | The "VAULT_IDS_HANDLE re-export from top-level" assertion (`:113-115`) is **dropped for Phase 1** per Q2: v2 is not exported from `copass_anthropic_agents/__init__.py` in Phase 1. Re-add this assertion in Phase 4 when v2 becomes the only export. |

The remaining repointed-v1 tests in ADR §7's table (`test_normalize_messages_*`, `test_specs_to_tools_*`, `test_fingerprint_*`, `test_build_user_event_for_*`, `test_*_event_types_*`) are all inside `test_managed_agent_backend.py` and are covered by the single import-block rewrite above plus method-name redirection (`backend._normalize_messages` etc. are class methods or static helpers on `ManagedAgentBackendV2`).

The v1-only tests slated for deletion (`test_send_events_soft_*`, `test_rehydrate_*`, `test_execute_pending_tools_*`) **are not deleted in Phase 1.** Phase 1 keeps v1 intact and on-by-default, so its tests stay green. Deletion happens in Phase 4 of the ADR (v1 removal).

---

## Section 2 — PR-B file-by-file plan (Python code + tests)

Worktree root: `/Users/brendon/Development/olane/copass-harness/.claude/worktrees/managed-agent-v2-phase1/`. All paths below are absolute.

### Tier 1 — Foundations (leaves; no project-internal deps)

#### `python/copass-anthropic-agents/src/copass_anthropic_agents/backends/_stream_event_types.py` [CREATE]

**Purpose:** Shared frozen-set constants for SSE stream-event-type membership tests, shared between v1 and v2 stream parsers.

**Public symbols:** `_IDLE_EVENT_TYPES: frozenset[str]`, `_TERMINATED_EVENT_TYPES: frozenset[str]`, `_KNOWN_NOOP_EVENT_TYPES: frozenset[str]`. (Signatures verbatim from v1 `managed_agent_backend.py:153-183`.)

**Notes:** Pure constants. v1 currently defines these inline; v2 imports them from here so the two implementations cannot drift. v1 retains its inline copies for Phase 1 (no cross-cutting changes to v1 code in PR-B) — they can be redirected to import from this module in a follow-up cleanup, but Phase 1 does not require it.

### Tier 2 — Contracts (ABCs / protocols / sealed unions; depend on Tier 1)

#### `python/copass-anthropic-agents/src/copass_anthropic_agents/backends/pending_tool_call.py` [CREATE]

**Purpose:** Sealed union representing the three Anthropic tool-use envelopes (`agent.custom_tool_use`, `agent.tool_use`, `agent.mcp_tool_use`) with per-variant reply-builder methods.

**Public symbols:** signatures verbatim from ADR §4. `CustomToolCall(event_id, name, arguments)` with `async def execute_and_build_reply(tools, context) -> dict`; `ServerToolCall(event_id, name)` with `def build_reply() -> dict`; `McpToolCall(event_id, name)` with `def build_reply() -> dict`; `PendingToolCall = Union[CustomToolCall, ServerToolCall, McpToolCall]`.

**Notes:** Each variant is `@dataclass(frozen=True)`. `CustomToolCall.execute_and_build_reply()` folds in `_serialize_tool_result` (moved from v1's module) and the tool-resolution/invocation/error-handling logic from v1's `_execute_pending_tools` (`managed_agent_backend.py:815-887`) — but only the local-execute branch. The confirm-only branch becomes a one-liner on `ServerToolCall` / `McpToolCall`. Logging in `execute_and_build_reply` uses `tool_name`, not `name`, per the `LogRecord.name` collision documented at v1 `:478-484`.

#### `python/copass-anthropic-agents/src/copass_anthropic_agents/backends/requires_action_cycle.py` [CREATE]

**Purpose:** Per-cycle state object that scopes reply construction to a single `requires_action`'s server-authoritative `event_ids`. Refuses (at construction or enqueue) to accept ids from prior cycles. This is the type-level guard the prod failure exposed as missing.

**Public symbols:** signatures verbatim from ADR §4. `RequiresActionCycle(cycle_id: str, requested_ids: frozenset[str], executed_ids: set[str])`; `calls(events_by_id: dict[str, PendingToolCall]) -> list[PendingToolCall]`; `async send_replies(client, session_id, replies)`.

**Notes:** `calls()` raises (don't return) when a requested id is not in `events_by_id` — the v2 backend catches the raise, POSTs `user.interrupt`, and yields `AgentFinish(error)`. `send_replies()` validates each `reply["custom_tool_use_id"]` / `reply["tool_use_id"]` is a member of `requested_ids` before the POST; mismatch raises a TypeError / programmer-error exception. This is the structural guarantee Decision 2 calls out: replies cannot be constructed for ids from a prior cycle. `BadRequestError` from the POST propagates upward (caller catches and emits `AgentFinish(error)`); transient 5xx is not handled here per ADR's out-of-scope list.

#### `python/copass-anthropic-agents/src/copass_anthropic_agents/backends/backend_run_policy.py` [CREATE]

**Purpose:** Per-run bounds dataclass (max cycles, per-cycle timeout, total timeout). Passed at construction.

**Public symbols:** signature verbatim from ADR §4. `@dataclass(frozen=True) class BackendRunPolicy(max_cycles: int, cycle_timeout_s: float, total_timeout_s: float)`; `@classmethod default() -> BackendRunPolicy` returning `(20, 60.0, 300.0)`.

**Notes:** `default()` values are locked by Decision 4. Policy enforcement is split: `max_cycles` is checked in the stream-loop wrapper; `cycle_timeout_s` is enforced via `asyncio.wait_for` around the SSE buffering wait for a `requires_action`'s pending events; `total_timeout_s` wraps the entire `stream()` body **including the `finally` cleanup** per Risk 8.

#### `python/copass-anthropic-agents/src/copass_anthropic_agents/backends/provider_binding_registry.py` [CREATE]

**Purpose:** Protocol + value type for race-safe persisted identity mapping (Anthropic `agent_id` / `environment_id` keyed by `(user_id, agent_id, provider, for_version)`). Defines the seam the runtime implements in either of two ways (MySQL CAS, in-memory dict).

**Public symbols:** signatures verbatim from ADR §4. `class ProviderBindingRegistry(Protocol)` with `async get_binding(user_id, agent_id, provider, for_version) -> Optional[ProviderBinding]` and `async get_or_provision(user_id, agent_id, provider, for_version, provision) -> ProviderBinding`; `@dataclass(frozen=True) class ProviderBinding(agent_id, environment_id, for_version, provisioned_at)`.

**Notes:** `provider` is a string (`"anthropic_managed"` is the only value in Phase 1) so future bindings (OpenAI Responses) can live in the same JSON object. `provisioned_at` is ISO-8601 UTC (string, not datetime) so it serializes/deserializes through JSON without TZ handling. The `provision: Callable[[], Awaitable[ProviderBinding]]` parameter is invoked exactly once across racing callers — the registry implementation is responsible for the once-only contract.

### Tier 3 — Implementations (concrete classes; depend on Tiers 1-2)

#### `python/copass-anthropic-agents/src/copass_anthropic_agents/backends/in_memory_provider_binding_registry.py` [CREATE]

**Purpose:** In-process dict-backed implementation of `ProviderBindingRegistry`. The default for library adopters without the Copass MySQL schema. Race-safe via `asyncio.Lock` per `(user_id, agent_id, provider)` tuple. **This is the implementation Phase 1 tests run against** — the MySQL implementation is not exercised by CI in Phase 1.

**Public symbols:** `class InMemoryProviderBindingRegistry(ProviderBindingRegistry)` with the two protocol methods plus a no-arg `__init__`. (Conform to ADR §4's signatures.)

**Notes:** Lock map: `dict[tuple[str, str, str], asyncio.Lock]` keyed by `(user_id, agent_id, provider)`. `get_or_provision` acquires the lock, re-reads under the lock (matches MySQL CAS semantics — loser-of-race re-reads and gets the winner's binding), invokes `provision()` on miss, stores, releases. `for_version` cache-miss (Test #4) is handled by treating "stored binding with `for_version < requested_for_version`" as a miss → re-provision → overwrite.

#### `python/copass-anthropic-agents/src/copass_anthropic_agents/backends/mysql_provider_binding_registry.py` [CREATE]

**Purpose:** MySQL implementation backed by the `copass_agents.provider_bindings` JSON column (added by PR-A). Provides cross-process race-safety via the CAS UPDATE pattern from ADR §3. **Not exercised by Phase 1 CI** — gated by an integration test that requires staging DB (see §4 Test plan + Q8).

**Public symbols:** `class MysqlProviderBindingRegistry(ProviderBindingRegistry)` with the two protocol methods plus an `__init__(pool)` taking the MySQL pool/connection-source (concrete pool type left to the runtime to inject; the registry accepts anything with the expected `acquire()` async context manager shape).

**Notes:** Per Q1, the MySQL driver (`aiomysql` / `pymysql` / whichever the repo standardizes on) is imported lazily inside method bodies, mirroring v1's `AsyncAnthropic` pattern at `managed_agent_backend.py:292-295`. Type hints reference the driver via `TYPE_CHECKING` only. Library adopters who don't install the driver never trigger an import error at module load. SELECT uses `JSON_EXTRACT(provider_bindings, '$.anthropic_managed.*')` for the read; UPDATE is the CAS UPDATE verbatim from ADR §3 (the `JSON_EXTRACT(...) < :version` clause is what makes the loser-of-race re-read deterministic). `rows_affected == 0` → re-SELECT and return the winner's binding. **No DDL is performed by this class** — it assumes PR-A has shipped the column.

#### `python/copass-anthropic-agents/src/copass_anthropic_agents/backends/managed_agent_backend_v2.py` [CREATE]

**Purpose:** The v2 backend. Stream-first server-authoritative cycle model; stateless across invocations; delegates identity resolution to `ProviderBindingRegistry`; delegates per-call reply construction to `PendingToolCall` variants and `RequiresActionCycle`. Implements `AgentBackend`.

**Public symbols:** `class ManagedAgentBackendV2(AgentBackend)`. Constructor per the ADR §3 architecture box:

```
ManagedAgentBackendV2(
  *, client: AsyncAnthropic | None = None,
  api_key: str | None = None,
  registry: ProviderBindingRegistry,
  policy: BackendRunPolicy = BackendRunPolicy.default(),
  environment_config: dict | None = None,
  environment_name: str = "copass-agents-env",
  include_builtin_toolset: bool = False,
  delete_session_on_finish: bool = False,
  use_gateway_mcp: bool = False,
  gateway_mcp_url: str = DEFAULT_GATEWAY_MCP_URL,
  gateway_mcp_name: str = DEFAULT_GATEWAY_MCP_NAME,
  config: dict | None = None,
)
```

`async run(agent, messages, context) -> AgentRunResult` (reuses v1's body verbatim — drains `stream()`). `async def stream(agent, messages, context) -> AsyncIterator[AgentEvent]` (async-generator). Re-exports: `DEFAULT_ENVIRONMENT_CONFIG`, `DEFAULT_GATEWAY_MCP_URL`, `DEFAULT_GATEWAY_MCP_NAME`, `SESSION_ID_HANDLE`, `VAULT_IDS_HANDLE`, `USE_GATEWAY_MCP_HANDLE`, `_IDLE_EVENT_TYPES`, `_TERMINATED_EVENT_TYPES`, `_KNOWN_NOOP_EVENT_TYPES`.

**Notes:**

- Constructor has **no** `self._agent_ids: dict` and **no** `self._environment_id: Optional[str]`. Decision 3's stateless invariant.
- `stream()` builds a local `events_by_id: dict[str, PendingToolCall]` from `agent.*_tool_use` SDK events as they arrive. The parser switches by `evt_type` and constructs the right variant (`CustomToolCall(event_id, name, arguments=dict(input))` / `ServerToolCall(event_id, name)` / `McpToolCall(event_id, name)`).
- On `requires_action`, the loop builds a `RequiresActionCycle(cycle_id=evt_id, requested_ids=frozenset(stop.event_ids), executed_ids=set())`. `cycle.calls(events_by_id)` returns the resolved `PendingToolCall` list; any miss raises and the caller POSTs `user.interrupt` + yields `AgentFinish(error)`. **There is no `events.list()` call here.**
- After `cycle.calls()` returns, the loop iterates, calling `call.execute_and_build_reply(tools, context)` (or `call.build_reply()` for server/MCP) to collect reply envelopes, yields `AgentToolCall` / `AgentToolResult` for each, then `await cycle.send_replies(self._client, session_id, replies)`.
- `BadRequestError` is imported lazily from `anthropic` inside the `try/except` around `cycle.send_replies()` per Q5: mirror v1's `AsyncAnthropic` lazy-import (`managed_agent_backend.py:292-295`) — also acceptable to use `TYPE_CHECKING` for type hints + a `try: from anthropic import BadRequestError; except ImportError: BadRequestError = Exception` shim at module scope (the latter is cleaner; both are acceptable). The brief recommends the `TYPE_CHECKING` + try/except pattern. On `BadRequestError`, the cycle is terminal — POST `user.interrupt`, yield `AgentFinish(error)`, break. Transient 5xx is **not** specially handled in Phase 1 (ADR §8 Decision 8 leaves cross-region failover / retries out of scope).
- Provisioning: at the top of `stream()`, after `effective_tools = await agent.build_tools(context)` and after computing `fingerprint = self._fingerprint_agent(agent, effective_tools, use_gateway_mcp=use_gateway_mcp)`, the backend calls `binding = await self._registry.get_or_provision(user_id=..., agent_id=agent.identity, provider="anthropic_managed", for_version=<see Risk 3>, provision=self._provision_anthropic_agent)`. `_provision_anthropic_agent` is a closure that calls `self._client.beta.agents.create(...)` + `self._client.beta.environments.create(...)` and returns a `ProviderBinding`. (For Phase 1, Risk 3's open question on `copass_agents.version` semantics stays open — Phase 1 tests use a stub `for_version=1`; the runtime wiring in Phase 2 resolves the value from the `copass_agents` row.)
- ABC-stream pattern: the method is declared `async def stream(...)` with `yield` statements (Python async generator). It implements `AgentBackend.stream`'s `def → AsyncIterator[AgentEvent]` declaration. Python accepts this. **Do not refactor to `async def stream(...) -> AsyncIterator[AgentEvent]: return self._stream_impl(...)` — that breaks the generator semantics callers rely on.** Document the pattern at the top of the module.
- Policy enforcement: wrap the entire `stream()` body in `async with asyncio.timeout(self._policy.total_timeout_s):` (Python 3.11+) **including the `finally` block** per Risk 8. The per-cycle wait for SSE events to populate `events_by_id` for `requires_action`'s requested ids is bounded by `asyncio.wait_for(..., timeout=self._policy.cycle_timeout_s)`. Cycle count is tracked in a local `cycle_count: int`; on `cycle_count >= self._policy.max_cycles`, yield `AgentFinish(error)` with a `policy_max_cycles_exhausted` reason.

#### `python/copass-anthropic-agents/src/copass_anthropic_agents/backends/__init__.py` [EDIT]

**Purpose:** Add v2 to the sub-module exports. Top-level `copass_anthropic_agents/__init__.py` is **not** edited in Phase 1 (Q2 — v2 stays out of the top-level namespace until Phase 4).

**Notes:** Append imports of `ManagedAgentBackendV2`, `BackendRunPolicy`, `ProviderBindingRegistry`, `ProviderBinding`, `InMemoryProviderBindingRegistry`, `MysqlProviderBindingRegistry`, the `PendingToolCall` union and its three variants, and `RequiresActionCycle`. Extend `__all__` with the same names. v1's `ManagedAgentBackend` export stays.

### Tier 4 — Wiring (no Phase 1 wiring)

Phase 1 ships zero wiring changes. The runtime (`PassthroughRuntime` at `frame_graph/copass_id/agents/runtime.py`, repo `o-twin-data-pipeline`) continues to instantiate v1. Phase 2 of the ADR is where the runtime adds the env-var gated v2 instantiation; that work is **out of scope for both PR-A and PR-B in Phase 1**.

### Tier 5 — Tests

All test files live at `/Users/brendon/Development/olane/copass-harness/.claude/worktrees/managed-agent-v2-phase1/python/copass-anthropic-agents/tests/`.

#### `tests/test_managed_agent_backend.py` [EDIT]

Rewrite the import block at `:19-25` per §1.4. Method-level redirections (`backend._normalize_messages` → `ManagedAgentBackendV2(...)._normalize_messages` etc.) per the same section.

Tests that change semantically:

| Test function | Change |
|---|---|
| `test_build_user_event_for_custom_tool_use_returns_custom_result` (`:155-167`) | Replace `_build_user_event_for_tool_use(source_type="agent.custom_tool_use", ...)` call with `CustomToolCall(event_id="...", name="...", arguments={}).execute_and_build_reply(...)` — note this is async and exercises tool invocation, so the test gains a stub `AgentToolRegistry`/`AgentInvocationContext` fixture. Alternative: add a unit-level `build_reply_from_result(...)` helper to `CustomToolCall` to assert the envelope shape without invoking. The brief recommends the helper. |
| `test_build_user_event_for_mcp_tool_use_returns_confirmation` (`:169-180`) | Replace with `McpToolCall(event_id="sevt_mcp_1", name="x").build_reply()` returns `{"type": "user.tool_confirmation", "tool_use_id": "sevt_mcp_1", "result": "allow"}`. |
| `test_build_user_event_for_builtin_tool_use_returns_confirmation` (`:182-192`) | Replace with `ServerToolCall(event_id="sevt_builtin_1", name="bash").build_reply()` returns the same shape. |
| `test_build_user_event_for_unknown_source_does_not_raise` (`:194-208`) | **Rename to `test_unknown_envelope_is_a_type_error`.** Assert `pytest.raises(TypeError)` (or whichever exception the union refuses construction with — `TypeError` is idiomatic). v2 explicitly rejects unknown envelopes; ADR §7 mandates this flip. |
| `test_tool_use_event_types_include_all_three_envelopes` (`:216-218`) | Replace with `from typing import get_args; assert set(get_args(PendingToolCall)) == {CustomToolCall, ServerToolCall, McpToolCall}`. |
| All `test_normalize_messages_*`, `test_specs_to_tools_*`, `test_fingerprint_*` (`:48-145`) | Method-name redirection only. Assertions unchanged. |
| All `test_*_event_types_*` (`:225-…`) | Import targets repointed to `_stream_event_types.py`. Assertions unchanged. |

#### `tests/test_mcp_tool_use_handler.py` [EDIT]

Rewrite the import block at `:17-20` per §1.4. The single test `test_mcp_tool_use_returns_user_tool_confirmation_allow` collapses to a one-line assertion on `McpToolCall("sevt_mcp_handler_1", "x").build_reply()`.

#### `tests/test_gateway_wiring.py` [EDIT]

Rewrite the import block at `:23-26` per §1.4. The `ManagedAgentBackend` reference at `:20` (inside the larger top-level import block at `:17-22`) flips to `ManagedAgentBackendV2`. Constructor calls in test bodies add `registry=InMemoryProviderBindingRegistry()`. Assertions on `tools[0]["mcp_server_name"] == DEFAULT_GATEWAY_MCP_NAME` (`:81`, `:186`, `:188`, `:193`) unchanged — `_specs_to_tools` shape is preserved.

#### `tests/test_bearer_mint.py` [EDIT]

Rewrite the import block at `:25-27` per §1.4. The `ManagedAgentBackend` reference at `:24` flips to `ManagedAgentBackendV2`. `_make_backend()` (`:30-31`) adds `registry=InMemoryProviderBindingRegistry()`. **Drop the top-level re-export assertion at `:113-115`** for Phase 1 (Q2); track a follow-up to re-add it in Phase 4 when v2 becomes the only export.

#### `tests/test_pending_tool_call.py` [CREATE]

**Purpose:** Unit tests for the sealed-union variants and their reply builders. Covers ADR §7 net-new tests #5 (cycle-barrier enforcement is a separate file — `test_requires_action_cycle.py`); this file covers per-variant reply shapes and the union's refusal to accept an unknown envelope construction-time.

**Test functions:**

| Function | Assertion |
|---|---|
| `test_custom_tool_call_executes_and_builds_custom_result` | Stub `AgentToolRegistry` with a tool returning `{"k": "v"}`; assert `CustomToolCall(...).execute_and_build_reply(...)` returns `{"type": "user.custom_tool_result", "custom_tool_use_id": "...", "content": [{"type": "text", "text": ...}]}` and the serialized text payload contains `{"result": {"k": "v"}}`. |
| `test_custom_tool_call_records_tool_invocation_error` | Stub tool raises; assert the envelope carries `"error"` in the serialized text. |
| `test_custom_tool_call_coerces_non_dict_result` | Stub tool returns `"oops"`; assert the envelope text contains `{"result": {"value": "oops"}}`. Matches v1 `:880-885`. |
| `test_server_tool_call_build_reply_returns_confirmation_allow` | `ServerToolCall("sevt", "bash").build_reply() == {"type": "user.tool_confirmation", "tool_use_id": "sevt", "result": "allow"}`. |
| `test_mcp_tool_call_build_reply_returns_confirmation_allow` | `McpToolCall("sevt", "x").build_reply() == {"type": "user.tool_confirmation", "tool_use_id": "sevt", "result": "allow"}`. |

#### `tests/test_requires_action_cycle.py` [CREATE]

**Purpose:** Cycle-barrier and stale-rehydrate-resistance tests. Maps to ADR §7 net-new tests **#1 (stale-rehydrate-resistance)** and **#5 (cycle-barrier enforcement)**.

**Test functions:**

| Function | Assertion |
|---|---|
| `test_cycle_refuses_construction_for_empty_requested_ids` | (Optional sanity check.) `RequiresActionCycle("c1", frozenset(), set())` — define whether construction is valid or raises. Brief recommendation: allow empty (degenerate case). |
| `test_cycle_calls_raises_when_event_id_not_in_events_by_id` | Construct `RequiresActionCycle("c1", frozenset({"sevt_a"}), set())`; call `.calls({"sevt_b": <stub>})` and assert it raises (e.g. `LookupError` / a custom `MissingPendingToolCallError`). This is ADR §7 test **#1** — the assertion v1 lacked. Pair this with a `test_v1_rehydrate_path_does_not_exist_in_v2` smoke that just confirms `getattr(ManagedAgentBackendV2, "_rehydrate_pending_tool_events", None) is None`. |
| `test_cycle_send_replies_refuses_reply_for_unrequested_id` | Construct cycle with `requested_ids={"sevt_a"}`; build a fake reply envelope with `custom_tool_use_id="sevt_b"`; assert `cycle.send_replies(...)` raises before any client POST. ADR §7 test **#5**. |
| `test_cycle_send_replies_posts_when_ids_match` | Construct cycle with `requested_ids={"sevt_a"}`; build a reply with `custom_tool_use_id="sevt_a"`; stub `client.beta.sessions.events.send`; assert it was called once with the reply. |

#### `tests/test_provider_binding_registry.py` [CREATE]

**Purpose:** Race-safety tests for `InMemoryProviderBindingRegistry`. Maps to ADR §7 net-new tests **#3 (cross-process duplicate-create resistance, in-memory mirror)** and **#4 (for_version cache miss on version bump)**.

**Test functions:**

| Function | Assertion |
|---|---|
| `test_get_or_provision_is_atomic_under_concurrency` | Spawn two coroutines that call `registry.get_or_provision(...)` with the same `(user_id, agent_id, provider, for_version)` and a `provision` lambda that increments a counter and returns a `ProviderBinding(agent_id=f"agent_{counter}", ...)`. Assert: (a) `provision` was invoked exactly once, (b) both coroutines receive the same `agent_id` value, (c) registry's internal map has exactly one entry for the key. ADR §7 test **#3** (in-memory). |
| `test_get_or_provision_invokes_provision_on_version_bump` | Pre-populate registry with binding for `for_version=12`. Call `get_or_provision(..., for_version=13, provision=...)`; assert `provision` was invoked (not reused), the stored binding's `for_version == 13`, and `get_binding(..., for_version=13)` returns it. ADR §7 test **#4**. |
| `test_get_binding_returns_none_for_unknown_key` | Cold registry; `get_binding(...)` returns `None`. |
| `test_get_binding_returns_stored_binding_for_matching_version` | Pre-populate; `get_binding(...)` returns the same `ProviderBinding`. |

#### `tests/test_backend_run_policy.py` [CREATE]

**Purpose:** Policy enforcement. Maps to ADR §7 net-new test **#6 (policy timeout enforcement)**.

**Test functions:**

| Function | Assertion |
|---|---|
| `test_default_policy_values_match_adr` | `BackendRunPolicy.default()` returns `BackendRunPolicy(max_cycles=20, cycle_timeout_s=60, total_timeout_s=300)`. |
| `test_total_timeout_fires_agent_finish_error` | Construct `ManagedAgentBackendV2(..., policy=BackendRunPolicy(max_cycles=20, cycle_timeout_s=60, total_timeout_s=0.1))` with a stub Anthropic client whose `beta.sessions.events.stream` returns an SSE iterator that never yields `end_turn`; assert `stream()` yields `AgentFinish(stop_reason="error")` within `total_timeout_s + small_epsilon` rather than blocking. ADR §7 test **#6**. The test uses `pytest.mark.asyncio` and exercises the policy timeout under `asyncio.timeout(...)`. |

#### `tests/test_managed_agent_backend_v2_stream.py` [CREATE]

**Purpose:** Stream-level integration of the v2 backend with stubbed Anthropic. Maps to ADR §7 net-new test **#2 (SSE-vs-requires_action race)**.

**Test functions:**

| Function | Assertion |
|---|---|
| `test_requires_action_before_use_events_waits_then_resolves` | Stub the SSE iterator to yield `requires_action` carrying `event_ids=["sevt_a"]` *before* the matching `agent.custom_tool_use` event, then yield the use event after a small delay, then yield `end_turn`. Assert v2's `stream()` buffers/waits until the use event arrives (the wait is bounded by `cycle_timeout_s`), enters the cycle, executes the tool, and finishes with `end_turn`. ADR §7 test **#2**. |
| `test_requires_action_with_unknown_id_aborts_via_interrupt` | Stub iterator yields `requires_action` with `event_ids=["sevt_unknown"]` and never yields the matching use event; wait exceeds `cycle_timeout_s`. Assert v2 POSTs `user.interrupt` and yields `AgentFinish(stop_reason="error")` (or whichever specific error reason the brief settles on — recommend `"requires_action_missing_event_id"`). Pairs with `test_cycle_calls_raises_when_event_id_not_in_events_by_id` to fully cover the prod-failure regression. |
| `test_no_in_process_caches_after_stream` | Construct backend, run a stub stream to `end_turn`; assert backend has no `_agent_ids` / `_environment_id` attributes (`assert not hasattr(backend, "_agent_ids")`). Decision 3's structural invariant. |

#### `tests/test_provider_binding_registry_mysql.py` [CREATE — gated]

**Purpose:** MySQL CAS UPDATE integration test against staging. Mirror of `test_get_or_provision_is_atomic_under_concurrency` against `MysqlProviderBindingRegistry`. Per Q8, gated behind env vars and **not run by Phase 1 CI**.

**Skip-marker pattern:**

```python
import os
import pytest

pytestmark = pytest.mark.skipif(
    os.getenv("COPASS_INTEGRATION") != "1"
    or not os.getenv("COPASS_STAGING_MYSQL_URL"),
    reason="Integration test; requires COPASS_INTEGRATION=1 and COPASS_STAGING_MYSQL_URL",
)
```

**Test functions:**

| Function | Assertion |
|---|---|
| `test_mysql_get_or_provision_is_atomic_under_concurrency` | Connect to staging (`copass-staging`), insert a synthetic `copass_agents` row, spawn two concurrent `get_or_provision` calls, assert exactly one row update wins, both callers receive the same binding. Test must clean up its synthetic row in `finally`. ADR §7 test **#3** (MySQL mirror). |

---

## Section 3 — PR-A file-by-file plan (schema only)

Worktree root: `/Users/brendon/Development/olane/o-twin-data-pipeline/.claude/worktrees/managed-agent-v2-schema/`. All paths below are absolute.

### `frame_graph/storage/migrations/099_copass_agents_provider_bindings.sql` [CREATE]

**Purpose:** Add the `provider_bindings JSON NULL` column to `copass_agents` per ADR §3 Decision 3.

**Exact ALTER statement (verbatim from ADR §3):**

```sql
ALTER TABLE copass_agents
  ADD COLUMN provider_bindings JSON NULL
  COMMENT 'provider → {agent_id, environment_id, for_version, provisioned_at}; populated lazily on first run, cleared on version bump';
```

**Notes:**

- Migration number **099**. Confirmed against `/Users/brendon/Development/olane/o-twin-data-pipeline/.claude/worktrees/managed-agent-v2-schema/frame_graph/storage/migrations/` — `098_agent_runs_provider_session_id.sql` and `098_add_session_id_to_compute_sessions.sql` are the most recent.
- **No VSchema change.** `copass_agents` already has `xxhash(user_id)` vindex; this ALTER adds a non-vindexed column and does not touch routing. Per CLAUDE.md "PlanetScale / Vitess — New Sharded Tables Need a VSchema Entry": only **new sharded tables** require VSchema entries. Adding a column to an existing sharded table does not.
- **No backfill.** The column defaults to NULL; v2 populates lazily on first run.

### `frame_graph/storage/migrations/099_runbook.md` [CREATE]

**Purpose:** Deploy runbook for migration 099. Targets both `copass-staging` and `copass-twin-01`. Mirror the structure of `098_runbook.md` (the v2 schema worktree already contains it at `/Users/brendon/Development/olane/o-twin-data-pipeline/.claude/worktrees/managed-agent-v2-schema/frame_graph/storage/migrations/098_runbook.md`) but for the simpler additive-column case.

**Sections to include:**

1. **What gets deployed** — the single ALTER from `099_copass_agents_provider_bindings.sql`. Call out: VSchema unchanged; no backfill; column is nullable.
2. **Prerequisites** — `AWS_PROFILE=highway-research`, `pscale auth login`, branch name convention `migrations-099-copass-agents-provider-bindings`.
3. **Staging — `copass-staging` flow** — `pscale branch create`, `pscale shell ... < 099_copass_agents_provider_bindings.sql`, `pscale shell ... --execute "SHOW CREATE TABLE copass_agents\G"` to verify the column lands, `pscale deploy-request create` with notes `"099: copass_agents += provider_bindings JSON NULL — ADR 0001 v2 backend identity mapping. VSchema unchanged."`. **DO NOT execute deploy without explicit authorization** (per `feedback_never_push_environments`).
4. **Production — `copass-twin-01` flow** — identical, runs after staging is green.
5. **Post-deploy verification** — `SHOW CREATE TABLE copass_agents` returns the column.
6. **Rollback** — `ALTER TABLE copass_agents DROP COLUMN provider_bindings;` (forward-only on Vitess; ship as a follow-up DR if needed). Application impact: v1 ignores the column entirely; rollback before Phase 2 runtime wiring is harmless.
7. **Pointer:** "Full design context lives in ADR 0001 (`/Users/brendon/Development/olane/copass-harness/.claude/worktrees/managed-agent-v2-phase1/python/copass-anthropic-agents/docs/adr/0001-managed-agent-backend-v2.md`)."

---

## Section 4 — Test plan

### 4.1 Repointed v1 contract tests (per ADR §7 + §1.4 above)

The four affected test files (`test_managed_agent_backend.py`, `test_mcp_tool_use_handler.py`, `test_gateway_wiring.py`, `test_bearer_mint.py`) all have their `from copass_anthropic_agents.backends.managed_agent_backend import (...)` import block rewritten as per §1.4. Sixteen tests carry over:

- `test_normalize_messages_from_string`, `test_normalize_messages_from_list`, `test_normalize_messages_skips_non_user` → repoint to `ManagedAgentBackendV2(...)._normalize_messages(...)`. Same assertions.
- `test_specs_to_tools_without_builtin_toolset`, `test_specs_to_tools_with_builtin_toolset` → same.
- `test_fingerprint_stable_for_identical_config`, `test_fingerprint_differs_when_prompt_changes`, `test_fingerprint_differs_when_tools_change` → same.
- `test_build_user_event_for_custom_tool_use_returns_custom_result`, `test_build_user_event_for_mcp_tool_use_returns_confirmation`, `test_build_user_event_for_builtin_tool_use_returns_confirmation` → repointed to `*ToolCall.build_reply()` per the table in §2.
- `test_build_user_event_for_unknown_source_does_not_raise` → renamed to `test_unknown_envelope_is_a_type_error` and inverted (assert raises).
- `test_tool_use_event_types_include_all_three_envelopes` → repointed to `typing.get_args(PendingToolCall)`.
- `test_idle_event_types_include_thread_scoped_alias`, `test_terminated_event_types_include_thread_scoped_alias`, `test_known_noop_event_types_cover_observed_lifecycle_events` → imports point at `_stream_event_types.py`; assertions unchanged.
- `test_mcp_tool_use_returns_user_tool_confirmation_allow` (in `test_mcp_tool_use_handler.py`) → repointed to `McpToolCall.build_reply()`.

### 4.2 Net-new tests (six required before v2 ships, per ADR §7)

| # | Description | File | Function |
|---|---|---|---|
| 1 | Stale-rehydrate-resistance | `tests/test_requires_action_cycle.py` | `test_cycle_calls_raises_when_event_id_not_in_events_by_id` + `test_requires_action_with_unknown_id_aborts_via_interrupt` (in `tests/test_managed_agent_backend_v2_stream.py`) |
| 2 | SSE-vs-`requires_action` race | `tests/test_managed_agent_backend_v2_stream.py` | `test_requires_action_before_use_events_waits_then_resolves` |
| 3 | Cross-process duplicate-create resistance (in-memory) | `tests/test_provider_binding_registry.py` | `test_get_or_provision_is_atomic_under_concurrency` |
| 3 | Cross-process duplicate-create resistance (MySQL mirror) | `tests/test_provider_binding_registry_mysql.py` | `test_mysql_get_or_provision_is_atomic_under_concurrency` (skipped unless `COPASS_INTEGRATION=1`) |
| 4 | `for_version` cache miss on version bump | `tests/test_provider_binding_registry.py` | `test_get_or_provision_invokes_provision_on_version_bump` |
| 5 | Cycle-barrier enforcement | `tests/test_requires_action_cycle.py` | `test_cycle_send_replies_refuses_reply_for_unrequested_id` |
| 6 | Policy timeout enforcement | `tests/test_backend_run_policy.py` | `test_total_timeout_fires_agent_finish_error` |

### 4.3 MySQL integration test posture (Q8)

- File: `tests/test_provider_binding_registry_mysql.py`.
- Default: **skipped**.
- Activation: `COPASS_INTEGRATION=1` env var + `COPASS_STAGING_MYSQL_URL` env var pointing at the staging `copass-sharded` keyspace (or local equivalent).
- CI in Phase 1 does **not** set these, so the test is collected-and-skipped. The runtime team (Phase 2) flips them on staging-canary runs.
- Cleanup: the test inserts a synthetic `copass_agents` row keyed on a UUID prefixed with `test-integration-` and removes it in `finally`.

---

## Section 5 — Open risks (post-resolution)

| # | ADR §6 risk | Status after Q1–Q9 |
|---|---|---|
| 1 | `AgentBackend.stream` ABC signature mismatch | **Resolved (Q7).** Python accepts an async-generator method as the implementation of a `def → AsyncIterator[AgentEvent]` ABC method. No `# type: ignore` required. Brief documents the pattern at the top of `managed_agent_backend_v2.py`. |
| 2 | `AgentRunResult` `frozen=True` | **Open (no action).** No migration concern. Tracked for awareness only. |
| 3 | `copass_agents.version` semantics | **Open.** Tracked for the Phase 2 runtime-wiring brief. Phase 1 tests use stub `for_version=1`. The `for_version` field on `ProviderBinding` is part of the contract; the resolution (bump-on-edit enforcement vs fingerprint-as-key) lives in Phase 2. |
| 4 | `AgentToolRegistry.add` silent overwrite | **Open (no Phase 1 action).** v2 preserves v1's `_fingerprint_agent` algorithm; deterministic sort of `effective_tools.list_specs()` is load-bearing. Document in `_fingerprint_agent`'s v2 docstring. |
| 5 | `_normalize_messages` drops non-user roles | **Open (no Phase 1 action).** Contract of the managed-agents API; preserved verbatim in v2. |
| 6 | `BadRequestError` vs transient 5xx | **Resolved (Q5).** Lazy import pattern (`TYPE_CHECKING` for type hints + try/except `from anthropic import BadRequestError; except ImportError: BadRequestError = Exception` shim) mirrors v1's `AsyncAnthropic` handling at `managed_agent_backend.py:292-295`. `RequiresActionCycle.send_replies` raises on `BadRequestError`; the v2 stream-loop catches and emits `AgentFinish(error)`. Transient 5xx remains out of scope per ADR §8. |
| 7 | Test imports reference v1 internal names | **Resolved (Q6).** Exact line ranges identified for all four files. Section 1.4 of this brief gives the rewrite. |
| 8 | No timeout on `await stream.close()` in `finally` | **Resolved.** `BackendRunPolicy.total_timeout_s` wraps the entire `stream()` body including the `finally` cleanup via `async with asyncio.timeout(...)`. Documented in §2 for `managed_agent_backend_v2.py`. |

### Additional risks surfaced during brief authoring

- **A. v1 stays on-by-default through Phase 1.** PR-B does **not** modify `python/copass-anthropic-agents/src/copass_anthropic_agents/__init__.py`'s top-level re-exports. Adopters and the `o-twin-data-pipeline` runtime continue to import `ManagedAgentBackend` and get v1. This is intentional (Q2); flag in PR-B description so reviewers don't expect the package top-level to advertise v2.
- **B. `aiomysql` vs `asyncmy` driver choice.** `MysqlProviderBindingRegistry` is gated by Q8's integration test and not exercised by Phase 1 CI. The driver name and exact `acquire()` / connection-pool API shape are not pinned by this brief — the runtime/Phase 2 implementer picks the driver consistent with the rest of `o-twin-data-pipeline`'s MySQL access (likely the same pool that backs `TokenCreditsRepository` at `frame_graph/storage/token_credits_repository.py`). For Phase 1, the registry's `__init__` accepts an opaque `pool` and method bodies type-annotate via `TYPE_CHECKING` only.
- **C. `cycle_timeout_s` enforcement on a never-arriving use event.** Test `test_requires_action_with_unknown_id_aborts_via_interrupt` exercises this. If `asyncio.wait_for` raises `TimeoutError`, v2 POSTs `user.interrupt` and yields `AgentFinish(error, stop_reason="requires_action_missing_event_id")`. The specific `stop_reason` string is locked here to keep telemetry queries stable across rollout phases.

---

## Section 6 — Hand-off instructions for the implementing agent

### Order of operations

PR-A and PR-B are independent and may be implemented in parallel. The brief lists PR-A first because:

1. The SQL migration is short and review-cheap.
2. Once PR-A is merged on staging, Phase 2's runtime brief (out of scope here) has a column to write to.
3. PR-B's `MysqlProviderBindingRegistry` ships as code regardless of PR-A's deploy state — the integration test that exercises it is skipped by default.

### Checklist for PR-A (schema only)

- [ ] **Worktree:** `/Users/brendon/Development/olane/o-twin-data-pipeline/.claude/worktrees/managed-agent-v2-schema/`
- [ ] **Branch:** `feat/managed-agent-v2-schema`
- [ ] **PR base:** `staging` (per `feedback_pr_base_staging`)
- [ ] Files to create: `frame_graph/storage/migrations/099_copass_agents_provider_bindings.sql`, `frame_graph/storage/migrations/099_runbook.md`. No source code edits.
- [ ] **Do not run any `pscale` commands without explicit user authorization** per `feedback_never_push_environments`. The runbook is documentation only.
- [ ] **Commit convention** (matching recent merged PRs to `staging` — examples: PRs #538, #539, #541): commit message `feat(migrations): add copass_agents.provider_bindings JSON column (ADR 0001)` with a body summarizing why and pointing at the ADR.
- [ ] **PR title convention:** `feat(migrations): copass_agents += provider_bindings JSON (ADR 0001 Phase 1)`.
- [ ] **PR body convention** (matching #539's structure):
  - `## Summary` — 2-3 bullets covering: adds nullable JSON column to `copass_agents`; targets ADR 0001 Phase 1; VSchema unchanged.
  - `## What changed` — file list.
  - `## Test plan` — checklist: SHOW CREATE TABLE before/after; verify column is NULL on existing rows; rollback SQL.
  - Generated-with footer per the project convention.
- [ ] PR `gh pr create --base staging --title "..." --body "$(cat <<'EOF' … EOF)"`.

### Checklist for PR-B (Python code + tests)

- [ ] **Worktree:** `/Users/brendon/Development/olane/copass-harness/.claude/worktrees/managed-agent-v2-phase1/`
- [ ] **Branch:** `feat/managed-agent-v2-phase1`
- [ ] **PR base:** `main` (verified against recent merged PRs in `olane-labs/copass`: PR #40 `feature/0030-registrar-transports → main`, PR #37 `chore/spec-corpus-hermes-1.3.1 → main`, PR #35 `chore/release-1.3.0 → main`). `production` is a separate branch reserved for releases.
- [ ] Files to create (Tier 1-3): `_stream_event_types.py`, `pending_tool_call.py`, `requires_action_cycle.py`, `backend_run_policy.py`, `provider_binding_registry.py`, `in_memory_provider_binding_registry.py`, `mysql_provider_binding_registry.py`, `managed_agent_backend_v2.py`. All under `python/copass-anthropic-agents/src/copass_anthropic_agents/backends/`.
- [ ] File to edit (Tier 3): `python/copass-anthropic-agents/src/copass_anthropic_agents/backends/__init__.py`. Top-level `python/copass-anthropic-agents/src/copass_anthropic_agents/__init__.py` is **not** edited (Q2).
- [ ] Files to create (Tier 5 tests): `test_pending_tool_call.py`, `test_requires_action_cycle.py`, `test_provider_binding_registry.py`, `test_provider_binding_registry_mysql.py`, `test_backend_run_policy.py`, `test_managed_agent_backend_v2_stream.py`.
- [ ] Files to edit (Tier 5 tests): `test_managed_agent_backend.py`, `test_mcp_tool_use_handler.py`, `test_gateway_wiring.py`, `test_bearer_mint.py` — import-block rewrites only, semantics per §1.4.
- [ ] **Test invocation:** `cd /Users/brendon/Development/olane/copass-harness/.claude/worktrees/managed-agent-v2-phase1/python/copass-anthropic-agents && uv run pytest` (or `pytest` if the `dev` extra is already installed). `pyproject.toml` declares `[tool.pytest.ini_options] asyncio_mode = "auto"` and `testpaths = ["tests"]`, so a bare `pytest` invocation from the package root runs the full suite. The `COPASS_INTEGRATION` env var stays unset, so the MySQL integration test is skipped.
- [ ] **Commit convention** (matching recent merged PRs to `main` — examples: PRs #40, #37, #35): commit message `feat(backend): ManagedAgentBackendV2 — stream-first server-authoritative cycle model (ADR 0001 Phase 1)` with a body explaining the cycle-model fix, the registry seam, and that v1 stays default.
- [ ] **PR title convention:** `feat(backend): ManagedAgentBackendV2 (ADR 0001 Phase 1)`. Keep under 70 characters.
- [ ] **PR body convention** (matching PR #40's terse / linear-link / ADR-link style):
  - `## Summary` — 2-3 bullets: what v2 does differently from v1; the registry seam; v1 stays default for Phase 1.
  - `## What changed` — Tier 1-3 file list, then Tier 5 file list.
  - `## Test plan` — checklist: `pytest` green locally; 6 net-new tests cover the failure mode and the policy contract; MySQL integration test is collected-and-skipped without `COPASS_INTEGRATION=1`.
  - Link to ADR 0001 by path.
  - Generated-with footer per project convention.
- [ ] PR `gh pr create --base main --title "..." --body "$(cat <<'EOF' … EOF)"`.

### Final invariants the implementer must check before opening either PR

- [ ] **PR-A:** `099_copass_agents_provider_bindings.sql` contains exactly the one `ALTER TABLE copass_agents ADD COLUMN provider_bindings JSON NULL ...` statement. The COMMENT string is verbatim from ADR §3.
- [ ] **PR-B:** `ManagedAgentBackendV2` has no `self._agent_ids` or `self._environment_id` attributes (Decision 3). A grep across the v2 module finds zero `events.list(` calls (Decision 2). Top-level `copass_anthropic_agents/__init__.py` is unchanged (Q2).
- [ ] **PR-B:** The `name` vs `tool_name` log-extra convention is preserved everywhere v2 logs a tool name (Risk 7 / `LogRecord.name` collision).
- [ ] **PR-B:** `BadRequestError` import uses the `try/except ImportError` shim or `TYPE_CHECKING`, not an unconditional `from anthropic import BadRequestError`. (Library adopters who don't install the Anthropic SDK should not crash at module load.)

When PR-A and PR-B are open, return their URLs and stop.
