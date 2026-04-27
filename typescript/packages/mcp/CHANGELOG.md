# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.3.4](https://github.com/olane-labs/copass-harness/compare/@copass/mcp@0.3.3...@copass/mcp@0.3.4) (2026-04-27)

**Note:** Version bump only for package @copass/mcp

## [0.3.3](https://github.com/olane-labs/copass-harness/compare/@copass/mcp@0.3.2...@copass/mcp@0.3.3) (2026-04-27)

**Note:** Version bump only for package @copass/mcp

## [0.3.2](https://github.com/olane-labs/copass-harness/compare/@copass/mcp@0.3.1...@copass/mcp@0.3.2) (2026-04-26)

**Note:** Version bump only for package @copass/mcp

## [0.3.1](https://github.com/olane-labs/copass-harness/compare/@copass/mcp@0.2.8...@copass/mcp@0.3.1) (2026-04-26)

**Note:** Version bump only for package @copass/mcp

## [0.3.0](https://github.com/olane-labs/copass-harness/compare/@copass/mcp@0.2.8...@copass/mcp@0.3.0) (2026-04-25)

### Features

- **embed:** export `registerRetrievalTools`, `registerContextWindowTools`, `registerIngestTool` so host processes can compose tool groups onto an existing `McpServer` instead of always going through `buildServer()`. Lets a parent MCP server (e.g. the Copass CLI) layer the SDK retrieval surface in without inheriting the SDK ingest tool when it owns its own
- **config:** `ServerConfig.api_key` is now optional in the static type. The standalone `copass-mcp` bin still requires `COPASS_API_KEY` at runtime via `loadConfig()`; embedded callers that pass their own `CopassClient` to `buildServer({ client })` no longer need to supply one

## [0.2.8](https://github.com/olane-labs/copass-harness/compare/@copass/mcp@0.2.7...@copass/mcp@0.2.8) (2026-04-25)

**Note:** Version bump only for package @copass/mcp

## [0.2.7](https://github.com/olane-labs/copass-harness/compare/@copass/mcp@0.2.6...@copass/mcp@0.2.7) (2026-04-24)

**Note:** Version bump only for package @copass/mcp

## [0.2.6](https://github.com/olane-labs/copass-harness/compare/@copass/mcp@0.2.5...@copass/mcp@0.2.6) (2026-04-24)

**Note:** Version bump only for package @copass/mcp

## [0.2.5](https://github.com/olane-labs/copass-harness/compare/@copass/mcp@0.2.4...@copass/mcp@0.2.5) (2026-04-24)

**Note:** Version bump only for package @copass/mcp

## [0.2.4](https://github.com/olane-labs/copass-harness/compare/@copass/mcp@0.2.3...@copass/mcp@0.2.4) (2026-04-22)

**Note:** Version bump only for package @copass/mcp

## [0.2.3](https://github.com/olane-labs/copass-harness/compare/@copass/mcp@0.2.2...@copass/mcp@0.2.3) (2026-04-22)

**Note:** Version bump only for package @copass/mcp

## [0.2.2](https://github.com/olane-labs/copass-harness/compare/@copass/mcp@0.2.1...@copass/mcp@0.2.2) (2026-04-22)

**Note:** Version bump only for package @copass/mcp

## 0.2.1 (2026-04-22)

**Note:** Version bump only for package @copass/mcp
