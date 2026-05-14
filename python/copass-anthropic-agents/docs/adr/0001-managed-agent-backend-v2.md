# ADR 0001: Managed-Agent Backend v2

- **Status:** Proposed
- **Date:** 2026-05-14
- **Authors:** architect-agent + Brendon
- **Decider:** Brendon
- **Downstream agents:** scaffolding-agent (Phase 1 implementation brief)

---

## 1. Context

### 1.1 The failure that started this

On 2026-05-13 at 21:09 and 21:10 UTC, two `arcus-analyst` runs on prod cluster `olane-org-001` died with the same Anthropic 400:

> `invalid_request_error`: "waiting on responses to events [sevt_…]; only user.tool_confirmation, user.custom_tool_result, user.tool_result, or user.interrupt may be sent"

Both runs hit a cache-prefix (`tokens_in=3`), spun 47–88s of "rehydrate from session log" recovery, and terminated with `stop_reason='error'` and empty output. Same user (`53df4763-…`), same agent (`arcus-analyst`, `cbc4396c-…`), same trigger.

The pod-log trace was:

1. `requires_action` arrives carrying server-authoritative `event_ids = [sevt_NEW_A, sevt_NEW_B]`.
2. v1's local `pending_tool_events: dict` is empty — the SSE iterator hasn't surfaced the matching `agent.*_tool_use` events yet.
3. v1's recovery hits `events.list(order='desc', limit=200)`, which pulls **prior-turn** `sevt_*` ids back into the buffer.
4. v1 executes the stale tools and POSTs `user.custom_tool_result` for the stale ids.
5. Anthropic 400s the next send because the server is still waiting on the **newer** ids.

The two prior fix attempts on `brendon/fix-managed-agent-tool-event-recovery` (commits `5d1d014`, `f5e2867`, shipped as `copass-anthropic-agents 1.0.6`) patched the rehydrate hook and a logging `KeyError`. They did not stick because rehydrate-from-log is the wrong layer entirely — once the SSE stream and the server clock are out of sync, no client-side reconciliation against the persisted log can produce the correct next reply.

### 1.2 The design problems v1 carries (themed)

**Protocol-shape problems**

- v1 treats its local SSE buffer as the source of truth for "what is the server waiting on?" Anthropic's documented contract is the opposite: `requires_action.stop.event_ids` is authoritative.
- The three tool-use envelopes (`agent.custom_tool_use` → `user.custom_tool_result`; `agent.tool_use` and `agent.mcp_tool_use` → `user.tool_confirmation`) are flattened into one `frozenset` and dispatched by string comparison at four call sites that can drift independently.
- `_normalize_messages` silently drops non-user-role messages and `_serialize_tool_result` collapses structured payloads via `json.dumps(default=str)` at the model boundary.

**State-and-process problems**

- In-process mutable caches `_agent_ids: dict[str, str]` and `_environment_id: Optional[str]` are unlocked. Concurrent calls race the check-then-set on cache miss → duplicate `agents.create`. Across N pods × empty cache on deploy, this becomes N orphaned Anthropic agents per fingerprint revision.
- Session reuse is on the honor system: a supplied `SESSION_ID_HANDLE` is not validated against the agent fingerprint, so tool-registry drift between turns surfaces as opaque "tool not registered" errors at the model.
- `_rehydrate_pending_tool_events` (lines 739–813) mutates the same dict the stream loop is writing into, has no "still-pending?" filter, no cycle barrier, and swallows every failure. It is the direct cause of the prod 400.

**Decomposition problems**

- One 380-line `stream()` method (lines 356–737) interleaves event dispatch, recovery, tool execution, reply construction, send-with-fallback, and finalization across six mutable locals.
- The "interrupt if still missing after rehydrate" guard (lines 568–596) is structurally too early — it fires only when rehydrate *fails*, never when rehydrate *succeeds with the wrong ids*. The prod failure is the latter case.
- `_send_events_soft` (lines 906–931) catches bare `Exception`, conflating Anthropic 400s (terminal — the session is wedged) with transient 5xx (retriable).
- Inline comments are the dominant load-bearing artifact (seven API rejection modes narrated in prose). That is evidence that the type system is doing less work than it should.

