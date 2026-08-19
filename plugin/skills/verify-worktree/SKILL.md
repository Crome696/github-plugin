---
name: verify-worktree
description: Verifies a policy-selected Git workspace against its expected repository, branch, base revision, and applicable safe-state requirements using read-only evidence. Use automatically before implementation when a branch workspace or worktree must be trusted; never repair, create, switch, or clean up Git state.
---

# Verify Worktree

Verify one expected implementation workspace before it is trusted by a
downstream workflow. The dedicated-worktree and clean-state requirements are
the defaults; an applicable repository `AGENTS.md` may explicitly waive a
named requirement for a defined scope. Confirm that the path is an existing
registered Git worktree for the expected repository, the expected branch is
checked out, the current commit descends from the expected base revision, and
every non-waived workspace check passes. Return exactly one version-1
[`BranchWorkspace`](../../shared/schemas/BranchWorkspace.yaml) handoff.
Verification is diagnostic only; it never repairs the workspace.

## Boundaries

- Read repository files, supplied handoffs, filesystem metadata, and read-only
  Git metadata only. Never edit files, the index, Git administrative state,
  branches, worktrees, remotes, GitHub resources, or generated artifacts.
- Do not run `git checkout`, `switch`, `reset`, `restore`, `clean`, `rebase`,
  `merge`, `cherry-pick`, `worktree add`, `worktree remove`, branch creation or
  deletion, hooks, installs, builds, tests, formatters, linters, or any other
  change-producing operation.
- Do not resolve conflicts, discard changes, detach or attach a worktree,
  change its branch, refresh remotes, or retry a failed verification by
  changing state.
- Do not silently substitute the current checkout for a missing expected
  workspace, repository, branch, or base revision. Do not infer repository
  identity from an arbitrary branch name or path.
- Read applicable repository-scoped durable instructions, especially
  `AGENTS.md`, before applying the dedicated-worktree or clean-state defaults.
  Natural-language policy may waive a named check, but it does not change
  observed facts or make a mismatched repository identity pass.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive command arguments. Sanitize remote evidence to
  an owner/repository identity before recording it.
- Do not invoke another Skill automatically. A recommended next Skill is
  advisory only and never grants authorization.
- Keep the structured handoff and newly authored report text in English. Keep
  questions and explanations in the user's conversation language.

## Input

Accept one expected workspace from the following sources:

- Explicit values for `repository`, `base_branch`, `base_sha`,
  `branch_name`, and `worktree_path`.
- An optional version-1
  [`BranchWorkspace`](../../shared/schemas/BranchWorkspace.yaml) handoff.
- An optional version-1
  [`ImplementationPlan`](../../shared/schemas/ImplementationPlan.yaml) whose
  `workspace` supplies the branch and worktree values.
- An optional version-1
  [`RepositoryContext`](../../shared/schemas/RepositoryContext.yaml) for
  verified repository identity, the primary checkout, and target remote
  evidence.

The effective input must contain a non-empty `repository` in
`owner/repository` form, `base_branch`, `base_sha`, `branch_name`, and an
absolute `worktree_path`. `base_sha` is required because ancestry cannot be
verified against an unspecified revision. `base_sha` may be abbreviated only
when the target worktree resolves it unambiguously to a commit; record the
resolved commit SHA in the evidence.

An optional `expected_changes` input may list explicitly authorized paths and
stages for a workspace that is not expected to be empty. Without that
allowance, every staged, unstaged, deleted, renamed, or untracked path is
unexpected and prevents a successful verification. The allowance does not
permit conflicts or an in-progress Git operation. Represent each allowance
with a repository-relative `path` and one or more state labels from `staged`,
`unstaged`, or `untracked`; compare the observed status entries and stages
exactly.

Validate every supplied handoff before using it. Accept only version 1,
preserve known workspace values and evidence, and return `blocked` with
`unsupported_version` or `invalid_input` instead of silently substituting
values. When input is incomplete, recommend `build-implementation-plan` only
when the missing values are planning values; recommend `inspect-repository`
when repository identity or checkout evidence is missing.

## Evidence rules

Use concise references that allow a reviewer to reproduce each conclusion:

- `input:<field>` for an explicit expected value
- `handoff:<Contract>.<field>` for a supplied contract value
- `git:<command>` for sanitized read-only Git evidence
- `filesystem:<path>` for path existence or Git marker evidence
- `repository:<path>` for the verified primary checkout or Git common
  directory

Normalize absolute paths before comparing them. On Windows, compare resolved
paths case-insensitively while preserving the original expected path in the
handoff. Compare repository identities canonically as `owner/repository`;
normalize HTTPS and SSH remote forms and remove credentials, ports, query
strings, and fragments from recorded evidence.

