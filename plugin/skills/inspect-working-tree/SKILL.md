---
name: inspect-working-tree
description: Captures Git status, changed, new, and deleted paths, and relevant diff statistics for one expected worktree while verifying branch and worktree association. Use automatically when downstream scope or commit review needs a read-only working-tree inventory; never modify the index, files, or Git state.
---

# Inspect Working Tree

Inspect one expected implementation worktree for commit-scope review. Confirm
that the path is the registered worktree for the expected repository and that
the expected branch is checked out, then inventory porcelain status, path
classifications, and diff statistics without changing any Git state. Return
exactly one version-1
[`WorkingTreeInspection`](../../shared/schemas/WorkingTreeInspection.yaml)
handoff that downstream workflows can map into
[`CommitProposal`](../../shared/schemas/CommitProposal.yaml) file scope.
Inspection is diagnostic only; it never stages, restores, or cleans paths.

## Boundaries

- Read repository files, supplied handoffs, filesystem metadata, and read-only
  Git metadata only. Never edit files, the index, Git administrative state,
  branches, worktrees, remotes, GitHub resources, or generated artifacts.
- Do not run `git add`, `rm`, `mv`, `checkout`, `switch`, `reset`, `restore`,
  `clean`, `rebase`, `merge`, `cherry-pick`, `commit`, `worktree add`,
  `worktree remove`, branch creation or deletion, hooks, installs, builds,
  tests, formatters, linters, or any other change-producing operation.
- Prefer `git status --porcelain=v1`, `git diff --shortstat`, and
  `git diff --numstat`. Do not dump full patch bodies unless a downstream
  consumer explicitly needs a single path for scope clarification.
- Do not silently substitute the current checkout for a missing expected
  workspace, repository, or branch. Do not infer repository identity from an
  arbitrary branch name or path.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive command arguments. Sanitize remote evidence to
  an owner/repository identity before recording it.
- Do not invoke another Skill automatically. A recommended next Skill is
  advisory only and never grants authorization or commit approval.
- Keep the structured handoff and newly authored report text in English. Keep
  questions and explanations in the user's conversation language.

## Input

Accept one expected workspace from the following sources:

- Explicit values for `repository`, `branch_name`, and `worktree_path`.
- An optional version-1
  [`BranchWorkspace`](../../shared/schemas/BranchWorkspace.yaml) handoff.
- An optional version-1
  [`ImplementationPlan`](../../shared/schemas/ImplementationPlan.yaml),
  `ReviewFixPlan`, or `CiFixPlan` whose
  `workspace` supplies the branch and worktree values.
- An optional version-1
  [`RepositoryContext`](../../shared/schemas/RepositoryContext.yaml) for
  verified repository identity, the primary checkout, and target remote
  evidence.

The effective input must contain a non-empty `repository` in
`owner/repository` form, `branch_name`, and an absolute `worktree_path`.
`base_branch` and `base_sha` are optional context only; this Skill does not
require base-revision ancestry verification. When `BranchWorkspace` supplies
`isolation_mode: dedicated_worktree`, treat an observed primary checkout as an
unexpected state.

Validate every supplied handoff before using it. Accept only version 1,
preserve known workspace values and evidence, and return `blocked` with
`unsupported_version` or `invalid_input` instead of silently substituting
values. When input is incomplete, recommend `verify-worktree` when identity
trust is missing, `build-implementation-plan` when planning workspace values
are missing, or `inspect-repository` when repository identity is missing.

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
read-only operation fails after some checks have produced reliable inventory,
use `partial` when the result remains useful for scope review; use `blocked`
when missing or contradictory identity evidence prevents trusting the
inventory for commit scope.

## Inspection workflow

### 1. Validate and normalize expected values

1. Resolve the effective workspace from explicit input, validated
   `BranchWorkspace`, `ImplementationPlan.workspace`, or
   `ReviewFixPlan.workspace` without overwriting
   explicit values with lower-priority values.
2. Confirm all required fields and the supplied contract versions.
3. Confirm that `worktree_path` is absolute and that the expected branch and
   repository identifiers contain no ambiguous placeholder values.
4. Preserve optional `base_branch` and `base_sha` when supplied; keep unknown
   values `null`.

If validation fails, return a blocked `WorkingTreeInspection` with only known
values, empty file inventories when unavailable, a structured failure, and one
appropriate recommended next Skill.

### 2. Confirm the registered worktree and repository identity

Run read-only commands against the expected path:

```bash
git -C <worktree_path> rev-parse --show-toplevel
git -C <worktree_path> rev-parse --git-common-dir
git worktree list --porcelain
git -C <worktree_path> remote -v
```

Require:

- the path exists and is a Git working tree
- `git worktree list --porcelain` registers that absolute path
- sanitized remote identity matches the expected `owner/repository`

Set `identity.worktree_registered` from the porcelain list. Compare the
resolved toplevel with the expected path and record `path_mismatch` when they
differ after normalization. Compare against the primary checkout from
`RepositoryContext` or the common Git directory's main worktree; set
`identity.is_primary_checkout` accordingly. When dedicated isolation was
expected and the path is the primary checkout, add
`primary_checkout_unexpected` to `unexpected_states`.

