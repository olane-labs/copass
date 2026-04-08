# Contributing to copass-harness

## Development Setup

### TypeScript SDK

```bash
cd typescript
npm install
npm run build
npm test
```

### Running checks

```bash
npm run lint        # ESLint
npm run format      # Prettier
npm run typecheck   # tsc --noEmit
npm run test        # Vitest
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