**Billing problems**

- Each duplicate `agents.create` call from the cache-miss race is a billable provisioning op. CLAUDE.md (project root) explicitly flags this kind of unbounded duplicate-create at deploy time as a cost-surprise vector.
- The prod 400 burns full compute on the rehydrated stale tools (47–88s in the two observed runs) before the session is abandoned — a wedged-session vector that the credit-gate sees as a successful settle.

### 1.3 Why we can't just keep patching v1

The fix is structural. v1's seam — local buffer drives reply choice — is wrong at the contract level, and the recovery hook can only paper over the cracks. We need a backend whose cycle model is built around the server-authoritative `requires_action` contract from line one, with the three reply envelopes encoded as types rather than strings, and zero in-process caches that race on warmup.

---

## 2. Decisions

Each decision is locked. Rationale is captured in line; alternatives are listed only with their rejection reasons.

### Decision 1 — Build `ManagedAgentBackendV2` alongside v1

- New class: `ManagedAgentBackendV2` in `copass_anthropic_agents.backends.managed_agent_backend_v2`.
- v1 stays callable and importable until v2 has been the default in prod for one stable release window, then v1 and the env-var escape hatch are deleted together.
- `PassthroughRuntime` / `CopassManagedAgent` (in `o-twin-data-pipeline`) selects v2 by default once v2 passes parity. Env-var escape hatch `COPASS_USE_MANAGED_AGENT_V1=true` flips it back during the canary / rollback window only.
- **Rejected alternatives:**
  - **B — In-place flag inside v1**: harder to reason about which path ran for any given trace; preserves all of v1's structural problems behind a boolean.
  - **C — Full rewrite, delete v1 in the same PR**: v1 carries prod load for arcus-analyst, concierge, and the trigger handler. A live-fire cutover with no fallback is unjustifiable.
  - **D — Wait for ADR 0029 to ship**: ADR 0029 is proposed, not shipped, and even when it ships, the legacy custom-tool path stays live for `mcp_toolset`-incompatible callers (third-party adopters of the library). v2 is independent of ADR 0029's transport choice.

### Decision 2 — Stream-first, server-authoritative cycle model

The cycle is what v1 got wrong; this is the core of v2.

- v2 builds a client-side `events_by_id: dict[str, PendingToolCall]` from the SSE stream as `agent.*_tool_use` events arrive. This is Anthropic's documented canonical pattern (see `platform.claude.com/docs/en/managed-agents/events-and-streaming`).
- When `requires_action` arrives, v2 iterates `stop.event_ids` (server-authoritative). Any id NOT in `events_by_id` is a hard programmatic error — v2 logs the gap, POSTs `user.interrupt`, and yields `AgentFinish(stop_reason="error", …)`. **There is no rehydrate-from-session-log path during a live stream.** `events.list` is valid only for reconnection-seeding on a fresh stream attach, never as a recovery step during an active stream.
- The three tool-use envelopes are encoded as a sealed `PendingToolCall` union (variants `CustomToolCall`, `ServerToolCall`, `McpToolCall`). The reply-event builder is a method on the variant; there is no `if source_type == "…"` string ladder in v2.
- A `RequiresActionCycle(cycle_id, requested_ids, executed_ids)` object models each cycle explicitly. v2 refuses (at type / code level, not via runtime check) to send a reply whose `event_id` is not in `cycle.requested_ids`. Replies for ids from a prior cycle cannot be constructed.

This is the layer where the prod failure goes away: there is no path by which `events.list` can re-introduce stale ids into the current cycle's reply set.

### Decision 3 — Stateless backend; persisted identity mapping on `copass_agents`

The backend instance carries zero in-process caches. No `self._agent_ids`, no `self._environment_id`, no `asyncio.Lock`.

Provider-side identifiers (Anthropic `agent_id`, `environment_id`) live in a new JSON column on the existing `copass_agents` table:

```sql
ALTER TABLE copass_agents
  ADD COLUMN provider_bindings JSON NULL
  COMMENT 'provider → {agent_id, environment_id, for_version, provisioned_at}; populated lazily on first run, cleared on version bump';
```

