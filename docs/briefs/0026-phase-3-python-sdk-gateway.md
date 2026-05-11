# Scaffolding Brief: ADR 0026 Phase 3 — Python SDK Gateway Parity

## Mode: PREPARE

## Goal

Bring `copass-core` (Python) to full parity with `@copass/core` (TS) on the compute lifecycle + ADR 0026 gateway surface. Python ships **no compute resource today** — Phase 3 lands the entire `ComputeResource` (lifecycle methods) + the `ComputeSession` runtime wrapper + the `ComputeGateway` wire type in one package addition. The wire contract is already locked by Phases 1 (server) and 2 (TS); Python just mirrors it.

## Seam

- Target package: `/Users/brendon/Development/olane/copass-harness/python/copass-core/` — PyPI name **`copass-core`** (currently v1.0.6, version pinned via `/Users/brendon/Development/olane/copass-harness/python/VERSION`).
- Layer: client SDK — sits between `HttpClient` (`src/copass_core/http/http_client.py`) and consumer code.
- Sibling resources to mirror for naming / file layout / export style:
  - `/Users/brendon/Development/olane/copass-harness/python/copass-core/src/copass_core/resources/sandboxes.py` — closest analog (sandbox-scoped resource, frozen dataclasses for wire types, `_post`/`_get`/`_patch`/`_delete` via `BaseResource`).
  - `/Users/brendon/Development/olane/copass-harness/python/copass-core/src/copass_core/resources/agents.py` — second analog (per-sandbox base path helper, dataclass `from_dict` pattern for wrapped responses, sub-resource composition via `__init__`).
- Local rules to honor (observed across the package):
  - One resource class per file under `src/copass_core/resources/`.
  - Wire shapes are `@dataclass(frozen=True)` with snake_case fields — pydantic is **NOT** in the dependency tree (`pyproject.toml:21–23` lists only `httpx>=0.27`). Do not introduce pydantic.
  - Public types co-located in the same file as the resource that owns them (per `sandboxes.py`, `agents.py`, `projects.py`). No separate `types/` subpackage.
  - All public methods on resources are `async def`; the package is async-only (no sync client).
  - Re-exports are explicit (no `*` imports) in `src/copass_core/resources/__init__.py` and `src/copass_core/__init__.py`. Match the existing `__all__` style.
  - `BaseResource` is at `src/copass_core/resources/base.py`; subclass it. Use the `_post` / `_get` / `_patch` / `_delete` helpers — never reach into `self._http.request` directly.
  - Method names are snake_case Python (e.g. `list_templates`, `create_session`, `proxy_url`, `websocket_url`) even though the TS surface is camelCase. Wire JSON field names stay snake_case (already the convention server-side and in TS — see `ComputeSessionResponse` in `typescript/packages/core/src/types/compute.ts:105`).

## Existing Abstractions to Reuse

