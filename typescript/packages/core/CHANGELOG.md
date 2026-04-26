# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.3.2](https://github.com/olane-labs/copass-harness/compare/@copass/core@0.3.1...@copass/core@0.3.2) (2026-04-26)

**Note:** Version bump only for package @copass/core

## [0.3.1](https://github.com/olane-labs/copass-harness/compare/@copass/core@0.2.8...@copass/core@0.3.1) (2026-04-26)

**Note:** Version bump only for package @copass/core

## [0.3.0](https://github.com/olane-labs/copass-harness/compare/@copass/core@0.2.8...@copass/core@0.3.0) (2026-04-25)

### Features

- **agents:** add `client.agents` resource with full CRUD, test-fire, run log, dynamic tool catalog, and nested `client.agents.triggers` sub-resource for Reactive Agents
- **sources:** add `client.sources.rotateWebhookSecret(sandboxId, sourceId)` — mints a fresh webhook signing secret for `realtime` sources whose provider has a registered ingestor (Pipedream today). Plaintext returned ONCE
- **sources:** `register()` and `rotateWebhookSecret()` now return `webhook_signing_secret` on `DataSource` (transient — never present on `retrieve()` / `list()` responses)

### BREAKING CHANGES

- **client:** removed `client.dataSourceWebhooks` from the public `CopassClient` surface. Webhooks are now managed internally by the data-source lifecycle — callers manage triggers, not webhooks. Use `client.sources.rotateWebhookSecret()` to mint a fresh secret when rotating

## [0.2.8](https://github.com/olane-labs/copass-harness/compare/@copass/core@0.2.7...@copass/core@0.2.8) (2026-04-25)

**Note:** Version bump only for package @copass/core

## [0.2.7](https://github.com/olane-labs/copass-harness/compare/@copass/core@0.2.6...@copass/core@0.2.7) (2026-04-24)

**Note:** Version bump only for package @copass/core

## [0.2.6](https://github.com/olane-labs/copass-harness/compare/@copass/core@0.2.5...@copass/core@0.2.6) (2026-04-24)

**Note:** Version bump only for package @copass/core

## [0.2.5](https://github.com/olane-labs/copass-harness/compare/@copass/core@0.2.4...@copass/core@0.2.5) (2026-04-24)

**Note:** Version bump only for package @copass/core

## [0.2.4](https://github.com/olane-labs/copass-harness/compare/@copass/core@0.2.3...@copass/core@0.2.4) (2026-04-22)

**Note:** Version bump only for package @copass/core

## [0.2.3](https://github.com/olane-labs/copass-harness/compare/@copass/core@0.2.2...@copass/core@0.2.3) (2026-04-22)

**Note:** Version bump only for package @copass/core

## [0.2.2](https://github.com/olane-labs/copass-harness/compare/@copass/core@0.2.1...@copass/core@0.2.2) (2026-04-22)

**Note:** Version bump only for package @copass/core

## [0.2.1](https://github.com/olane-labs/copass-harness/compare/@copass/core@0.1.1...@copass/core@0.2.1) (2026-04-22)

**Note:** Version bump only for package @copass/core

## 0.1.1 (2026-04-17)

**Note:** Version bump only for package @copass/core
