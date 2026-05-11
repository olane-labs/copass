# Scaffolding Brief: ADR 0026 Phase 2 — TypeScript SDK Gateway Surface

## Mode: PREPARE

## Intent

Phase 2 of ADR 0026 lands the **client-side `ComputeSession` runtime wrapper** in `@copass/core`. ADR 0026 Phase 1 was a server-side change (FastAPI gateway envelope on the existing compute endpoints) — it did **not** touch the harness. The TS-side compute surface that exists today was shipped by **ADR 0020 (Compute Router v1)** and lives at `typescript/packages/core/src/resources/compute.ts`.

The shape of this Phase 2:

1. The existing `ComputeResource` keeps every public method it has today (`listTemplates`, `createSession`, `listSessions`, `getSession`, `stopSession`, `exec`, `sessionHealth`). No `compute.sessions` sub-resource is introduced.
2. The return values of `createSession`, `getSession`, and `listSessions` are wrapped so the caller receives a `ComputeSession` **class instance** instead of a bare `ComputeSessionResponse` POJO. The instance carries every field of the wire shape and adds three new methods: `proxyUrl(port, path?) → string`, `websocketUrl(port, path?) → string`, and `fetch(port, path, init?) → Promise<Response>` that hit the per-session reverse-proxy gateway with a fresh bearer token per call. The wrapper substitutes `{base_url}`, `{session_id}`, `{port}`, `{path}` placeholders into `record.gateway.url_template` — it does not concatenate strings.
3. `exec`, `stopSession`, `sessionHealth`, `listTemplates` return shapes are unchanged.

This brief is the locked plan. It is the source of truth for the implementer.

## Seam

- Target package: `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/` — npm name **`@copass/core`** (v0.8.1).
- Layer: client SDK — sits between `HttpClient` (transport) and consumer code (`@copass/agent-router`, agents).
- Sibling resources to mirror for naming / file layout / export style:
  - `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/resources/compute.ts` (the resource being augmented)
  - `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/resources/sandboxes.ts`
  - `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/resources/agents.ts`