Treat a check as passed only when its command or metadata supports the exact
expected condition. An unavailable command result is not a pass. If a
read-only operation fails after some checks have produced reliable evidence,
use `partial` when the result is useful but incomplete; use `blocked` when the
missing evidence prevents trusting the workspace.

## Verification workflow

### 1. Validate and normalize expected values

1. Resolve the effective workspace from explicit input, validated
   `BranchWorkspace`, and `ImplementationPlan.workspace` without overwriting
   explicit values with lower-priority values.
2. Confirm all required fields and the supplied contract versions.
3. Confirm that `worktree_path` is absolute and that the expected branch and
   repository identifiers contain no ambiguous placeholder values.
4. Preserve `branch_exists_before`, `worktree_exists_before`, `created_at`,
   `cleanup`, `fallback_authorized`, and other supplied fields. Keep unknown
   historical values `null`; do not invent creation history.

If validation fails, return a blocked `BranchWorkspace` with only known values,
`current_head_sha: null` when the worktree cannot be trusted, a structured
failure, and one appropriate recommended next Skill.

### 2. Confirm the path is the expected registered worktree

Run only read-only checks in the expected path and its Git administrative
metadata:

```text
git -C <worktree_path> rev-parse --is-inside-work-tree
git -C <worktree_path> rev-parse --show-toplevel
git -C <worktree_path> rev-parse --git-common-dir
git -C <worktree_path> worktree list --porcelain
```

Require all of the following:

- The path exists and is a directory.
- `rev-parse --is-inside-work-tree` returns `true`.
- The canonical top-level path matches `worktree_path`.
- `worktree list --porcelain` contains the exact canonical path.
- The registered worktree entry has a resolvable `HEAD` and, for a normal
  implementation worktree, a `refs/heads/<branch_name>` branch entry.

The expected path must not be the primary checkout when the primary checkout
is known unless an applicable repository instruction explicitly authorizes the
`authorized_branch_fallback` mode. Set `primary_checkout_untouched` from
observed path and status evidence; it is not permission to use the primary
checkout as a dedicated worktree. An authorized fallback is a valid
policy-selected mode when repository identity, branch, base ancestry, and
every non-waived check pass, but it must never be reported as a
`dedicated_worktree` result. Record the policy source in `evidence`.

### 3. Verify repository identity

Use the Git common directory and verified remote evidence to establish
repository identity:

1. Read the target remote evidence from `RepositoryContext` when it is
   supplied.
2. Otherwise inspect sanitized `git remote -v` or
   `git remote get-url --all <remote>` output without exposing credentials.
3. Normalize the selected remote to `owner/repository` and compare it with the
   expected `repository`.
4. If no target remote can be identified, or remotes disagree and no verified
   target is supplied, stop with `repository_mismatch` or
   `verification_failure`; do not guess from a remote name.

The worktree's Git common directory must also identify the same local
repository as the registered worktree entry. A successful local Git command
alone does not prove that the checkout belongs to the expected remote
repository.

### 4. Verify branch and base revision

Read the checked-out branch and revisions:

```text
git -C <worktree_path> symbolic-ref --quiet --short HEAD
git -C <worktree_path> rev-parse --verify HEAD^{commit}
git -C <worktree_path> rev-parse --verify <base_branch>^{commit}
git -C <worktree_path> rev-parse --verify <base_sha>^{commit}
git -C <worktree_path> merge-base --is-ancestor <base_sha> HEAD
```

Require the symbolic branch to equal `branch_name`; a detached `HEAD`, a
different branch, or a disagreement between the symbolic ref and the
registered worktree entry is `branch_mismatch`. Require `base_branch` and
`base_sha` to resolve to commits. The current base branch may have advanced
since workspace creation, so do not require its current tip to equal
`base_sha`. Require `base_sha` to be an ancestor of `HEAD`, including the
equal-commit case; an exit status showing that it is not an ancestor is
`base_revision_mismatch`.

Record the full resolved `current_head_sha` and the full resolved base
revision in evidence. A command error, malformed revision, or ambiguous
revision is `verification_failure`, not a passing ancestry result.

### 5. Verify a safe starting state

Check status, index conflicts, and operation markers without changing them:

```text
git -C <worktree_path> status --porcelain=v1 --untracked-files=all
git -C <worktree_path> ls-files --unmerged
git -C <worktree_path> rev-parse --git-path MERGE_HEAD
git -C <worktree_path> rev-parse --git-path CHERRY_PICK_HEAD
git -C <worktree_path> rev-parse --git-path REVERT_HEAD
git -C <worktree_path> rev-parse --git-path rebase-merge
git -C <worktree_path> rev-parse --git-path rebase-apply
git -C <worktree_path> rev-parse --git-path BISECT_LOG
```

