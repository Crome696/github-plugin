---
name: validate-rebased-branch
description: Validate one explicitly identified branch after a completed rebase by comparing its history and diff with the pre-rebase implementation and selected base, checking implementation scope, required tests, and status checks, and returning an updated version-1 ValidationResult. Use automatically after a successful rebase; never rebase, push, merge, or modify Git state.
---

# Validate Rebased Branch

Validate exactly one branch after an already completed rebase and return one
updated version-1
[`ValidationResult`](../../shared/schemas/ValidationResult.yaml) handoff. This
Skill is a read-only post-rebase verification gate. It does not authorize or
perform delivery.

## Boundaries

- Read only the explicitly identified checkout, Git metadata, supplied
  version-1 handoffs, bounded diffs, and available check evidence.
- Never run `git rebase`, `git rebase --continue`, `git rebase --skip`, or
  `git rebase --abort`.
- Never merge, push, commit, stage, checkout, switch, reset, restore, clean,
  cherry-pick, edit files, modify the index, alter refs, or change GitHub.
- Do not infer the repository, branch, base revision, pre-rebase revision, or
  current head from a branch name, remote name, commit message, or current
  checkout.
- Do not treat a missing comparison, test, or status-check result as a pass.
- Do not claim that a rebase succeeded merely because no rebase metadata is
  present. Require explicit completed-rebase evidence and verify the resulting
  history independently.
- Keep all paths repository-relative and use full commit IDs when available.
- Redact credentials, tokens, private keys, `.env` values, personal data, and
  credential-bearing remote URLs.
- Keep the structured handoff and durable authored text in English.

## Required input

Accept exactly one completed-rebase validation request with:

1. Explicit repository and checkout identity.
2. Explicit branch and worktree path.
3. Full `pre_rebase_head_sha`, `original_base_sha`, `rebased_base_sha`, and
   `current_head_sha`. If a required revision is unavailable, preserve that
   limitation and return `blocked` or `partial`.
4. Evidence that the rebase completed successfully and that no rebase,
   merge, cherry-pick, revert, or bisect operation remains active.
5. Version-1 `ImplementationPlan`.
6. Version-1 `WorkingTreeInspection` and `ChangeClassification` for the
   current worktree, or trusted partial equivalents with an explicit
   limitation.

Accept these optional inputs:

- `UnrelatedChangeDetection` when scope alignment is `drift` or `unknown`, or
  when foreign or uncertain paths exist.
- The prior version-1 `ValidationResult` from before the rebase.
- `LoadedIssue`, `IssueAnalysis`, or `BranchWorkspace` for additional
  requirements and identity evidence.
- Explicit SHA-bound test and status-check results.

Validate every handoff before using it. Reject unsupported versions, malformed
objects, conflicting repository or branch identities, and a current head that
does not match the requested checkout. Do not substitute the current checkout
for a missing identity.

## Evidence model

Use concise reproducible references:

- `input:repository`, `input:checkout`, `input:branch`
- `input:pre_rebase_head_sha`, `input:original_base_sha`,
  `input:rebased_base_sha`, `input:current_head_sha`
- `input:rebase_completion`
- `handoff:ImplementationPlan.in_scope[<path>]`
- `handoff:ImplementationPlan.validation.required_tests[<index>]`
- `handoff:ImplementationPlan.validation.required_checks[<index>]`
- `handoff:WorkingTreeInspection.entries[<path>]`
- `handoff:ChangeClassification.changes[<path>]`
- `handoff:UnrelatedChangeDetection.findings[<path>]`
- `handoff:ValidationResult.evaluation[<field>]`
- `git:status`, `git:merge-base:<revision-pair>`,
  `git:log:<revision-range>`, `git:diff:<revision-pair>:<path>`
- `check:<id>:<head-sha>`

Every scope conclusion, planned-step result, criterion, check, warning,
blocker, lost change, and unexpected change must cite evidence. Preserve
unavailable or failed command output as uncertainty or limitation.

## Validation workflow

### 1. Validate identity and completed-rebase state

