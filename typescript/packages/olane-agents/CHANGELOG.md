# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.7.4](https://github.com/olane-labs/copass/compare/@copass/olane-agents@0.7.2...@copass/olane-agents@0.7.4) (2026-05-27)

### Bug Fixes

- **olane-agents:** registrar dials gateway via os.rootLeader directly ([eb680bb](https://github.com/olane-labs/copass/commit/eb680bb6da087684b7f482ee98bce7c4c4a3873a)), closes [#21](https://github.com/olane-labs/copass/issues/21)

## [0.7.2](https://github.com/olane-labs/copass/compare/@copass/olane-agents@0.7.0...@copass/olane-agents@0.7.2) (2026-05-12)

### Bug Fixes

- **olane-agents:** wire libp2p transports on gateway-registrar transient client (v0.7.1) ([3244297](https://github.com/olane-labs/copass/commit/3244297580b5549807e4c08ba5c65bcd6cc143d7))

# [0.7.0](https://github.com/olane-labs/copass/compare/@copass/olane-agents@0.6.5...@copass/olane-agents@0.7.0) (2026-05-12)

### Bug Fixes

- **olane-agents:** chain underlying error in NetworkBrokerNode getSandboxClass catch ([1eb9d74](https://github.com/olane-labs/copass/commit/1eb9d7427bffd8972035f48c0cd1a7e885b0f47b))

### Features

- **olane-agents:** api keepalive + auto-reconnect on dead gateway ([97cad3a](https://github.com/olane-labs/copass/commit/97cad3a2d903f8025deddb5a77aad017c5caccf4))
- **olane-agents:** auto-resolve gateway from api when env vars are unset ([8aadc81](https://github.com/olane-labs/copass/commit/8aadc814b0be6e7df824b7682cbf8b1d3df60df8))

## [0.6.5](https://github.com/olane-labs/copass/compare/@copass/olane-agents@0.6.4...@copass/olane-agents@0.6.5) (2026-05-11)

**Note:** Version bump only for package @copass/olane-agents

## [0.6.4](https://github.com/olane-labs/copass/compare/@copass/olane-agents@0.6.2...@copass/olane-agents@0.6.4) (2026-05-09)

### Bug Fixes

- widen @copass/core peer range so dependents accept core 0.8.x ([#21](https://github.com/olane-labs/copass/issues/21)) ([c08999c](https://github.com/olane-labs/copass/commit/c08999c9b4c9a5bde7d2be08b6de0bc495358379))

## [0.6.2](https://github.com/olane-labs/copass/compare/@copass/olane-agents@0.6.1...@copass/olane-agents@0.6.2) (2026-05-09)

### Bug Fixes

- **olane-agents:** remove unused 'fs' import in agent-daemon ([#16](https://github.com/olane-labs/copass/issues/16)) ([5142db6](https://github.com/olane-labs/copass/commit/5142db6447aa095f45120ecc7371ac56fd11b071)), closes [#10](https://github.com/olane-labs/copass/issues/10)

## [0.6.1](https://github.com/olane-labs/copass/compare/@copass/olane-agents@0.6.0...@copass/olane-agents@0.6.1) (2026-05-08)

**Note:** Version bump only for package @copass/olane-agents

# 0.6.0 (2026-05-08)

### Features

- **olane-agents:** new @copass/olane-agents package ([#10](https://github.com/olane-labs/copass/issues/10)) ([e1c08f1](https://github.com/olane-labs/copass/commit/e1c08f14208454d55bb0981daf2cc0e5b4fe1b4e)), closes [olane-labs/olane#202](https://github.com/olane-labs/olane/issues/202)