- `BaseResource` — `/Users/brendon/Development/olane/copass-harness/python/copass-core/src/copass_core/resources/base.py:14` — parent class for `ComputeResource`. Exposes `_post` / `_get` / `_patch` / `_delete`. `ComputeSession` does **not** subclass it (it's a runtime wrapper, not a resource).
- `HttpClient` — `/Users/brendon/Development/olane/copass-harness/python/copass-core/src/copass_core/http/http_client.py:81` — owns the auth provider as `self._auth_provider` (private). `ComputeSession.fetch` needs a fresh bearer per call. **Gap:** TS Phase 2 added a public `HttpClient.getAuthSession()` accessor (`typescript/packages/core/src/http/http-client.ts:93` in the worktree); the Python `HttpClient` does not expose its auth provider. Add a sibling `async def get_auth_session(self) -> SessionContext: return await self._auth_provider.get_session()` method on `HttpClient` — minimal, mirrors the TS additive change. Do not change `_auth_provider` visibility.
- `AuthProvider` / `SessionContext` — `/Users/brendon/Development/olane/copass-harness/python/copass-core/src/copass_core/auth/types.py` — `SessionContext.access_token` is the bearer token. Use `f"Bearer {session.access_token}"` (mirrors `http_client.py:105`).
- `CopassClient` — `/Users/brendon/Development/olane/copass-harness/python/copass-core/src/copass_core/client.py:83` — wires every resource. Add `compute: ComputeResource` field declaration (line ~117 block) and `self.compute = ComputeResource(http)` in `__init__` (line ~165 block). Mirror exactly how `agents` is wired.
- `ComputeResource` (TS) — `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/resources/compute.ts` — ground truth for HTTP routes, query params, and request bodies. Mirror method-for-method.
- `ComputeSession` (TS) — `/Users/brendon/Development/olane/copass-harness/.claude/worktrees/0026-phase-2-sdk/typescript/packages/core/src/resources/compute-session.ts` — ground truth for the wrapper class shape, the gateway error message, the URL substitution algorithm, and the `wss://` rewrite.
- `ComputeSessionResponse` + neighbours (TS types) — `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/types/compute.ts` — ground truth for every wire dataclass field. Port one-to-one as `@dataclass(frozen=True)`.

## Conventions Observed

- **Naming**: `ComputeResource`, `ComputeSession`, `ComputeGateway`, `ComputeTemplate`, `ComputeSessionResponse` (wire), `ComputeExecRequest` / `ComputeExecResponse`, `CreateComputeSessionRequest`, `ListComputeSessionsResponse`, `ListComputeTemplatesResponse`, `StopComputeSessionResponse`, `ComputeSessionHealthResponse`, `ListComputeSessionsOptions`, `ListComputeTemplatesOptions`. Match TS names for types so cross-language docs and ADR references line up.
- **File layout**: single new file `src/copass_core/resources/compute.py` holds **both** `ComputeResource` and `ComputeSession` plus all the dataclasses. Rationale: matches the `agents.py` pattern (which holds `AgentsResource` + `AgentTriggersResource` + `WireIntegrationResult` in one file). Do not split into `compute.py` + `compute_session.py` — Python convention here is per-feature, not per-class.
- **Error/logging style**: raise on error. `BaseResource` / `HttpClient` already maps non-2xx to `CopassApiError`. The "gateway not configured" case is plain `ValueError` raised synchronously from `proxy_url` / `websocket_url` / `fetch` before any network call — **no new error class** (locked).
- **Async/sync**: all methods `async def`. No sync variant — `copass-core` is async-only (`README.md:18` `asyncio.run(main())`; every resource method in the package is `async`).
- **Type hints**: strict `from __future__ import annotations`; `Optional[X]` / `Dict[str, Any]` / `Literal[...]`. No pydantic. Use `@dataclass(frozen=True)` with `field(default_factory=...)` for mutable defaults — see `sandboxes.py:21` and `agents.py:39` for the exemplar.
- **Dataclass `from_dict` pattern**: when a method returns a wrapped instance (the way `agents.py:67` does `WireIntegrationResult.from_dict`), define a `@classmethod from_dict(cls, payload)`. The wire shape from `_get`/`_post` is a `Dict[str, Any]`; the resource calls `from_dict` to lift it. Use this for `ComputeSessionResponse` so `ComputeSession.__init__` can accept the lifted record.

## Cross-Cutting Concerns to Respect

- **Bearer auth on every gateway call** — `ComputeSession.fetch` MUST pull a fresh bearer per call from the `HttpClient` (via the new `get_auth_session()` accessor). Tokens rotate (the TS implementation pins this; `httpx` retries / cache is irrelevant here). Do NOT cache the token at construction.
- **Gateway envelope shape** (locked by Phase 1 server-side):
  ```json
  {
    "session_id": "...",
    "status": "running",
    "gateway": {
      "base_url": "https://staging-gateway.copass.id",
      "url_template": "{base_url}/compute/{session_id}/p/{port}{path}",
      "kind": "edge-proxy-v1"
    }
  }
  ```
  - Add a `ComputeGateway` dataclass with fields `base_url: str`, `url_template: str`, `kind: str` (use `Literal["edge-proxy-v1"]` for `kind` — matches TS `kind: "edge-proxy-v1"`).
  - Add `gateway: Optional[ComputeGateway] = None` field on `ComputeSessionResponse`. Optional because deployments without the feature won't return it.
  - Server-side Pydantic model: `ComputeGatewayInfo` in `frame_graph/copass_id/api/models.py` — keep field names in lock-step with it.
- **URL construction is template substitution** — never string concatenation. Substitute `{base_url}`, `{session_id}`, `{port}`, `{path}` into `record.gateway.url_template`. Use Python `str.replace` (NOT `str.format` — the template has literal braces in real wire data and `format` will choke on missing keys). Mirror the TS implementation byte-for-byte.
- **`websocket_url` scheme rewrite** — `https://` → `wss://`, `http://` → `ws://`. Pure prefix swap, no other transformation. Same algorithm as TS lines 86–91 of the worktree `compute-session.ts`.
- **`fetch` is a passthrough** — `httpx.AsyncClient` direct call, NOT through `HttpClient.request`. Adds the bearer header + the gateway-resolved URL; everything else (method, body content, headers, timeout) flows through to httpx untouched. **No retries, no JSON serialization, no JSON parsing, no error normalization.** Caller decides what to do with the `httpx.Response`. ADR 0026 §"TypeScript SDK" / §"Python SDK" forbids any of those wrappings on the proxy path; binary uploads, SSE, and intentional 4xx bodies must flow through unmodified.
  - Add a one-line code comment at the `httpx` call citing ADR 0026 so future reviewers don't "fix" it by routing through `HttpClient`.
- **Caller-supplied headers merge** — caller's `headers` kwarg merges with the bearer header; bearer always wins on the `Authorization` key (matches TS lines 113–115: "Caller headers take precedence ONLY if they collide on a non-auth key; the bearer always wins").
- **Path is caller's responsibility** — no auto-prepend of `/`. `session.fetch(3000, "")` substitutes `{path}` = `""` (bare per-port URL, no trailing slash). `session.fetch(3000, "/api/v1/x")` substitutes `{path}` = `/api/v1/x`. Two unit tests pin this.
- **No JSON assumption** — `fetch` returns the raw `httpx.Response`. Caller decides `.json()` / `.text` / `.content` / streaming.
- **Public-surface invariants** (per ADR 0020 / Phase 1):
  - `session_id` is platform-issued (opaque UUID).
  - `external_session_id` NEVER appears on the wire — do not add it as a field.
  - Reserved metadata keys (`user_id`, `sandbox_id`, `agent_id`, `run_id`) are stripped server-side — don't reintroduce them in client typings.

## Architectural Call-out (locked)

`ComputeSession.fetch` calls `httpx.AsyncClient(...).request(...)` directly. It does **NOT** route through `HttpClient.request` / `BaseResource._get|_post|_delete` used by every other resource method. Same rationale as the TS Phase 2 brief: the shared `HttpClient` enforces JSON serialization, JSON parsing, retry, and error normalization — all of which break the gateway's transparent passthrough contract. The auth surface is identical (bearer), so reusing the auth provider is correct; reusing `HttpClient.request` is not.

The implementer MUST add a one-line code comment at the `httpx` call citing ADR 0026.

## Billing & Cost Impact

- **Cost path**: None directly. Phase 3 is an SDK wrapper. Paid calls (LLM, embeddings) happen inside the sandbox process, behind the gateway, on the server side — already gated by `CreditGate` per ADR 0020 / Phase 1 wiring.
- **Credit gate / billing wrapper**: N/A on the client. Server-side `createSession` and the gateway proxy go through the gate as wired in `frame_graph/copass_id/api/agents.py` / `frame_graph/copass_id/agents/runtime.py` per `CLAUDE.md` "Billing — every paid call goes through the credit gate". This brief does not change that.
- **Pricing posture**: N/A on the client. Respects whatever `config.stripe.gate_mode` is set to server-side. Same mode flag as user-initiated runs.
- **Cost-surprise vectors**: One worth flagging — `session.fetch` is a thin passthrough, so a misbehaving caller can hammer the sandbox in a tight loop. That's a sandbox-side rate-limit problem (server's responsibility), not an SDK problem; flag it for a later ADR if not already tracked.
- **Attribution / ledger**: N/A on the client. Server stamps ledger rows during session creation per ADR 0020.
- **Per-surface posture**: identical to TS Phase 2 — this SDK does not introduce a new surface. No bypass.