- Local rules to honor:
  - One class per file; types co-located in `src/types/<resource>.ts`.
  - Re-exports from `src/index.ts` are explicit (no barrel `export *`); `src/resources/index.ts` and `src/types/index.ts` follow the same explicit pattern.
  - Resource classes extend `BaseResource` (`src/resources/base.ts`); `ComputeSession` does NOT extend it (it's a wrapper, not a resource).

## Existing Abstractions to Reuse

- `BaseResource` — `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/resources/base.ts` — the parent of every resource class; exposes `this.get / this.post / this.delete` over the underlying `HttpClient`. `ComputeResource` already extends it; `ComputeSession` does not.
- `ComputeResource` — `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/resources/compute.ts` — augmented in-place (no new file, no sub-resource). The three return-wrapping methods are `createSession` (line ~70), `getSession` (line ~101), `listSessions` (line ~85). `stopSession`, `exec`, `sessionHealth`, `listTemplates` are NOT wrapped.
- `ComputeSessionResponse` and surrounding types — `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/types/compute.ts` — the wire shape. `ComputeSession` carries every field of `ComputeSessionResponse` (via composition or field-by-field) plus the `fetch()` method. The wire types are NOT renamed.
- `CopassClient` constructor — `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/client.ts:122` — already wires `this.compute = new ComputeResource(http)`. No change needed here; `ComputeResource` already holds the `HttpClient` it needs to pass into each `ComputeSession`.
- `CopassApiError`, `CopassNetworkError`, `CopassValidationError` — `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/http/errors.ts` — used for non-2xx normalization on the resource path. The "gateway not configured" case is a plain `Error` (locked decision), not a new typed class.

## Conventions Observed

- **Naming**: `ComputeSession` (class, runtime wrapper). Wire types keep their existing `*Response` / `*Request` suffixes (e.g. `ComputeSessionResponse`). Do NOT rename existing exported types.
- **File layout**:
  - `src/resources/compute.ts` — existing `ComputeResource` (edit in place to wrap returns).
  - `src/resources/compute-session.ts` — NEW; `ComputeSession` class (sibling of `compute.ts`, one class per file).
  - `src/types/compute.ts` — existing types file. The new `ComputeGateway` interface and the `gateway?: ComputeGateway` field on `ComputeSessionResponse` go here, not in a new file.
- **Error/logging style**: Throw, don't log. `BaseResource` / `HttpClient` map non-2xx to `CopassApiError`. The gateway-config error is the single exception (plain `Error`, thrown synchronously from `ComputeSession.fetch` before the network call).
- **Async/sync**: All public methods async. `createSession` / `getSession` return `Promise<ComputeSession>`; `listSessions` returns `Promise<{ sessions: ComputeSession[] }>` (preserving the existing envelope shape, with `sessions[i]` swapped to `ComputeSession` instances).
- **Type hints**: Strict TS; ESM (`type: "module"`); zod available but not required for this surface; `vitest` for tests.
- **Imports use `.js` suffix** even for `.ts` source files (ESM-compatible TS) — every existing file in `src/resources/` does this; match it.

## Cross-Cutting Concerns to Respect

- **Bearer auth on every gateway call** — `ComputeSession.fetch` MUST pull the bearer token from the underlying `HttpClient`'s auth provider per request. Tokens rotate; do not cache at construction time. The exact accessor depends on the `HttpClient` shape — verify in `src/http/http-client.ts` before writing the call.
- **Gateway envelope** — comes from a nested object on the session record. The current `ComputeSessionResponse` (in `src/types/compute.ts`) does NOT include a `gateway` field; ADR 0026 Phase 1 (PR #504, just merged — Pydantic model `ComputeGatewayInfo` in `frame_graph/copass_id/api/models.py`) added the nested `gateway: { base_url, url_template, kind }` envelope server-side. The wire shape is:

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

  Phase 2 must (a) add a new `ComputeGateway` interface AND a `gateway?: ComputeGateway` field on `ComputeSessionResponse` in `src/types/compute.ts`, and (b) have `ComputeSession.fetch` / `proxyUrl` / `websocketUrl` throw a plain `Error` synchronously when `record.gateway` is absent (deployments without the gateway feature). URL construction uses placeholder substitution against `record.gateway.url_template` — never string concatenation.
- **Public surface invariants** — preserve them. Per the existing types file: `session_id` is platform-issued; `external_session_id` never appears here; reserved metadata keys (`user_id`, `sandbox_id`, `agent_id`, `run_id`) are stripped server-side. `ComputeSession` MUST NOT reintroduce any of these as fields or accept them in the `fetch` path.
- **Path is caller's responsibility** — `{path}` in the template always starts with `/` or is empty string (per ADR 0026 §"The `gateway` Envelope (locked)"). `session.fetch(3000, "")` substitutes `{path}` with `""`; `session.fetch(3000, "/api/v1/x")` substitutes `{path}` with `/api/v1/x`. Two unit tests pin this.
- **No JSON assumption** — `session.fetch` returns the raw `Response`. Caller decides `.json()` / `.text()` / streaming. ADR 0026 explicitly forbids forcing JSON on the proxy path.

## Architectural Call-out (locked)

`ComputeSession.fetch` calls **`globalThis.fetch` directly** with the bearer header pulled from the SDK's auth provider. It does **NOT** route through the `HttpClient.request` / `BaseResource.get|post|delete` path used by every other resource method.

Rationale (per ADR 0026, restated here so this doesn't drift in review):

- The shared `HttpClient` enforces JSON serialization on the request body, JSON parsing on the response, and applies the SDK's retry / error-normalization policy. The gateway proxy is a transparent passthrough — any of those behaviors break legitimate sandbox traffic (binary uploads, SSE, non-JSON 4xx bodies, intentional 404s the caller wants to inspect).
- The auth surface is identical (`Authorization: Bearer <token>`), so reusing the auth provider is correct; reusing `HttpClient.request` is not.

The implementer MUST add a one-line code comment at the `globalThis.fetch` call citing ADR 0026 so the next reviewer doesn't "fix" it.

## Billing & Cost Impact

- **Cost path**: None directly. Phase 2 is an SDK wrapper. Paid calls (LLM, embeddings) happen inside the sandbox process, behind the gateway, on the server side — already gated by `CreditGate` per the existing ADR 0020 wiring.
- **Credit gate / billing wrapper**: N/A on the client. Server-side `createSession` and the gateway proxy go through the gate as wired by ADR 0020 / ADR 0026 Phase 1; this brief does not change that.
- **Pricing posture**: N/A on the client. Respects whatever `config.stripe.gate_mode` is set to server-side.
- **Cost-surprise vectors**: One worth noting — `session.fetch` is a thin wrapper, so a misbehaving caller can hammer the sandbox in a tight loop. That's a sandbox-side rate-limit problem, not an SDK problem; flag it for a later phase if not already tracked.
- **Attribution / ledger**: N/A on the client. Server stamps ledger rows during session creation per ADR 0020.
- **Per-surface posture**: Same gate flag as user-initiated runs. No bypass.

## Tests

- Test directory: `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/test/unit/resources/full/`. Tests are NOT colocated with source — they live under `test/` at the package root.
- Style observed in `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/test/unit/resources/full/compute.test.ts`: vitest; `globalThis.fetch` is mocked via the `mockFetch` / `lastFetchCall` / `jsonResponse` / `makeClient` helpers in `test/unit/resources/full/_helpers.ts`. Tests assert URL, method, body shape, and now (Phase 2) that returned values are `ComputeSession` instances.
- Recommended test plan — extend the existing `compute.test.ts` rather than fragment:
  - Update `createSession`, `getSession`, `listSessions` cases to assert `instanceof ComputeSession` on the returned value(s).
  - Add a small `compute-session.test.ts` (same directory) covering `ComputeSession.fetch` / `proxyUrl` / `websocketUrl` in isolation:
    - `session.proxyUrl(3000)` (no path) → template-substituted with `{path}` = `""` (no trailing slash).
    - `session.proxyUrl(3000, "/api")` → template-substituted with `{port}` = `3000`, `{path}` = `/api`.
    - `session.websocketUrl(3000, "/ws")` → starts with `wss://` (rewritten from `https://`).
    - `session.fetch(3000, "/api/v1/x")` → URL substituted via `url_template` with the right `{port}` and `{path}`.
    - Missing `gateway` envelope on the underlying record → `proxyUrl` / `websocketUrl` / `fetch` throw the locked `Error` synchronously.
    - Bearer header is pulled fresh per call (mock the auth surface, assert it's invoked twice across two `fetch(port, path)` calls).
    - `globalThis.fetch` is the call surface; `HttpClient.request` is NOT invoked (mock both, assert which was hit).

## Gaps

- **Two client-visible type additions** in `src/types/compute.ts`:
  1. New `ComputeGateway` interface — `{ base_url: string; url_template: string; kind: "edge-proxy-v1" }`.
  2. New `gateway?: ComputeGateway` field on `ComputeSessionResponse`. Optional because deployments without the gateway feature won't return it.

  These mirror the server-side `ComputeGatewayInfo` Pydantic model in `frame_graph/copass_id/api/models.py`.
- No new error class, no new transport layer, no new auth surface.

## Phased Build Plan (dependency-first, bottom-up)

- **Phase 1 — Foundations** (leaves: type surface):
  - Add `ComputeGateway` interface and `gateway?: ComputeGateway` field on `ComputeSessionResponse` — `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/types/compute.ts` — depends on: nothing.

    ```ts
    export interface ComputeGateway {
      base_url: string;
      url_template: string;
      kind: "edge-proxy-v1";
    }
    ```

- **Phase 2 — Implementations** (the wrapper class consumed by the resource):
  - `ComputeSession` class — `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/resources/compute-session.ts` — depends on: Phase 1 types, the `HttpClient` instance owned by `ComputeResource` (constructor-injected), the auth provider reachable through that client.
    - Constructor: `(http: HttpClient, record: ComputeSessionResponse)`.
    - Exposes every field of `ComputeSessionResponse` (either via field-copy or a `record` getter — pick whichever the existing wrapper-style siblings prefer; verify against `ContextWindow` if there's an analogous wrapper, otherwise field-copy is the default).
    - Locked TS interface (per ADR 0026 §"TypeScript SDK — `ComputeSession` interface (shape)"):

      ```ts
      export class ComputeSession {
        readonly id: string;
        readonly gateway: ComputeGateway;
        // ...other existing fields...

        proxyUrl(port: number, path?: string): string;
        websocketUrl(port: number, path?: string): string;
        fetch(port: number, path: string, init?: RequestInit): Promise<Response>;
      }
      ```

    - `proxyUrl(port, path?)` — substitutes `{base_url}`, `{session_id}`, `{port}`, `{path}` into `record.gateway.url_template`. `path` defaults to `""`.
    - `websocketUrl(port, path?)` — same substitution, then rewrite leading `https://` → `wss://` (and `http://` → `ws://`). SDK's responsibility per ADR §"The `gateway` Envelope (locked)".
    - `fetch(port, path, init?)` — builds the URL via `proxyUrl(port, path)`, then calls `globalThis.fetch` directly with bearer header from the auth provider.
    - All three methods throw plain `Error("Gateway is not configured on this Copass deployment. ...")` synchronously when `record.gateway` is absent.

- **Phase 3 — Wiring** (the resource wraps its return values):
  - Edit `ComputeResource` — `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/resources/compute.ts` — depends on: Phases 1–2.
    - `createSession` — wrap response: `return new ComputeSession(this.http, raw)`.
    - `getSession` — same wrap.
    - `listSessions` — wrap each element: `result.sessions = result.sessions.map(r => new ComputeSession(this.http, r)); return result`.
    - `stopSession`, `exec`, `sessionHealth`, `listTemplates` — UNCHANGED.
    - The `this.http` reference must be exposed on `BaseResource` (it likely already is as `protected`) — verify and, if not, add a minimal accessor; do not duplicate the http instance on `ComputeResource`.
  - Note on signature change: `createSession` / `getSession` change return type from `Promise<ComputeSessionResponse>` to `Promise<ComputeSession>`. This is technically a breaking change for type-only consumers; `@copass/core` is at 0.8.1 (pre-1.0), so a minor bump is acceptable per semver-zero conventions. Call this out in the changeset.

- **Phase 4 — Integration** (call sites):
  - Re-export `ComputeSession` (value), `ComputeGateway` (type), and the new `gateway?` field — the field rides on `ComputeSessionResponse` which is already re-exported.
  - Edit `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/index.ts` — add `export { ComputeSession } from './resources/compute-session.js';` next to the existing `export { ComputeResource } from './resources/compute.js';` (line 129). Add `ComputeGateway` to the type re-export block alongside `ComputeSessionResponse`.
  - Edit `/Users/brendon/Development/olane/copass-harness/typescript/packages/core/src/resources/index.ts` — add `export { ComputeSession } from './compute-session.js';` next to the existing `ComputeResource` re-export pattern (note: the resources barrel currently only re-exports a subset; match what's there).
  - Edit `/Users/brendon/Development/olane/copass-harness/typescript/packages/agent-router/src/index.ts` — add `ComputeSession` and `ComputeGateway` to the existing compute re-export block (lines 8–22, which already re-exports `ComputeResource`, `ComputeSessionResponse`, etc. from `@copass/core`).

Notes: Phases 1+2+3 are small enough they belong in one PR (the type addition is 1 line, the new class is one file, the resource edit is three small return-wrap changes). Phase 4 (re-exports) lands in the same PR — splitting it adds review overhead with no isolation benefit. Each return-wrap diff is independently reviewable in the PR.

## Verification commands

Run from `/Users/brendon/Development/olane/copass-harness/typescript/` (the workspace root):

```bash
# Per-package commands using pnpm filter on the actual npm name
pnpm -F @copass/core test
pnpm -F @copass/core typecheck
pnpm -F @copass/core build
pnpm -F @copass/core lint

# Cross-package check after Phase 4 lands (agent-router re-export)
pnpm -F @copass/agent-router typecheck
pnpm -F @copass/agent-router build

# Full workspace sanity
pnpm -r run typecheck
pnpm -r run test
```

Notes:
- The workspace root is `typescript/`, NOT the repo root. `pnpm-workspace.yaml` lives at `typescript/pnpm-workspace.yaml` and lists `packages/*` and `local_testing`.
- The package's own scripts (from `typescript/packages/core/package.json`): `build` (tsup), `dev` (tsup --watch), `typecheck` (`tsc --noEmit`), `lint` (eslint), `test` (`vitest run --passWithNoTests`), `test:watch` (vitest watch).
- Do NOT use `npm` or `yarn`; this workspace is pnpm-only (`packageManager: pnpm@10.23.0`).

## Docs Written

- `/Users/brendon/Development/olane/copass-harness/docs/briefs/0026-phase-2-ts-sdk-gateway.md` — overwritten with the corrected layout (this file).
- No `getting-started.md` / `contributing.md` for this phase: the SDK already has package-level docs at `/Users/brendon/Development/olane/copass-harness/docs/getting-started.md` and `/Users/brendon/Development/olane/copass-harness/docs/api-surface.md`. After Phase 4 lands, the implementer should add a `## Compute sessions — gateway access` subsection to `api-surface.md` showing one `session.fetch` example. Flagging here so it's not forgotten.
- TODO for the implementer: once the wrapper lands, add a one-paragraph note to `/Users/brendon/Development/olane/copass-harness/docs/architecture.md` under the SDK section explaining that `ComputeSession.fetch` bypasses `HttpClient` by design, citing ADR 0026.
