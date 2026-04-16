# Releasing

The TypeScript packages in this workspace are versioned and published with
[Lerna](https://lerna.js.org/) in **independent** mode — each package has
its own version and release cadence. Version bumps and changelogs are
derived from [Conventional Commits](https://www.conventionalcommits.org/)
against the default branch.

## One-time setup

Before your first publish, make sure you have:

1. **npm credentials** for the `@copass` scope:
   ```bash
   npm login
   npm whoami   # should print your user
   ```
   And confirm you have publish rights:
   ```bash
   npm access list packages
   ```

2. **GitHub credentials** (only needed if you want Lerna to cut GitHub
   releases alongside version tags — `command.version.createRelease` is set
   to `github` in `lerna.json`):
   ```bash
   export GH_TOKEN=<personal-access-token-with-repo-scope>
   ```

3. A clean tree on `main` (or a `release/*` branch — see
   `command.version.allowBranch` in `lerna.json`).

## Writing commits

Use Conventional Commit prefixes so Lerna can bump versions and generate
changelogs automatically:

| Prefix       | Version bump            |
|--------------|-------------------------|
| `fix:`       | patch (0.1.0 → 0.1.1)   |
| `feat:`      | minor (0.1.0 → 0.2.0)   |
| `feat!:` / `BREAKING CHANGE:` footer | major (0.1.0 → 1.0.0) |
| `chore:`, `docs:`, `refactor:`, `test:`, `ci:` | no bump (by default ignored if path matches `command.version.ignoreChanges`) |

Scope commits to the package when it helps, e.g.:

```
feat(core): add SandboxesResource.destroyAll()
fix(datasource-fs): debounce chokidar add events
```

## Cutting a release

Everything is orchestrated from `typescript/` (the workspace root).

```bash
cd typescript
pnpm install             # ensure lerna is installed
pnpm run typecheck        # or: pnpm test
```

### Step 1 — bump versions, update changelogs, tag, push

```bash
pnpm run version
```

This runs `lerna version --conventional-commits`, which:

- Inspects commits since each package's last tag.
- Computes the correct bump per package (patch / minor / major) based on
  Conventional Commit types.
- Updates each changed package's `package.json` and writes / updates its
  `CHANGELOG.md`.
- Creates a release commit (`chore(release): publish`).
- Tags every bumped package (`@copass/core@0.2.0`, etc.).
- Pushes the commit and tags to `origin` (because `command.version.push` is
  `true` in `lerna.json`).
- Opens a GitHub release per tag (via `createRelease: "github"`).

You'll be prompted to confirm the proposed versions. Abort at the prompt
if anything looks wrong — no changes are committed until you confirm.

**Pre-release flavor** (cuts `*-next.N` versions, stays on the `next`
dist-tag later):

```bash
pnpm run version:prerelease
```

**Graduate pre-releases to stable**:

```bash
pnpm run version:graduate
```

### Step 2 — build and publish

```bash
pnpm run release
```

This runs:

1. `pnpm run build` — builds every workspace (each package's `prepublishOnly`
   also re-runs `tsup` as a safety net).
2. `lerna publish from-package` — publishes each package whose version in
   `package.json` is ahead of what's on the registry. This is the safe
   mode: Lerna does not re-compute versions here, it just publishes what
   `pnpm run version` already wrote.

**Pre-release publish** (tags the release as `next` on npm):

```bash
pnpm run release:prerelease
```

**Dry-run** (no commits, no tags, no publishes — just show what would
happen):

```bash
pnpm run release:dry
```

## Combined single-command release

If you want one command that bumps **and** publishes (useful in CI):

```bash
pnpm run version && pnpm run release
```

## Inspecting state

```bash
pnpm run changed   # which packages have commits since their last tag
pnpm run diff      # file-level diff for changed packages
```

## What Lerna ignores

Changes limited to the following paths do **not** trigger a version bump
(`command.version.ignoreChanges` in `lerna.json`):

- `**/*.md`
- `**/test/**`
- `**/*.test.ts`
- `**/tsconfig*.json`
- `**/vitest.config.ts`

Adjust the list in `lerna.json` if, for example, you want doc-only changes
to produce a patch release.

## Troubleshooting

- **`EPUBLISHCONFLICT`**: a version was published previously with the same
  number. Either bump again (`pnpm run version` / manual edit) or run
  `lerna publish from-package` to skip the already-published one.
- **`401 Unauthorized`**: run `npm login` again; for CI, set
  `NPM_TOKEN` and use `npm config set //registry.npmjs.org/:_authToken
  $NPM_TOKEN` in the release job.
- **"Working tree has uncommitted changes"**: commit or stash first; Lerna
  will not bump with dirty state.
- **Git tag already exists**: someone else already tagged that version; fix
  with `git tag -d <tag>` locally, push, and re-run — or let Lerna pick the
  next version.