## Tests

- Test directory: `/Users/brendon/Development/olane/copass-harness/python/copass-core/tests/test_full/`. Tests use **pytest + respx + httpx** with `asyncio_mode = "auto"` (`pyproject.toml:47`). Mock pattern is established in `tests/test_full/test_sandboxes.py` and `tests/test_full/test_agents.py`.
- Shared fixture: `tests/test_full/conftest.py:19` exposes a `client` fixture wired to `http://test`. Use it.
- Recommended new file: `/Users/brendon/Development/olane/copass-harness/python/copass-core/tests/test_full/test_compute.py`.
- **Mock pattern recap** (from `test_sandboxes.py`):
  ```python
  @respx.mock
  async def test_create_session(client: CopassClient) -> None:
      route = respx.post("http://test/api/v1/storage/sandboxes/sb-1/compute/sessions").mock(
          return_value=httpx.Response(200, json={...wire shape with `gateway`...}),
      )
      session = await client.compute.create_session("sb-1", template="copass-hermes-py311")
      assert isinstance(session, ComputeSession)
      assert session.session_id == "..."
      body = json.loads(route.calls.last.request.content)
      assert body == {"template": "copass-hermes-py311"}
  ```
- **Test plan — at minimum**:
  1. `test_list_templates` — URL is `…/compute/templates`, optional `provider` query param.
  2. `test_create_session` — `POST …/compute/sessions`, body shape includes `template`, optional `timeout_seconds` / `env_vars` / `metadata`. Returns a `ComputeSession` instance (assert `isinstance`).
  3. `test_list_sessions` — `GET …/compute/sessions` with optional `include_stopped=true` / `limit=N` query params. Returned envelope has `sessions: List[ComputeSession]`; assert each element `isinstance(_, ComputeSession)`.
  4. `test_get_session` — `GET …/compute/sessions/{session_id}` returns `ComputeSession`.
  5. `test_stop_session` — `DELETE …/compute/sessions/{session_id}`, returns `StopComputeSessionResponse` dataclass (NOT wrapped).
  6. `test_exec` — `POST …/compute/sessions/{session_id}/exec`, body includes `cmd`, optional `stdin` / `timeout_seconds`.
  7. `test_session_health` — `GET …/compute/sessions/{session_id}/health`.
  8. `test_proxy_url_no_path` — `session.proxy_url(3000, "")` substitutes `{path}` = `""` (no trailing slash); compare exact URL against `url_template` substitution.
  9. `test_proxy_url_with_path` — `session.proxy_url(3000, "/api")` substitutes `{port}` = `3000`, `{path}` = `/api`.
  10. `test_websocket_url` — `session.websocket_url(3000)` returns `wss://...` (rewritten from `https://`); cover `http://` → `ws://` too.
  11. `test_absent_gateway_raises` — session record without `gateway` envelope: `proxy_url` / `websocket_url` / `fetch` raise `ValueError` with the locked message ("Gateway is not configured on this Copass deployment. ..."). Three assertions in one test or three separate tests — either is fine; `test_sandboxes.py` style favours three.
  12. `test_fetch_passthrough` — `respx.mock` a route at the resolved gateway URL (e.g. `https://staging-gateway.copass.id/compute/{session_id}/p/3000/foo`). Call `await session.fetch(3000, "/foo", method="POST", content=b"x")`. Assert (a) returned value is an `httpx.Response`, (b) the request URL is the substituted gateway URL, (c) `Authorization: Bearer olk_test` header is present, (d) body bytes were forwarded untouched, (e) `Content-Type` (or any other caller-supplied header) flows through.
  13. `test_fetch_pulls_fresh_bearer` — make `fetch` twice, assert the auth provider's `get_session` was awaited twice (mock the auth surface; pattern: stub `client._http._auth_provider.get_session`).