JSON shape (keyed by provider name so a future `openai_responses` binding can live alongside):

```json
{
  "anthropic_managed": {
    "agent_id":       "agent_01...",
    "environment_id": "env_01...",
    "for_version":    13,
    "provisioned_at": "2026-05-14T13:50:00Z"
  }
}
```

**Read pattern:** SELECT row, parse JSON, return `agent_id` if `for_version == copass_agents.version`; else miss → provision a new Anthropic agent and write back.

**Write pattern (compare-and-swap, race-safe across processes):**

```sql
UPDATE copass_agents
SET provider_bindings = JSON_SET(
      COALESCE(provider_bindings, JSON_OBJECT()),
      '$.anthropic_managed',
      JSON_OBJECT('agent_id', :new_id, 'environment_id', :env_id,
                  'for_version', :version, 'provisioned_at', NOW(6)))
WHERE user_id = :user_id AND agent_id = :agent_id
  AND (JSON_EXTRACT(provider_bindings, '$.anthropic_managed.for_version') IS NULL
       OR JSON_EXTRACT(provider_bindings, '$.anthropic_managed.for_version') < :version);
```

`rows_affected == 0` → another process won the race; re-SELECT and reuse theirs. Our Anthropic `agents.create` for that revision becomes a one-time orphan; that is acceptable and bounded (one per process per fingerprint-revision, not per request).

**VSchema note:** `copass_agents` already has a vindex on `user_id`; an `ALTER` to add a non-vindexed column does not touch routing. No VSchema deploy-request is needed. The SQL migration is a standard pscale deploy-request flow against both `copass-staging` and `copass-twin-01` per CLAUDE.md's "PlanetScale / Vitess" section.

**New seam:** `ProviderBindingRegistry` Protocol (defined in Decision 4). The library ships **one** implementation:

- `InMemoryProviderBindingRegistry` — dict-backed, the default for library adopters. CAS semantics emulated in-process via `asyncio.Lock` per `(user_id, agent_id, provider)`.

The deployment-specific persistent implementation (`MysqlProviderBindingRegistry`, backed by `copass_agents.provider_bindings`) **lives in `o-twin-data-pipeline`**, not in `copass-anthropic-agents`. The library never imports a DB driver and never names a schema choice — keeping the public surface storage-agnostic. The runtime injects whichever implementation it owns at backend-construction time.

### Decision 4 — New types live in `copass-anthropic-agents`, not core-agents (yet)

`PendingToolCall`, `RequiresActionCycle`, `BackendRunPolicy`, and `ProviderBindingRegistry` ship inside `copass-anthropic-agents` for v2's launch.

**Lift trigger:** when a second backend with the same tool-use-cycle shape lands (OpenAI Responses API is the named near-term candidate, currently NOT on the roadmap), promote `RequiresActionCycle`, `BackendRunPolicy`, and `ProviderBindingRegistry` into `copass-core-agents`. `PendingToolCall` may stay vendor-specific because the envelope tags are Anthropic's.

We do not lift speculatively. There is one consumer today.

**`BackendRunPolicy`** is wired as a `policy: BackendRunPolicy` kwarg on `ManagedAgentBackendV2.__init__`. Default: `BackendRunPolicy.default()` with `max_cycles=20`, `cycle_timeout_s=60`, `total_timeout_s=300`. When/if this lifts to core-agents, it becomes an ABC kwarg with `BackendRunPolicy.NONE` as the default for cycle-less backends (text-only providers).

### Decision 5 — Default tool path is gateway-MCP; custom-tool path retained

- v2 keeps the `use_gateway_mcp` constructor flag for library adopters, but our internal agents (arcus-analyst, concierge, etc.) flip the default to `True` for consistency.
- When `use_gateway_mcp=True` and zero `agent.custom_tool_use` events are emitted during a run, v2's tool-execution branch of `RequiresActionCycle` is never entered. The happy path for our agents is: model → gateway-MCP → model, with v2 only routing `user.tool_confirmation(allow)` replies.
- The custom-tool path remains correct for adopters who pass `use_gateway_mcp=False`. It is not our primary surface.

