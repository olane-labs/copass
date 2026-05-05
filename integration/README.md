# Integration test suite — live contract probe (Tier 2)

These tests hit a deployed Copass API (staging by default; prod with
`COPASS_API_URL=https://ai.copass.id`) using the **published** SDK
versions. They catch the one failure class the mock-based tests cannot:
the deployed API drifted away from what the SDK contract assumes.

The mock-based suites in `python/copass-core/tests/test_full/` and
`typescript/packages/core/test/unit/resources/full/` are Tier 1 — fast,
deterministic, no network. They are the bulk of coverage and run on
every PR. This Tier 2 suite is small (~10 tests per language), runs
nightly, and gates backend deploys via `o-twin-data-pipeline`'s
post-deploy-smoke workflow.

## Running

```bash
# Python
cd integration/python
export COPASS_INTEGRATION_API_KEY=olk_...        # staging key
export COPASS_INTEGRATION_SANDBOX_ID=sb_smoke    # long-lived smoke sandbox
export COPASS_API_URL=https://ai.staging.copass.id   # default; override for prod
pytest -v

# TypeScript
cd integration/typescript
export COPASS_INTEGRATION_API_KEY=olk_...
export COPASS_INTEGRATION_SANDBOX_ID=sb_smoke
pnpm test
```

## What runs

One probe per public endpoint (~10 calls total). Each asserts the
**shape** of the response matches what the Tier 1 mock fixtures expect:

- `/discover` × `copass/copass_1.0` (assert items shape)
- `/discover` × `copass/copass_2.0` (assert items have `subgraph` + `matched_query_nodes`)
- `/interpret` (assert `brief` + `citations`)
- `/search` (assert `answer` + `preset` echo)
- `/api/v1/sandboxes` GET
- `/api/v1/api-keys` GET
- `/api/v1/usage` GET
- `/api/v1/users/me/profile` GET

Auth flow is exercised implicitly — every call needs a valid bearer.

## What this does NOT cover

- Mutating endpoints (creates, deletes) — destructive on the live env.
- Per-method exhaustive coverage — Tier 1 mocks cover that.
- Content quality (LLM output assertions). The smoke sandbox has
  enough seeded data that `/discover` returns >0 items, but the suite
  asserts on shape, not semantics.

## When this fails

A red Tier 2 run means the deployed API has drifted from the SDK's
contract assumptions. Two responses:

1. **API change is intentional** — update the matching Tier 1 mock
   fixtures so they describe the new shape, then update the SDK code
   if needed.
2. **API change is a regression** — roll back the backend deploy.