- Do not test the `HttpClient.request` path is NOT invoked (Python's mock framework makes this awkward; skip — coverage from `test_fetch_passthrough` proving the URL hits the gateway endpoint is sufficient).

## Gaps

- **One small additive `HttpClient` change** — add `async def get_auth_session(self) -> SessionContext: return await self._auth_provider.get_session()` on `HttpClient` (`src/copass_core/http/http_client.py:81`). Mirrors TS Phase 2's `getAuthSession()` accessor. Not a breaking change.
- **No new error class.** Use `ValueError` for the gateway-absent case.
- **No new HTTP transport.** `httpx.AsyncClient` is already a dependency (`pyproject.toml:22`).

## Phased Build Plan (dependency-first, bottom-up)

- **Phase 1 — Foundations** (leaves: dataclasses, types):
  - All compute dataclasses in `src/copass_core/resources/compute.py` (one file, mirrors `agents.py`):
    - `ComputeProvider` — `Literal["daytona", "e2b"]` (use plain `str` if matching TS's open union; TS uses `'daytona' | 'e2b' | (string & {})` — Python equivalent is `str` with a docstring noting the convention).
    - `ComputeSessionStatus` — `Literal[...]` of `"provisioning" | "running" | "idle" | "stopped" | "archived" | "failed"`. Or `str` if you want open-union parity. Default to `str` (Python doesn't have TS's open-union escape hatch and `Literal` will reject server-side new values, breaking SDK consumers — open `str` is safer for forward-compat).
    - `ComputeSessionHealthStatus` — same call (`str`).
    - `@dataclass(frozen=True) ComputeTemplate` — fields `name: str`, `provider: str`, `cpu_count: int`, `memory_mb: int`, `description: str`.
    - `@dataclass(frozen=True) ListComputeTemplatesResponse` — `templates: List[ComputeTemplate]`.
    - `@dataclass(frozen=True) ComputeGateway` — `base_url: str`, `url_template: str`, `kind: str = "edge-proxy-v1"`.
    - `@dataclass(frozen=True) ComputeSessionResponse` — `session_id: str`, `template: str`, `status: str`, `provisioned_at: str`, `deadline_at: str`, `last_activity_at: str`, `metadata: Dict[str, str]` (default `field(default_factory=dict)`), `gateway: Optional[ComputeGateway] = None`. Add `@classmethod from_dict(cls, payload: Dict[str, Any]) -> "ComputeSessionResponse"` that lifts `gateway` via `ComputeGateway(**payload["gateway"])` if present.
    - `@dataclass(frozen=True) ListComputeSessionsResponse` — `sessions: List[ComputeSession]` (NOTE: this is the wrapped type, not `ComputeSessionResponse` — see Phase 3 wiring).
    - `@dataclass(frozen=True) ComputeExecResponse` — `stdout: str`, `stderr: str`, `exit_code: int`, `elapsed_ms: int`, `truncated: bool`.
    - `@dataclass(frozen=True) ComputeSessionHealthResponse` — `session_id: str`, `status: str`, `last_activity_at: str`.
    - `@dataclass(frozen=True) StopComputeSessionResponse` — `session_id: str`, `status: str`.
  - Depends on: nothing project-internal.

- **Phase 2 — Contracts** (the `HttpClient` accessor):
  - Add `async def get_auth_session(self) -> SessionContext` to `HttpClient` — `src/copass_core/http/http_client.py:81`. One-line method. Depends on: nothing.

- **Phase 3 — Implementations** (the wrapper class + the resource):
  - `ComputeSession` class in `src/copass_core/resources/compute.py`:
    - Constructor: `def __init__(self, http: HttpClient, record: ComputeSessionResponse) -> None`. Field-copy every attribute of `record` to `self.<field>` (mirrors TS lines 50–61). Also store `self.record = record` and `self._http = http`.
    - `def proxy_url(self, port: int, path: str = "") -> str` — calls `self._require_gateway()`, then four `.replace()` calls on `gw.url_template` for `{base_url}`, `{session_id}`, `{port}` (cast to `str`), `{path}`.
    - `def websocket_url(self, port: int, path: str = "") -> str` — calls `self.proxy_url(port, path)`, then prefix-swaps `https://` → `wss://` or `http://` → `ws://`.
    - `async def fetch(self, port: int, path: str, **kwargs) -> httpx.Response` — builds URL via `proxy_url`; pulls bearer via `await self._http.get_auth_session()`; merges `kwargs.get("headers", {})` with `{"Authorization": f"Bearer {session.access_token}"}` (bearer wins on the `Authorization` key); calls `httpx.AsyncClient(timeout=...)` directly:
      ```python
      # Bypassing HttpClient.request on purpose — the gateway is a
      # transparent passthrough. ADR 0026 §"Python SDK".
      method = kwargs.pop("method", "GET")
      headers = {**(kwargs.pop("headers", {}) or {}), "Authorization": f"Bearer {session.access_token}"}
      async with httpx.AsyncClient() as c:
          return await c.request(method, url, headers=headers, **kwargs)
      ```
      Note on the merge order: caller `headers` go in first, bearer overwrites — matches TS "bearer always wins". Pin with a unit test.
    - `def _require_gateway(self) -> ComputeGateway` — raises `ValueError(GATEWAY_NOT_CONFIGURED)` if `self.gateway is None`. Module-level constant for the message — copy verbatim from TS `GATEWAY_NOT_CONFIGURED` (lines 25–29 of the worktree `compute-session.ts`).
  - `ComputeResource(BaseResource)` class in same file:
    - `_BASE = "/api/v1/storage/sandboxes"`, `def _compute_base(sandbox_id: str) -> str: return f"{_BASE}/{sandbox_id}/compute"`.
    - `async def list_templates(self, sandbox_id, *, provider=None) -> ListComputeTemplatesResponse` → `_get(f"{_compute_base(...)}/templates", query={"provider": provider})`. Lift via `ListComputeTemplatesResponse(templates=[ComputeTemplate(**t) for t in payload["templates"]])`.
    - `async def create_session(self, sandbox_id, *, template, env_vars=None, timeout_seconds=None, metadata=None) -> ComputeSession`. Body shape mirrors TS `CreateComputeSessionRequest`. Lift response via `ComputeSessionResponse.from_dict(payload)`, wrap with `ComputeSession(self._http, record)`.
    - `async def list_sessions(self, sandbox_id, *, include_stopped=None, limit=None) -> ListComputeSessionsResponse`. Build query map matching TS `listSessions` (`include_stopped` → `'true'` string when True, `limit` → `str(limit)`). Map each element to `ComputeSession(self._http, ComputeSessionResponse.from_dict(s))`. Return `ListComputeSessionsResponse(sessions=...)`.
    - `async def get_session(self, sandbox_id, session_id) -> ComputeSession` — same lift+wrap as `create_session`.
    - `async def stop_session(self, sandbox_id, session_id) -> StopComputeSessionResponse` — `DELETE`, lift to dataclass.
    - `async def exec(self, sandbox_id, session_id, *, cmd, stdin=None, timeout_seconds=None) -> ComputeExecResponse`. Body shape mirrors TS `ComputeExecRequest`.
    - `async def session_health(self, sandbox_id, session_id) -> ComputeSessionHealthResponse`.
  - **Note on `BaseResource._http` access**: `BaseResource.__init__` stores the client as `self._http`. `ComputeResource` already has access via `self._http`. Pass it into `ComputeSession` constructor — no new accessor on `BaseResource` needed.
  - Depends on: Phases 1–2.

- **Phase 4 — Wiring** (CopassClient + re-exports):
  - Edit `src/copass_core/client.py`:
    - Add `from copass_core.resources.compute import ComputeResource` (with the existing resource imports, line 30 block).
    - Declare `compute: ComputeResource` in the class body, alongside the other field declarations (line 117 block).
    - `self.compute = ComputeResource(http)` in `__init__`, in the agents-block (line 165).
  - Edit `src/copass_core/resources/__init__.py`:
    - Add `from copass_core.resources.compute import ( ComputeResource, ComputeSession, ComputeGateway, ComputeTemplate, ComputeSessionResponse, ListComputeTemplatesResponse, ListComputeSessionsResponse, ComputeExecResponse, ComputeSessionHealthResponse, StopComputeSessionResponse, )`.
    - Append all 10 names to the file's `__all__` (in a new `# Compute` block matching the existing `# Agents` block style).
  - Edit `src/copass_core/__init__.py`:
    - Add the same 10 names to the import block from `copass_core.resources` (lines 53–85 block).
    - Add a `# Resources — compute` block to `__all__` (mirrors the `# Resources — agents` block).
  - Depends on: Phases 1–3.

- **Phase 5 — Integration** (tests + docs + version):
  - New test file `tests/test_full/test_compute.py` covering the 13 cases listed under "Tests" above.
  - README update — add a `## Reaching your sandbox` section to `python/copass-core/README.md`. Per ADR 0026 §"README skeletons", 5–8 lines of example. Mirror the TS README — the canonical snippet:
    ```python
    session = await client.compute.create_session(
        sandbox_id, template="copass-hermes-py311", timeout_seconds=600,
    )
    # Hit port 3000 inside the sandbox via the public gateway.
    resp = await session.fetch(3000, "/api/v1/health")
    print(resp.status_code, await resp.aread())
    print(session.proxy_url(3000, "/dashboard"))      # https://...
    print(session.websocket_url(8080, "/ws"))         # wss://...
    await client.compute.stop_session(sandbox_id, session.session_id)
    ```
    Place the section between `## Available resources` (line 52) and `## Conversation metadata` (line 86).
  - **Optional** — `python/copass-agent-router/src/copass_agent_router/__init__.py` does not currently re-export any compute types. Add a `from copass_core import ComputeSession, ComputeGateway` block + `__all__` entries IF the implementer wants symmetry with the TS `agent-router` re-export pattern. Locked: this is **not required** — the package's pre-existing pattern is to only re-export `AgentEvent` types from `copass_core_agents`, not from `copass_core`. Skip unless the user explicitly requests it.
  - Version bump: edit `/Users/brendon/Development/olane/copass-harness/python/VERSION` from `1.0.6` → `1.1.0`. Additive feature, minor bump per the existing release pipeline (no breaking API change; `compute` is brand-new). The version is shared across all 11 Python packages in `python/` — that's fine, the existing release pipeline cuts them together.

Notes: collapse Phases 1+2+3+4 into a single PR (the type additions, the new `HttpClient` accessor, the resource implementation, and the re-exports are tightly coupled and reviewable as one diff). Tests, README, and VERSION ride in the same PR. The build is linear, not parallelizable.

## Verification commands

Run from `/Users/brendon/Development/olane/copass-harness/python/copass-core/`:

```bash
# Editable install with dev extras (one-time)
pip install -e ".[dev]"

# Tests
pytest tests/test_full/test_compute.py -v
pytest tests/                                  # full package suite, asserts no regression

# Type-check
mypy --strict packages copass_core             # OR: mypy src

# Lint
ruff check src tests
ruff format --check src tests

# Build
python -m build
```

If a release is being cut concurrently, the harness-level release pipeline lives at `python/scripts/` — use it; do NOT hand-craft `twine upload` invocations.

## Don't do

- **Don't introduce a new error class** for the gateway-absent case. Plain `ValueError` per the locks.
- **Don't add retries / JSON parsing / body shaping** to `ComputeSession.fetch`. It's a passthrough. Caller decides.
- **Don't route `fetch` through `HttpClient.request`.** Direct `httpx.AsyncClient` call. Add the ADR comment.
- **Don't auto-prepend `/`** to `path` in `proxy_url` / `websocket_url` / `fetch`. Caller's responsibility.
- **Don't introduce pydantic** to `copass-core` for this work. The package is plain dataclasses today (`pyproject.toml:21–23`); keep it that way.
- **Don't expose `external_session_id`** or any reserved metadata key on the wire types.
- **Don't add a sync variant.** `copass-core` is async-only.
- **Don't wire compute into `copass-agent-router`** (Python). The TS agent-router re-exports are a TS-only convention; the Python equivalent doesn't re-export from `copass_core` and there's no value in starting now. Optional / skipped per locks.
- **Don't ship the `olane-docs` "Reaching your sandbox" public docs page in this phase.** That's an `olane-docs` follow-up, tracked separately. Phase 3 is the **last phase of ADR 0026** for this codebase, and the docs-site page is the only remaining loose end — flag it in the PR description so it doesn't fall off the radar, but it's not in scope here.
- **Don't expose `_auth_provider` publicly.** Add the `get_auth_session()` accessor and use that.
- **Don't restart any local or remote services** to test this. Unit tests + respx mocks cover everything; no infra surface is touched.

## Hand-off to AUDIT

Once the implementation lands, the AUDIT step should verify:

1. Every TS `ComputeResource` method has a Python sibling with snake_case naming, identical HTTP route, and identical request body shape. Diff `src/copass_core/resources/compute.py` against `typescript/packages/core/src/resources/compute.ts` route-by-route.
2. `ComputeSession.fetch` does NOT route through `HttpClient.request` — grep the implementation for `self._http.request` (should not appear) and confirm `httpx.AsyncClient` is called directly. Confirm the ADR 0026 comment is at the call site.
3. `proxy_url("", path)` and `proxy_url("/api")` both produce the URL the test expects (no trailing slash on the empty path; literal substitution on the non-empty path).
4. `ComputeGateway` field names match the server-side `ComputeGatewayInfo` Pydantic model in `frame_graph/copass_id/api/models.py` byte-for-byte.
5. The `gateway` field on `ComputeSessionResponse` is `Optional` (not required) — deployments without the feature must round-trip cleanly.
6. The `ValueError` message text matches the TS `GATEWAY_NOT_CONFIGURED` constant verbatim (cross-language consistency for log-grep).
7. `pyproject.toml` is unchanged (no new deps); `VERSION` bumped to `1.1.0`.
8. `tests/test_full/test_compute.py` runs green and covers all 13 cases listed under "Tests".
9. Re-exports in `src/copass_core/__init__.py` and `src/copass_core/resources/__init__.py` include all 10 new public names; `__all__` is updated.
10. README has the `## Reaching your sandbox` section.

## Docs Written

- `/Users/brendon/Development/olane/copass-harness/docs/briefs/0026-phase-3-python-sdk-gateway.md` — this brief (created).
- README update lives in the implementation PR (per "Phase 5 — Integration"); not separately scaffolded here.
- TODO for the implementer: file the `olane-docs` follow-up issue for the public "Reaching your sandbox" page (cross-SDK doc, mirror of the ADR 0026 README skeleton). Out of scope for Phase 3.