### Decision 6 — `AgentRunResult.tool_calls` stays `List[dict]`

Tool-call shapes are still moving (ADR 0029 phase 2, server-confirm result schemas). Tightening to `List[ToolCall]` now would freeze the shape ahead of stabilization. Revisit when the shapes settle.

### Decision 7 — Test strategy

**v1 internal-helper tests die with v1** (they exercise implementation details that don't exist in v2):

| v1 test | Disposition | Reason |
|---|---|---|
| `test_send_events_soft_returns_exception_on_400_and_sends_interrupt` | Delete with v1 | `_send_events_soft` is a v1-only helper; v2's send path is at type level (`RequiresActionCycle.send_replies`) |
| `test_send_events_soft_returns_none_on_success` | Delete with v1 | same |
| any `test_rehydrate_*` | Delete with v1 | rehydrate path does not exist in v2 |
| any `test_execute_pending_tools_*` (none currently) | N/A | helper folded into `PendingToolCall.execute` on each variant |

**v1 external-contract tests re-point at v2** (re-import + minor signature adjustments):

| v1 test | v2 disposition |
|---|---|
| `test_normalize_messages_from_string` | Repoint to v2; message normalization contract unchanged |
| `test_normalize_messages_from_list` | Repoint to v2 |
| `test_normalize_messages_skips_non_user` | Repoint to v2 (decision to keep non-user-skip behavior stays; warning surface unchanged) |
| `test_specs_to_tools_without_builtin_toolset` | Repoint to v2 |
| `test_specs_to_tools_with_builtin_toolset` | Repoint to v2 |
| `test_fingerprint_stable_for_identical_config` | Repoint to v2 (fingerprint now keys the `ProviderBindingRegistry` lookup) |
| `test_fingerprint_differs_when_prompt_changes` | Repoint to v2 |
| `test_fingerprint_differs_when_tools_change` | Repoint to v2 |
| `test_build_user_event_for_custom_tool_use_returns_custom_result` | Repoint to v2 — assert against `CustomToolCall.build_reply()` directly |
| `test_build_user_event_for_mcp_tool_use_returns_confirmation` | Repoint to v2 — `McpToolCall.build_reply()` |
| `test_build_user_event_for_builtin_tool_use_returns_confirmation` | Repoint to v2 — `ServerToolCall.build_reply()` |
| `test_build_user_event_for_unknown_source_does_not_raise` | **Replace with assert-raises** — in v2 an unknown envelope is a programmer error; the union does not accept it |
| `test_tool_use_event_types_include_all_three_envelopes` | Repoint to v2 (assert the union has the three variants) |
| `test_idle_event_types_include_thread_scoped_alias` | Repoint to v2 |
| `test_terminated_event_types_include_thread_scoped_alias` | Repoint to v2 |
| `test_known_noop_event_types_cover_observed_lifecycle_events` | Repoint to v2 |
| `test_mcp_tool_use_returns_user_tool_confirmation_allow` (in `test_mcp_tool_use_handler.py`) | Repoint to v2 — `McpToolCall.build_reply()` |
| `test_mcp_tool_use_remains_in_recognized_tool_use_envelopes` | Repoint to v2 (assert against the union, not a `frozenset`) |

Gateway-wiring tests (`test_gateway_wiring.py`) and bearer-mint tests (`test_bearer_mint.py`) carry over essentially as-is — they cover ADR 0029 wiring that v2 inherits.

**Net-new v2 tests REQUIRED before v2 ships:**

1. **Stale-rehydrate-resistance.** Simulate a sequence where the SSE stream surfaces a fresh `requires_action` carrying ids the local buffer doesn't have; assert v2 does NOT call `events.list` and instead aborts via `user.interrupt` + `AgentFinish(error)`. Must fail on v1, pass on v2.
2. **SSE-vs-`requires_action` race.** Simulate `requires_action` arriving before the corresponding `agent.custom_tool_use` events; assert v2 waits / buffers until the matching use events arrive, then enters the cycle cleanly. The bound is `BackendRunPolicy.cycle_timeout_s`.
3. **Cross-process duplicate-create resistance.** Spawn two coroutines that race to provision the same agent fingerprint against `InMemoryProviderBindingRegistry`; assert exactly one binding entry, and the second coroutine reuses the first's `agent_id`. The MySQL mirror test lives in `o-twin-data-pipeline` next to `MysqlProviderBindingRegistry`; it uses a mocked `aiomysql` pool to exercise the same CAS WHERE clause without staging access.
4. **`for_version` cache miss on version bump.** Pre-populate `provider_bindings` with `for_version=12`, bump `copass_agents.version` to 13; assert next run mints a fresh Anthropic agent and overwrites the binding (with `for_version=13`).
5. **Cycle-barrier enforcement.** Construct a `RequiresActionCycle` with `requested_ids={"sevt_a"}`; attempt to enqueue a reply for `"sevt_b"`; assert the type / code path refuses at construction, not at send.
6. **Policy timeout enforcement.** Simulate a model that streams indefinitely without `end_turn`; assert v2 fires `user.interrupt` and yields `AgentFinish(stop_reason="error")` at `total_timeout_s` rather than blocking forever.

### Decision 8 — Out of scope for v2

- ADR 0029's gateway-MCP transport, vault-id threading, environment-config defaults: unchanged. v2 inherits them.
- `delete_session_on_finish` constructor flag (and its `False` default): unchanged.
- Cross-region failover or Anthropic-side retries: unchanged.
- Migrating away from `delete_session_on_finish=False`: out of scope.
- A future v3 that lifts the abstractions into `copass-core-agents`: referenced by Decision 4's lift trigger, not scoped here.

---

## 3. Architecture overview

```
                                              ┌─────────────────────────────────┐
                                              │  Caller (PassthroughRuntime,    │
                                              │   library adopter, test fixture)│
                                              └──────────────┬──────────────────┘
                                                             │  BaseAgent.stream(messages, context)
                                                             ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                BaseAgent  (core-agents)                              │
│   - identity, model, system_prompt                                                   │
│   - tools (static) + tool_resolver (dynamic)  → build_tools(context)                 │
│   - backend: AgentBackend                                                            │
└──────────────────────────────────────────────┬───────────────────────────────────────┘
                                               │ delegates to backend.stream(...)
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                        ManagedAgentBackendV2 (this ADR)                              │
│                                                                                      │
│   __init__(*, client, registry: ProviderBindingRegistry, policy: BackendRunPolicy,   │
│            use_gateway_mcp, gateway_mcp_url, gateway_mcp_name,                       │
│            environment_config, include_builtin_toolset, delete_session_on_finish)    │
│                                                                                      │
│   stream(agent, messages, context):                                                  │
│     1. fingerprint = compute(agent, tools, gateway flags)                            │
│     2. binding = await registry.get_or_provision(                                    │
│           user_id, agent_id, fingerprint, version,                                   │
│           provision=lambda: anthropic.agents.create(...))   ← CAS, race-safe        │
│     3. session = await anthropic.sessions.create(...)        ← or reuse handle      │
│     4. async for cycle in RunLoop(stream, policy):           ← stream-first         │
│            cycle: RequiresActionCycle                                                │
│            for call in cycle.requested():                    ← from stop.event_ids  │
│                reply = call.execute_and_build_reply(tools)  ← polymorphic           │
│            await cycle.send_replies()                        ← barrier: in-cycle only│
│     5. yield AgentFinish                                                             │
└──────────────────────────────────────────────┬───────────────────────────────────────┘
                                               │
                          ┌────────────────────┼─────────────────────┐
                          ▼                    ▼                     ▼
            ┌──────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
            │  events_by_id        │ │  PendingToolCall    │ │ ProviderBinding-    │
            │  (per stream)        │ │  union              │ │  Registry           │
            │                      │ │                     │ │                     │
            │  built from SSE      │ │  CustomToolCall    │ │  MysqlImpl:         │
            │  agent.*_tool_use    │ │   → user.custom_   │ │   copass_agents     │
            │  events as they      │ │     tool_result    │ │   .provider_bindings│
            │  arrive              │ │                     │ │   JSON column +     │
            │                      │ │  ServerToolCall    │ │   CAS UPDATE        │
            │  consumed when       │ │   → user.tool_     │ │                     │
            │  requires_action     │ │     confirmation   │ │  InMemoryImpl:      │
            │  cites the id        │ │                     │ │   dict + asyncio    │
            │                      │ │  McpToolCall       │ │   lock              │
            │  ID not in map?      │ │   → user.tool_     │ │                     │
            │  → programmer error  │ │     confirmation   │ │                     │
            │  → interrupt + finish│ │                     │ │                     │
            └──────────────────────┘ └─────────────────────┘ └─────────────────────┘
```

Key invariants visible in the diagram:

- The SSE stream is the only path that populates `events_by_id`. `events.list` is **not** called during a live stream.
- `RequiresActionCycle` is the only object that can build replies. It refuses to construct a reply whose `event_id` is not in its `requested_ids`.
- `ProviderBindingRegistry.get_or_provision` is the only path that mints Anthropic `agent_id`s. The backend has no `self._agent_ids`.

---

## 4. Type signatures (public contracts only — no implementations)

```python
# copass_anthropic_agents.backends.pending_tool_call
from dataclasses import dataclass
from typing import Protocol, Union

@dataclass(frozen=True)
class CustomToolCall:
    """agent.custom_tool_use — local execution; reply user.custom_tool_result."""
    event_id: str
    name: str
    arguments: dict

    async def execute_and_build_reply(
        self,
        tools: "AgentToolRegistry",
        context: "AgentInvocationContext",
    ) -> dict:
        """Run the tool, return the user.custom_tool_result envelope."""
        ...

@dataclass(frozen=True)
class ServerToolCall:
    """agent.tool_use — Anthropic built-in toolset; reply user.tool_confirmation."""
    event_id: str
    name: str

    def build_reply(self) -> dict: ...

@dataclass(frozen=True)
class McpToolCall:
    """agent.mcp_tool_use — managed MCP server; reply user.tool_confirmation."""
    event_id: str
    name: str

    def build_reply(self) -> dict: ...

PendingToolCall = Union[CustomToolCall, ServerToolCall, McpToolCall]
```

```python
# copass_anthropic_agents.backends.requires_action_cycle
from dataclasses import dataclass

@dataclass
class RequiresActionCycle:
    """One requires_action → reply round, scoped to the ids the server requested.

    Construction validates that every reply event_id appears in requested_ids.
    The class refuses (at construction or at enqueue time) to accept ids from
    prior cycles — this is the type-level guard that v1's rehydrate path
    never had.
    """
    cycle_id: str
    requested_ids: frozenset[str]
    executed_ids: set[str]  # mutates during the cycle

    def calls(self, events_by_id: dict[str, PendingToolCall]) -> list[PendingToolCall]:
        """Resolve requested_ids against the stream's local buffer.

        Missing id is a programmer error; the caller must abort the run.
        """
        ...

    async def send_replies(
        self,
        client: "AsyncAnthropic",
        session_id: str,
        replies: list[dict],
    ) -> None:
        """POST replies. Refuses to send a reply whose envelope id is not
        in requested_ids."""
        ...
```

```python
# copass_anthropic_agents.backends.backend_run_policy
from dataclasses import dataclass

@dataclass(frozen=True)
class BackendRunPolicy:
    """Per-run bounds. Default: max_cycles=20, cycle_timeout_s=60, total_timeout_s=300."""
    max_cycles: int
    cycle_timeout_s: float
    total_timeout_s: float

    @classmethod
    def default(cls) -> "BackendRunPolicy": ...
```

```python
# copass_anthropic_agents.backends.provider_binding_registry
from typing import Awaitable, Callable, Optional, Protocol

class ProviderBindingRegistry(Protocol):
    """Race-safe identity store for provider-side agent/environment ids.

    Library ships InMemoryProviderBindingRegistry (dict + asyncio.Lock).
    Deployments that need cross-process persistence supply their own
    Protocol implementation outside the library (for our deployment
    that's MysqlProviderBindingRegistry in o-twin-data-pipeline, backed
    by the copass_agents.provider_bindings JSON column).
    """

    async def get_binding(
        self,
        *,
        user_id: str,
        agent_id: str,
        provider: str,
        for_version: int,
    ) -> Optional["ProviderBinding"]: ...

    async def get_or_provision(
        self,
        *,
        user_id: str,
        agent_id: str,
        provider: str,
        for_version: int,
        provision: Callable[[], Awaitable["ProviderBinding"]],
    ) -> "ProviderBinding":
        """Atomic: returns existing binding for the version, or invokes
        `provision()` exactly once across racing callers and persists
        the result. Loser of the race re-reads and reuses the winner's
        binding."""
        ...

@dataclass(frozen=True)
class ProviderBinding:
    agent_id: str
    environment_id: str
    for_version: int
    provisioned_at: str  # ISO-8601 UTC
```

---

## 5. Migration plan (phased; each phase independently reviewable)

**Phase 1 — Schema + v2 class + tests (no traffic).**

- pscale deploy-request adding `copass_agents.provider_bindings JSON NULL` to both `copass-staging` and `copass-twin-01` (no VSchema change).
- `ManagedAgentBackendV2` and the type module (`pending_tool_call.py`, `requires_action_cycle.py`, `backend_run_policy.py`, `provider_binding_registry.py`) committed to `copass-anthropic-agents`.
- All net-new tests (Decision 7) green. Repointed v1 tests green.
- v1 untouched and still default. No runtime wiring changes in `o-twin-data-pipeline`.

Phase 1 gate: scaffolding-agent audit (before and after); user review.

**Phase 2 — Runtime opt-in via env-var; canary 10% of arcus-analyst traffic.**

- `PassthroughRuntime` reads `COPASS_USE_MANAGED_AGENT_V2=true`; when set, instantiates v2. Default still v1.
- Roll out to 10% of arcus-analyst pods via env-var on the deploy. Watch:
  - Anthropic 400 rate on `events.send` (should drop to zero for the rehydrate-stale-ids signature).
  - Duplicate `agents.create` rate per fingerprint (should drop to ≤ pod count per deploy).
  - p50/p99 turn latency.
  - Credit-gate settle rate.

Phase 2 gate: 48h canary clean; scaffolding-agent audit; user review.

**Phase 3 — Default to v2; v1 reachable via escape hatch.**

- Flip the runtime default: v2 is on unless `COPASS_USE_MANAGED_AGENT_V1=true`. Roll to 100% of arcus-analyst, concierge, trigger-handler.
- One stable release window (suggest 7 days of clean prod traffic).

Phase 3 gate: 7 days clean; scaffolding-agent audit; user review.

**Phase 4 — Delete v1 + escape hatch.**

- Remove `managed_agent_backend.py` (v1), the env-var escape hatch from the runtime, and all v1-only tests.
- `ManagedAgentBackendV2` is renamed to `ManagedAgentBackend` (drop the `V2` suffix) once v1 is gone. Public re-export from `copass_anthropic_agents` keeps the old name as the only exported symbol.
- Update `copass-anthropic-agents` README and any ADR cross-references.

Phase 4 gate: scaffolding-agent audit; user review.

---

## 6. Risks and open questions

Items grounded in the file reads, not speculation:

1. **`AgentBackend.stream` ABC signature in core-agents is `AsyncIterator`, not `async def`.** `base_backend.py:76-82` declares `def stream(...) -> AsyncIterator[AgentEvent]`. v1 implements it as `async def stream(...)` that yields. v2 must follow the same `async def`-yielding shape — Python accepts an async-generator method as an implementation of a `def`-returning-`AsyncIterator` ABC method, but the ABC's signature is mildly inconsistent. Not a blocker; flag for documentation.
2. **`AgentRunResult` is `frozen=True`.** v2's `run()` (Decision 6 leaves `tool_calls: List[dict]`) returns the same shape; no migration concern.
3. **`copass_agents.version` semantics.** v2 keys `provider_bindings.for_version` against `copass_agents.version`. The ADR assumes `version` is monotonically increasing on every shape-changing edit to the agent's prompt / tools / model. **Open question for downstream:** confirm this assumption against the `copass_agents` repository before scaffolding-agent writes the migration. If `version` is not currently bumped on every prompt edit, v2 will return stale bindings for the new shape and the model will see drifted tools. Either (a) bump-on-edit is already enforced — fine; or (b) the fingerprint replaces `for_version` in the read-key — slightly different schema and read pattern, still race-safe.
4. **`AgentToolRegistry.add` overwrites silently with a `warning` log** (`tool_registry.py:22-31`). v2 keeps fingerprint inputs deterministic by sorting specs (v1 already does this at `_fingerprint_agent:1072`); preserve that sort.
5. **`_normalize_messages` drops non-user roles with a `warning`.** v2 preserves this (it is a contract of the managed-agents API — non-user roles cannot be sent as `user.message`). The risk is callers who silently lose `assistant`-role history; that is a callsite concern, not a v2 concern. No change.
6. **`BadRequestError` vs transient 5xx.** Decision 2 says v2 distinguishes these. The `anthropic` Python SDK exposes `anthropic.BadRequestError`; v2 imports it conditionally (same pattern as v1's `AsyncAnthropic` import). Scaffolding-agent should confirm the exception class name against the SDK version pinned in `pyproject.toml`.
7. **Gateway-wiring tests reference `_TOOL_USE_EVENT_TYPES` and `_build_user_event_for_tool_use`** as importable module-level names (`tests/test_gateway_wiring.py`, `tests/test_mcp_tool_use_handler.py`). v2 replaces these with the union and per-variant `build_reply()`. The repoint is straightforward but unavoidable; flagged for the scaffolding-agent brief.
8. **No timeout on `await stream.close()`** in v1's `finally` block (`managed_agent_backend.py:723-726`). v2's `total_timeout_s` should wrap the `finally` cleanup too, not just the active loop; otherwise a wedged session can hold a coroutine open past the policy budget.

No risk identified is severe enough to defer the ADR.

---

## 7. References

- v1 source (the file v2 replaces): `/Users/brendon/Development/olane/copass-harness/python/copass-anthropic-agents/src/copass_anthropic_agents/backends/managed_agent_backend.py` (1231 lines).
- Parent ABC contracts: `/Users/brendon/Development/olane/copass-harness/python/copass-core-agents/src/copass_core_agents/` (`base_agent.py`, `events.py`, `invocation_context.py`, `tool_registry.py`, `base_tool.py`, `scope.py`, `backends/base_backend.py`).
- v1 test suite (Decision 7 classification source):
  - `/Users/brendon/Development/olane/copass-harness/python/copass-anthropic-agents/tests/test_managed_agent_backend.py`
  - `/Users/brendon/Development/olane/copass-harness/python/copass-anthropic-agents/tests/test_mcp_tool_use_handler.py`
  - `/Users/brendon/Development/olane/copass-harness/python/copass-anthropic-agents/tests/test_gateway_wiring.py`
  - `/Users/brendon/Development/olane/copass-harness/python/copass-anthropic-agents/tests/test_bearer_mint.py`
- ADR 0029 (gateway-MCP transport, vault-id threading, `mcp_toolset` wiring): referenced by Decision 5; v2 inherits its surface unchanged.
- Anthropic Managed Agents documentation:
  - https://platform.claude.com/docs/en/managed-agents/events-and-streaming — the canonical stream-first / server-authoritative-`event_ids` contract this ADR's Decision 2 enforces.
  - https://platform.claude.com/docs/en/managed-agents/overview
  - https://platform.claude.com/docs/en/managed-agents/permission-policies
- Sharded-table runbook for the schema migration: `/Users/brendon/Development/olane/o-twin-data-pipeline/CLAUDE.md` § "PlanetScale / Vitess — New Sharded Tables Need a VSchema Entry" (informational — this ADR's ALTER does not change routing and so does not need a VSchema update).
- Production incident traces: cluster `olane-org-001`, 2026-05-13 21:09 / 21:10 UTC; agent `arcus-analyst` (`cbc4396c-c753-4c45-b3f3-51b7e3056763`); user `53df4763-3d2c-4ca7-abea-66ea0c809f1b`.
