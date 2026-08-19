# Changelog

## 0.3.105

- Added an executable cross-host runtime oracle for all generated Cursor and
  Codex project hooks, including isolated fake Git/GitHub execution and
  non-default pull-request base coverage.
- Corrected the Codex Ready-for-Review hook response to use the native
  `PreToolUse` permission envelope.

## 0.3.104

- Migrated the complete non-test GitHub workflow plugin from the verified
  `Crome696/cromesdk-plugin` `master` source into the standalone `plugin/`
  directory.
- Added the full Agents, Commands, Skills, Rules, Hooks, Shared Contracts,
  documentation, assets, and synchronized host manifests.
- Moved all contract tests, scenario tests, fixtures, and TypeScript/Vitest
  tooling into the repository-root test workspace so Marketplace loading of
  `./plugin` does not include them.
- Updated standalone repository metadata, Marketplace sources, and all local
  path references from the original monorepo layout to `plugin/`.

## 0.1.0

- Created the standalone GitHub plugin repository packaging baseline for
  Cursor, Codex, Claude Code, and GitHub Copilot.
- Added portable and host-specific plugin manifests plus marketplace entries
  that register this repository as a single-plugin marketplace.
- Added the documentation shell and hero banner.
