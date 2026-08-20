# Changelog

## 0.3.115

- Added the host-neutral, canonical `.github/github-plugin/state/` runtime
  lifecycle for one-shot hook gates, including cryptographic nonces, five-minute
  TTLs, bounded future skew, atomic claim and publish operations, persistent
  replay markers, quarantine, and one-time post-merge receipts.
- Updated all gate contracts, writers, readers, generator projections, skills,
  rules, documentation, fixtures, and runtime tests for the breaking lifecycle
  versions and one-operation-per-gate behavior, including phase-specific Ready
  and rebase gates and one-time legacy-state migration diagnostics.

## 0.3.114

- Required exact full-head compare-and-set protection for every supported
  pull-request merge command and upgraded the local `PreMergeGate` to version 3
  with final live preflight identity and provenance.
- Made the pre-merge Hook evaluate current S03 required-check, approval, and
  review-thread evidence from the embedded immutable snapshot, including
  evidence-backed nonblocking outdated threads, without acquiring live GitHub
  state.
- Added fail-closed runtime, contract, fixture, and cross-host coverage for
  missing or altered head guards, changed policy, incomplete pagination, and
  ambiguous thread evidence.

## 0.3.113

- Added immutable version-1 `PullRequestReadinessEvidence` snapshots bound to
  one repository, pull request node, head OID, base branch, and base OID.
- Added the deterministic `build-pr-readiness-evidence` orchestration stage,
  upgraded `MergeReadiness` to version 3, and upgraded the pre-merge and merge
  handoffs to consume the complete embedded snapshot.
- Removed live GitHub and GraphQL acquisition from the pre-merge Hook; H05 now
  validates only normalized, complete, identity-matched readiness evidence and
  preserves the existing exact-target and authorization gates.
- Added contract, scenario, and runtime coverage for mixed heads, stale or
  unavailable sources, pagination completeness, empty versus unavailable
  evidence, thread dispositions, deterministic repeatability, and no-network
  pre-merge validation.

## 0.3.112

- Replaced inferred UI screenshot enforcement with explicit evidence
  requirements declared by the implementation or review-fix plan.
- Migrated `ValidationResult` to version 2, `PreCommitGate` to version 3, and
  `PrePrCreateGate` to version 2 with fail-closed rejection of old or mixed
  handoffs.
- Preserved `generated_artifacts` as descriptive path evidence, added explicit
  satisfied/missing/blocked evidence outcomes, and removed the nonexistent
  screenshot-capture capability and fixed screenshot-directory convention.
- Added contract, hook, runtime, and scenario coverage for UI evidence,
  non-UI work, missing evidence, unavailable required capabilities, and
  legacy-version rejection.

## 0.3.111

- Added the host-neutral `cli-transport-file-lifecycle` Rule for the exact
  temporary payload files used by `create-commit`, `create-draft-pr`,
  `submit-pr-review`, `create-github-issue`, and `update-github-issue`.
- Standardized unique OS-temp placement, restrictive creation, exact-byte
  transport, one direct payload-consuming CLI operation, guaranteed
  `try/finally` cleanup, safe target revalidation, and separate sanitized
  cleanup diagnostics without masking the primary result.
- Added cross-platform test-workspace coverage for success, non-zero exit,
  timeout, parse failure, handled exceptions, missing files, collisions,
  unsafe targets, cleanup failures, and Windows locked-file behavior when
  supported.
- No Shared Contract migration, Hook gate, generator, or retained workflow
  state change was required.

## 0.3.110

- Added the versioned `RepositoryPolicy` contract and shared runtime loader for
  repository-owned PR description, rebase posture, and secret-scan preferences.
- Preserved compatibility defaults and fail-closed core operation, identity,
  authorization, gate-integrity, and evidence checks for malformed or unknown
  policies.
- Applied the policy loader to generated Cursor and Codex project hooks and
  added contract fixtures and synchronized release metadata.

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