- Confirm that repository, checkout, branch, worktree, and current head agree
  across explicit input and supplied handoffs.
- Confirm the requested current head is a commit and that the worktree has no
  active rebase or other in-progress Git operation.
- Confirm the rebased base is the explicit base used for the current comparison.
- Confirm that the supplied completion evidence describes a completed rebase,
  rather than a planned or stopped rebase.
- Any missing or contradictory identity is a blocker.

### 2. Compare history and commit ranges

- Verify the rebased base is an ancestor of `current_head_sha`.
- Compare the pre-rebase range from `original_base_sha` to
  `pre_rebase_head_sha` with the post-rebase range from `rebased_base_sha` to
  `current_head_sha`.
- Preserve commit count, changed paths, patch identity, rename/delete
  operations, mode changes, binary changes, and submodule changes where Git
  evidence supports them.
- Treat changed commit IDs as expected rebase effects; compare the resulting
  patch and scope, not commit IDs alone.
- Mark missing, truncated, or contradictory range evidence as `partial` or
  `blocked`, never as preserved history.

### 3. Compare implementation scope and detect lost changes

- Reconcile the post-rebase diff with the `ImplementationPlan`, current
  working-tree inventory, change classification, and prior validation when
  supplied.
- A previously observed in-scope path or hunk missing from the post-rebase
  comparison is a potential lost change until direct evidence explains it.
- A new path, hunk, rename, deletion, mode change, binary change, or submodule
  update outside the approved scope is an unexpected change.
- Do not infer equivalence from filenames, commit messages, line counts, or
  similar-looking text. Use patch, path-operation, or supplied handoff
  evidence.
- If classification has drift, unknown alignment, foreign paths, or uncertain
  paths, require the supplied `UnrelatedChangeDetection`; its blocking or
  clarification gate blocks the result.

### 4. Validate required tests and status checks

- Combine required tests and status checks from `ImplementationPlan` with
  explicit current-head, SHA-bound evidence without discarding provenance.
- Record one `checks` entry for every required item. Use `pass` only for a
  successful result bound to `current_head_sha`.
- Use `fail` for a failed result, `skipped` for an explicitly skipped result
  with a concrete reason, and `not_run` when no current-head result exists or
  its safety cannot be verified.
- A pre-rebase check result does not prove the rebased head passes.
- Set `required_checks_passed: true` only when every required entry is `pass`.
  Any failed, skipped, or not-run required check blocks `passed`.

### 5. Produce the updated ValidationResult

Return `blocked` for missing or conflicting identity, missing required
handoffs, an active Git operation, or unusable comparison evidence. Return
`failed` when trusted evidence proves lost changes, scope drift, a failed
required check, or an unmet criterion. Return `partial` when useful evidence
exists but a non-critical source or comparison is incomplete. Return `passed`
only when identity, completed-rebase state, history, patch scope, all required
criteria, and all required current-head checks are verified.

Carry rebase evidence in `source.references`, `checks`, `evaluation`, and
`changed_files_reviewed`. Add each lost or unexpected change exactly once to
`evaluation.unexpected_changes`, with a clear reason and evidence. Use
`failure: null` only when processing completed without a processing failure.

Set `readiness.commit_preparation_allowed` and
`readiness.draft_pr_preparation_allowed` to `true` only for `passed`. These
flags are diagnostic only and never authorize staging, commits, pushes,
rebases, merges, pull-request publication, or cleanup. Recommend at most one
next Skill; never invoke it automatically.

## Output contract

Return exactly one English object with `schema: ValidationResult` and
`version: 1`. Preserve the supplied workspace identity and source versions,
record every unavailable input, and include:

- the exact current `head_sha`;
- history, diff, scope, test, and status-check references;
- one evaluation entry per acceptance and completion criterion and planned
  implementation step;
- all blockers, warnings, lost changes, unexpected changes, deviations, and
  readiness reasons;
- `validated_at`, `failure`, and at most one advisory
  `recommended_next_skill`.

The result is read-only diagnostic evidence. It must explicitly state that no
push, merge, rebase, conflict resolution, or other Git mutation was performed.
