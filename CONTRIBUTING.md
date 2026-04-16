# Contributing to copass-harness

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