Classify a missing, unregistered, or foreign path as `worktree_missing` or
`repository_mismatch` and return `blocked`.

### 3. Verify branch association

```bash
git -C <worktree_path> symbolic-ref -q --short HEAD
git -C <worktree_path> rev-parse HEAD
git -C <worktree_path> status --porcelain=v1 -b
```

Require the checked-out branch to equal `branch_name`. Record
`identity.expected_branch`, `identity.observed_branch`, and
`identity.branch_matches_expected`. On detached HEAD, set
`branch_matches_expected: false`, add `detached_head` to `unexpected_states`,
and return `blocked` with `branch_mismatch`. On a different branch, add
`branch_mismatch` to `unexpected_states` and return `blocked` with
`branch_mismatch`. Record the full `current_head_sha` when resolvable.

### 4. Inventory status and classify paths

```bash
git -C <worktree_path> status --porcelain=v1 --untracked-files=all
git -C <worktree_path> rev-parse --git-path MERGE_HEAD
git -C <worktree_path> rev-parse --git-path CHERRY_PICK_HEAD
git -C <worktree_path> rev-parse --git-path REVERT_HEAD
git -C <worktree_path> rev-parse --git-path rebase-merge
git -C <worktree_path> rev-parse --git-path rebase-apply
git -C <worktree_path> rev-parse --git-path BISECT_LOG
```

Parse every porcelain entry into `entries` with repository-relative `path`,
optional `previous_path` for renames, `index_status`, `worktree_status`, and
one or more `stages` from `staged`, `unstaged`, or `untracked`.

Populate `files` as follows:

- `added`: newly tracked or untracked paths that are additions for commit
  scope (including untracked files that would become adds)
- `modified`: tracked paths with content or mode changes that are not deletes
- `deleted`: tracked paths marked deleted
- `renamed`: `{from, to}` pairs from rename status codes
- `untracked`: untracked paths
- `unmerged`: conflict/unmerged paths

Keep lists de-duplicated and repository-relative. A rename contributes to
`renamed` and must not be silently dropped from scope review. Map the same
path classifications so a later `CommitProposal.files` can consume
`added`, `modified`, and `deleted` without inventing paths.

Set `working_tree.clean` when porcelain has no entries. Set `has_staged`,
`has_unstaged`, and `has_untracked` from the observed stages.

Mark unexpected repository states explicitly:

- unmerged paths or conflict status codes → `conflicts`
- any merge, rebase, cherry-pick, revert, or bisect marker →
  `in_progress_operation`
- unavailable or truncated status output → `status_unavailable`

Conflicts and in-progress operations make commit scope unsafe: set
`status: blocked` with `inspection_failure` when those states prevent a
trustworthy inventory, after still recording every observed path that could be
parsed. A clean empty tree is a valid `inspected` result with empty file lists;
it is not a failure.

### 5. Capture diff statistics

Run read-only stats only:

```bash
git -C <worktree_path> diff --shortstat HEAD
git -C <worktree_path> diff --numstat HEAD
git -C <worktree_path> diff --cached --shortstat
git -C <worktree_path> diff --shortstat
```

Record:

- `diff.against: HEAD` for the combined shortstat and numstat that describe
  total uncommitted drift from `HEAD`
- `diff.shortstat` with `files_changed`, `insertions`, and `deletions`
- `diff.staged_shortstat` from `--cached` when available, otherwise `null`
- `diff.unstaged_shortstat` from unstaged `git diff --shortstat` when
  available, otherwise `null`
- `diff.numstat` as per-path insertion and deletion counts; use `null`
  counts for binary paths reported as `-`

Do not claim zero drift when shortstat or numstat is unavailable; add
`diff_unavailable` to `unexpected_states` and prefer `partial` when path
inventory remains useful. Prefer statistics over patch bodies.

### 6. Return one WorkingTreeInspection handoff

For a complete pass with trusted identity, set `status: inspected`, include
complete inventories and diff stats, list any non-blocking
`unexpected_states` that were observed and resolved as informational only when
they do not invalidate scope, set `recommended_next_skill` to `none` or the
advisory downstream `classify-changes` Skill, and set `failure: null`.

For identity failures, return `blocked` with the first blocking failure code in
workflow order. For incomplete but useful inventory after trusted identity,
return `partial` with `inspection_failure` or keep `failure` populated while
preserving parsed files and entries. Never describe an unverified branch,
worktree, or clean state as valid.

## Output contract

Return exactly one English version-1 `WorkingTreeInspection` object:

```yaml
schema: WorkingTreeInspection
version: 1
status: inspected
repository: owner/repository
branch_name: agent/example-task
worktree_path: /workspace/.cromesdk-worktrees/repository/agent-example-task
base_branch: main
base_sha: 0123456789abcdef0123456789abcdef01234567
current_head_sha: 89abcdef0123456789abcdef0123456789abcdef
identity:
  expected_branch: agent/example-task
  observed_branch: agent/example-task
  expected_worktree_path: /workspace/.cromesdk-worktrees/repository/agent-example-task
  observed_worktree_path: /workspace/.cromesdk-worktrees/repository/agent-example-task
  branch_matches_expected: true
  worktree_registered: true
  is_primary_checkout: false
working_tree:
  clean: false
  has_staged: true
  has_unstaged: true
  has_untracked: true
files:
  added:
    - src/feature.ts
  modified:
    - README.md
  deleted:
    - legacy.js
  renamed:
    - from: old-name.ts
      to: new-name.ts
  untracked:
    - notes.local.md
  unmerged: []
entries:
  - path: src/feature.ts
    previous_path: null
    index_status: A
    worktree_status: " "
    stages: [staged]
  - path: README.md
    previous_path: null
    index_status: " "
    worktree_status: M
    stages: [unstaged]
  - path: legacy.js
    previous_path: null
    index_status: D
    worktree_status: " "
    stages: [staged]
  - path: new-name.ts
    previous_path: old-name.ts
    index_status: R
    worktree_status: " "
    stages: [staged]
  - path: notes.local.md
    previous_path: null
    index_status: "?"
    worktree_status: "?"
    stages: [untracked]
diff:
  against: HEAD
  shortstat:
    files_changed: 4
    insertions: 42
    deletions: 7
  staged_shortstat:
    files_changed: 3
    insertions: 40
    deletions: 7
  unstaged_shortstat:
    files_changed: 1
    insertions: 2
    deletions: 0
  numstat:
    - path: src/feature.ts
      insertions: 40
      deletions: 0
    - path: README.md
      insertions: 2
      deletions: 0
    - path: legacy.js
      insertions: 0
      deletions: 7
    - path: new-name.ts
      insertions: 0
      deletions: 0
unexpected_states: []
evidence:
  - "filesystem:/workspace/.cromesdk-worktrees/repository/agent-example-task"
  - "git:worktree list --porcelain registered the expected path and branch"
  - "git:symbolic-ref --short HEAD matched agent/example-task"
  - "git:status --porcelain=v1 --untracked-files=all returned 5 entries"
  - "git:diff --shortstat HEAD reported 4 files changed"
recommended_next_skill: none
failure: null
```

For a blocked result, preserve known identity and any parsed inventory, use
`status: blocked`, keep unverifiable fields `null` or empty, and include a
non-null failure. Example:

```yaml
schema: WorkingTreeInspection
version: 1
status: blocked
repository: owner/repository
branch_name: agent/example-task
worktree_path: /workspace/.cromesdk-worktrees/repository/agent-example-task
current_head_sha: 89abcdef0123456789abcdef0123456789abcdef
identity:
  expected_branch: agent/example-task
  observed_branch: agent/other-branch
  expected_worktree_path: /workspace/.cromesdk-worktrees/repository/agent-example-task
  observed_worktree_path: /workspace/.cromesdk-worktrees/repository/agent-example-task
  branch_matches_expected: false
  worktree_registered: true
  is_primary_checkout: false
working_tree:
  clean: true
  has_staged: false
  has_unstaged: false
  has_untracked: false
files:
  added: []
  modified: []
  deleted: []
  renamed: []
  untracked: []
  unmerged: []
entries: []
diff:
  against: HEAD
  shortstat:
    files_changed: 0
    insertions: 0
    deletions: 0
  staged_shortstat: null
  unstaged_shortstat: null
  numstat: []
unexpected_states:
  - code: branch_mismatch
    message: "Checked-out branch differs from the expected branch."
    evidence:
      - "git:symbolic-ref --short HEAD returned agent/other-branch"
evidence:
  - "git:symbolic-ref --short HEAD returned agent/other-branch"
recommended_next_skill: verify-worktree
failure:
  code: branch_mismatch
  message: "The worktree is checked out on a different branch than expected."
  operation: "git symbolic-ref -q --short HEAD"
  retryable: false
  evidence:
    - "git:observed branch agent/other-branch"
    - "input:branch_name agent/example-task"
```

Use `failure: null` only for a successful `inspected` result. A `partial` or
`blocked` result always includes `code`, `message`, `operation`, `retryable`,
and sanitized evidence.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | A required repository, branch, or worktree path value is absent. | `blocked` |
| `invalid_input` | A supplied workspace, path, repository identity, or handoff cannot be validated. | `blocked` |
| `unsupported_version` | A supplied `BranchWorkspace`, `ImplementationPlan`, or `RepositoryContext` is not version 1. | `blocked` |
| `worktree_missing` | The expected path does not exist, is not a Git worktree, or is not registered at that path. | `blocked` |
| `repository_mismatch` | Local worktree or sanitized remote identity does not match the expected repository. | `blocked` |
| `branch_mismatch` | The expected branch is absent, detached, or different from the checked-out branch. | `blocked` |
| `inspection_failure` | Status or diff evidence fails, is truncated, or conflicts/in-progress operations make commit scope unsafe. | `partial` or `blocked` |