Require the following unless the applicable repository instruction explicitly
waives the named condition:

- no unmerged index entries and no conflict status codes
- no `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, rebase, or bisect
  operation marker
- no dirty status entries unless they exactly match the supplied
  `expected_changes` allowance
- no status entries outside the expected path/stage allowance

Classify conflicts, operation markers, and dirty state that makes the
workspace unsafe as `unsafe_state`. Classify a supplied expected-change
allowance that does not match observed paths or stages as
`unexpected_changes`. Do not claim a clean state when status output is
unavailable or truncated.

### 6. Return one BranchWorkspace handoff

For a complete pass, set `status: active`, preserve or derive the actual
`isolation_mode`, set `primary_checkout_untouched` from observed evidence,
record the full `current_head_sha`, include reproducible evidence including
any policy waiver, set `recommended_next_skill: none`, and set `failure: null`.
The default complete result remains `dedicated_worktree` with an untouched
primary checkout; an explicitly authorized fallback may return
`authorized_branch_fallback` with the observed primary-checkout state.

For any failed required check, set `status: blocked` unless reliable evidence
is useful but a later read-only operation is incomplete, in which case use
`partial`. Set `failure` to the first blocking condition in workflow order,
include the exact operation and sanitized evidence, and recommend at most one
next Skill. Never describe a failed or unverified condition as valid.

## Output contract

Return exactly one English version-1 `BranchWorkspace` object:

```yaml
schema: BranchWorkspace
version: 1
status: active
repository: owner/repository
base_branch: main
base_sha: 0123456789abcdef0123456789abcdef01234567
branch_name: agent/example-task
branch_exists_before: null
worktree_path: /workspace/.cromesdk-worktrees/repository/agent-example-task
worktree_exists_before: null
isolation_mode: dedicated_worktree
fallback_authorized: false
primary_checkout_untouched: true
created_at: null
current_head_sha: 89abcdef0123456789abcdef0123456789abcdef
cleanup:
  authorized: false
  requested: false
  completed: false
  reason: null
evidence:
  - "filesystem:/workspace/.cromesdk-worktrees/repository/agent-example-task"
  - "git:worktree list --porcelain registered the expected path and branch"
  - "git:merge-base --is-ancestor <base_sha> HEAD returned success"
  - "git:status --porcelain=v1 --untracked-files=all returned no entries"
recommended_next_skill: none
failure: null
```

For a blocked result, preserve known identity and workspace values, use
`status: blocked`, keep unverifiable fields `null`, and include a non-null
failure. Example:

```yaml
schema: BranchWorkspace
version: 1
status: blocked
repository: owner/repository
base_branch: main
base_sha: 0123456789abcdef0123456789abcdef01234567
branch_name: agent/example-task
worktree_path: /workspace/.cromesdk-worktrees/repository/agent-example-task
isolation_mode: dedicated_worktree
fallback_authorized: false
primary_checkout_untouched: true
current_head_sha: 89abcdef0123456789abcdef0123456789abcdef
evidence:
  - "git:status --porcelain=v1 --untracked-files=all reported an unmerged entry"
recommended_next_skill: none
failure:
  code: unsafe_state
  message: "The worktree contains an unresolved Git conflict."
  operation: "git status --porcelain=v1 --untracked-files=all"
  retryable: false
  evidence:
    - "git:status reported an unmerged path"
```

Use `failure: null` only for a successful `active` verification. A `partial`
or `blocked` result always includes `code`, `message`, `operation`,
`retryable`, and sanitized evidence.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | A required repository, branch, path, or base revision value is absent. | `blocked` |
| `invalid_input` | A supplied workspace, path, repository identity, or handoff cannot be validated. | `blocked` |
| `unsupported_version` | A supplied `BranchWorkspace`, `ImplementationPlan`, or `RepositoryContext` is not version 1. | `blocked` |
| `worktree_missing` | The expected path does not exist, is not a Git worktree, or is not registered at that path. | `blocked` |
| `repository_mismatch` | Local worktree or sanitized remote identity does not match the expected repository. | `blocked` |
| `branch_mismatch` | The expected branch is absent, detached, or different from the checked-out or registered branch. | `blocked` |
| `base_revision_mismatch` | The expected base revision cannot be resolved or is not an ancestor of `HEAD`. | `blocked` |
| `unsafe_state` | The worktree has conflicts, an in-progress Git operation, or unapproved dirty state. | `blocked` |
| `unexpected_changes` | Observed paths or stages do not match an explicitly supplied expected-change allowance. | `blocked` |
| `verification_failure` | A required read-only command or evidence source fails without establishing the condition. | `partial` or `blocked` |
