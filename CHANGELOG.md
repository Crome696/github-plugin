# Changelog

## 0.3.109

- Replaced duplicate Codex protected-hook starts with one deterministic shared
  Cursor/Codex dispatcher while preserving the native host response envelopes.
- Added quoted-command-safe classification, compound-operation rejection, and
  no-live-work short-circuiting for irrelevant events.
- Added 5-second Git/`gh` child deadlines, 25-second pre-hook and 40-second
  post-merge budgets, bounded output handling, structured runtime failures, and
  Windows/POSIX process-tree cleanup without retries.
- Tightened paginated GraphQL evidence handling so incomplete or malformed
  pages fail closed for pre-hooks and remain unavailable in read-only post-hook
  status.
- Regenerated project-hook projections now include the dispatcher and shared
  runner worker; installed projections must be regenerated after this release.
- No Shared Contract schema migration was required.

## 0.3.108

- Distinguished authorized rebase starts from recovery of an already active
  rebase in the host-specific pre-rebase Hook.
- Allowed only standalone `git rebase --continue`, `--skip`, and `--abort`
  recovery commands when the existing `PreRebaseGate`, active Git metadata,
  and exact registered worktree identity match; compound commands, wrappers,
  ambiguous state, and mismatched metadata fail closed.
- Added real merge-backend and apply-backend conflict-recovery coverage for
  Cursor and Codex projections, corrected full remote-upstream identity
  verification, and synchronized the plugin release metadata.

## 0.3.107

- Bound Ready-for-Review and requested-reviewers mutations to two separate
  canonical operations with complete live pull-request and linked-issue
  identity checks.
- Added exact typed user/team payload validation, fail-closed legacy-gate and
  compound-command handling, and native Cursor/Codex runtime coverage.
- Updated the mark-pr-ready workflow, architecture documentation, manifests,
  marketplaces, and synchronized plugin version metadata.

## 0.3.106

- Hardened the local `PreCommitGate` to version 2 with exact commit-message
  bytes and cached staged-index fingerprints.
- Restricted AI-driven commits to one canonical standalone Git command and
  added adversarial runtime coverage for message, path, mode, blob, deletion,
  and shell-wrapper drift across Cursor and Codex.
- Regenerated plugin documentation, manifests, marketplaces, and contract
  fixtures for the synchronized plugin version.

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
