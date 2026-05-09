# Contributing to copass

## Development Setup

### TypeScript SDK

The TypeScript workspace uses **pnpm** (see `typescript/pnpm-workspace.yaml`).
Install pnpm once (`npm i -g pnpm` or `corepack enable`) then:

```bash
cd typescript
pnpm install
pnpm run build
pnpm test
```

### Running checks

```bash
pnpm run lint        # ESLint
pnpm run format      # Prettier
pnpm run typecheck   # tsc --noEmit
pnpm run test        # Vitest
```

## Project Structure

This is a multi-language SDK repository. Each language lives in its own top-level directory with independent build tooling:

- `typescript/` -- TypeScript/Node.js SDK
- `python/` -- Python SDK (planned)
- `docs/` -- Language-agnostic documentation
- `spec/` -- Shared contracts (crypto constants, API specs)
- `examples/` -- Usage examples per language

## Adding a New Language SDK

1. Create a new top-level directory (e.g., `go/`, `rust/`)
2. Implement against the API surface documented in `docs/api-surface.md`
3. Use the exact crypto constants from `spec/crypto-constants.md`
4. Add a CI workflow in `.github/workflows/`
5. Add an entry to the root `README.md` language table

## Cross-language wire-shape sync

The ingest envelope (`POST /ingest/text`) is duplicated by hand in TypeScript and Python — there is no codegen today. When you change the envelope on one side, change the other in the same PR:

- **TypeScript:** `typescript/packages/core/src/types/ingest.ts` (`IngestTextRequest` interface, `IngestSourceType` type) and `typescript/packages/core/src/resources/ingest.ts` (`IngestResource.text` / `IngestResource.textInSandbox` — these forward typed requests through, so usually the type change is enough).
- **Python:** `python/copass-core/src/copass_core/resources/ingest.py` (`IngestResource.text` / `text_in_sandbox` parameters, `_build_ingest_body` body assembler).

Tests on both sides should populate the new field and assert it lands on the wire payload.

## Pull Requests

- One logical change per PR
- Include tests for new functionality
- Ensure CI passes before requesting review
- Update relevant documentation if the API surface changes

## Commit messages

TypeScript packages are released with Lerna in independent mode, driven by
[Conventional Commits](https://www.conventionalcommits.org/). Prefix commits
that affect a publishable package with one of:

- `fix: ...` — patch bump
- `feat: ...` — minor bump
- `feat!: ...` or `BREAKING CHANGE:` footer — major bump
- `chore:`, `docs:`, `refactor:`, `test:`, `ci:` — no bump

Scope with the package name when relevant: `feat(core): ...`,
`fix(datasource-fs): ...`.

## Releasing TypeScript packages

See [`typescript/RELEASING.md`](./typescript/RELEASING.md). In short:

```bash
cd typescript
pnpm run version    # bumps, tags, pushes
pnpm run release    # builds and publishes
```

Or trigger the `release-typescript` GitHub Actions workflow from the Actions
tab.
