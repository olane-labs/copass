# Copass TypeScript Packages

pnpm workspace monorepo for Copass TypeScript packages. See
`pnpm-workspace.yaml` for package discovery.

## Packages

| Package | Description | Path |
|---------|-------------|------|
| [`@copass/core`](./packages/core/) | Core client SDK | `packages/core/` |
| [`@copass/datasource-fs`](./packages/datasource-fs/) | Filesystem data source driver — scans, watches, and pushes file events | `packages/datasource-fs/` |

## Development

```bash
pnpm install         # install all workspaces
pnpm run build       # build all packages
pnpm run typecheck   # type check all packages
pnpm run lint        # lint all packages
pnpm test            # test all packages
```

## Adding a New Package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
2. Extend `../../tsconfig.base.json` in the package tsconfig
3. Run `npm install` from the workspace root
