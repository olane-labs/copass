# Copass TypeScript Packages

npm workspaces monorepo for Copass TypeScript packages.

## Packages

| Package | Description | Path |
|---------|-------------|------|
| [`@copass/core`](./packages/core/) | Core client SDK | `packages/core/` |

## Development

```bash
npm install          # install all workspaces
npm run build        # build all packages
npm run typecheck    # type check all packages
npm run lint         # lint all packages
npm test             # test all packages
```

## Adding a New Package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
2. Extend `../../tsconfig.base.json` in the package tsconfig
3. Run `npm install` from the workspace root
