---
name: rebase-branch
description: Rebase one explicitly identified feature branch onto one verified target branch after exact user or target-repository AGENTS.md authorization, preserve a stopped conflict for separate resolution, and return BranchRebase evidence. Use only when the user explicitly authorizes this local rebase or an applicable repository policy authorizes the exact operation.
disable-model-invocation: true
---

# Rebase Branch

Rebase exactly one verified feature branch onto one verified target branch and
return a version-1 [`BranchRebase`](../../shared/schemas/BranchRebase.yaml)
handoff. This Skill owns the local rebase mutation only. It does not resolve
conflicts, push the result, merge a pull request, or clean up Git state.

## Boundaries

- Require one explicit repository, one absolute verified worktree path, one
  checked-out feature branch, and one verified target branch fetch.
- Require one verified pull request with one base branch, one head branch, and
  one current head SHA matching the selected worktree.
- Require separate exact authorization for the repository, worktree, feature
  branch, target branch, target tracking SHA, and local rebase operation. The
  authorization may be an explicit user approval or a clearly applicable
  target-repository `AGENTS.md` policy.
- Read the applicable repository instructions, especially the target
  repository's `AGENTS.md`, before evaluating the rebase gate. Apply a policy
  only when it clearly names this repository, worktree or branch scope, target
  SHA, and local rebase operation. Record its source path and concise quote or
  paraphrase in the authorization evidence, set its source to
  `repository_policy`, and do not wait for a chat approval. Routine task,
  plan, push, review, or merge authorization never substitutes for rebase
  authorization.
- Never rebase the primary checkout or a default branch.
- Never push, force-push, merge, commit, stage, reset, restore, clean, check
  out, switch, create, delete, or modify a worktree, branch, remote, or
  configuration.
- Never run `git rebase --continue`, `git rebase --skip`, or `git rebase
  --abort`. If the rebase conflicts, leave the rebase stopped and return
  `status: conflicted`.
- A host-specific pre-rebase Hook may later permit one standalone recovery
  command only when the existing `PreRebaseGate`, active rebase metadata
  (`head-name`, `onto`, and `orig-head`), and exact registered worktree still
  match. That guard does not authorize this Skill to choose, resolve, or run
  recovery.
- Do not resolve conflict markers or invoke a conflict-resolution capability.
  Recommend `detect-rebase-conflicts` only as a separate read-only analysis.
- Keep repository paths relative in durable evidence where possible. Do not
  expose credentials, tokens, private keys, `.env` values, or raw sensitive
  logs.
- Keep the structured handoff and authored durable text in English. Use the
  active conversation language for approval announcements and blockers.

## Required input

Accept one operation request containing:

```yaml
schema: BranchRebase
version: 1
repository: owner/repository
worktree:
  path: C:/absolute/path/to/worktree
  branch: agent/example-task
pull_request:
  number: 42
  url: https://github.com/owner/repository/pull/42
  base_branch: main
  head_branch: agent/example-task
  head_sha: 89abcdef0123456789abcdef0123456789abcdef
target:
  remote_name: origin
  branch_name: main
  tracking_ref: refs/remotes/origin/main
  tracking_sha: 0123456789abcdef0123456789abcdef01234567
authorization:
  approved: true
  exact_target: true
  exact_operation: true
  source: repository_policy
  evidence: "Target repository AGENTS.md authorizes this exact local rebase."
```

The request must also include a verified active `BranchWorkspace` and a
verified `TargetBranchFetch`. The pull-request repository and head identity
must match the worktree and branch; its single base branch must match the
target fetch. Validate every supplied repository, path, branch, target
reference, and revision. Reject conflicting handoffs rather than selecting a
preferred value.

## Preflight

Before asking for or applying the mutation:

1. Verify that the worktree belongs to the expected repository, is registered,
   is not the primary checkout, and has the expected feature branch checked
   out.
2. Verify that `TargetBranchFetch.status` is `verified`, its repository and
   target branch match the request, and its full `tracking_sha` equals the
   selected target revision.
3. Verify the target revision, worktree `HEAD`, and branch reference with
   read-only Git commands. Do not infer a target from the current branch,
   upstream name, or a default-branch convention.
4. Verify a clean worktree and index, no unmerged entries, and no active
   merge, rebase, cherry-pick, revert, or bisect operation.
5. Verify the registered worktree is the expected non-primary worktree and
   that the checked-out branch and HEAD match the pull request.
6. Verify the selected remote, its configured default branch, and the local
   target tracking ref are current and match the verified `TargetBranchFetch`;
   do not fetch implicitly.
7. Verify the feature-branch upstream resolves to the pull-request head branch
   and the pre-rebase HEAD is backed by that remote-tracking SHA.
8. Verify that the exact authorization covers the named worktree, feature
   branch, target branch, target SHA, pull request, and rebase operation.

Any failed, missing, stale, or unknown required preflight result is
`blocked`; it is never treated as a pass. Announce the exact mutation and wait
for affirmative user approval only when a clearly applicable repository-policy
authorization is not recorded in the handoff.

## Write the local PreRebaseGate snapshot

After every read-only preflight passes and before invoking Git, write exactly
one current version-1 [`PreRebaseGate`](../../shared/schemas/PreRebaseGate.yaml)
snapshot to the ignored path
`.cursor/hooks/state/pre-rebase.json`. The snapshot must preserve the complete
verified workspace, pull-request identity, full `TargetBranchFetch` handoff,
exact rebase authorization, and current ISO-8601 `written_at` value:

```json
{
  "schema": "PreRebaseGate",
  "version": 1,
  "workspace": {
    "repository": "owner/repository",
    "path": "C:/absolute/path/to/worktree",
    "branch": "agent/example-task",
    "head_sha": "89abcdef0123456789abcdef0123456789abcdef"
  },
  "pull_request": {
    "repository": "owner/repository",
    "number": 42,
    "url": "https://github.com/owner/repository/pull/42",
    "base_branch": "main",
    "base_branch_candidates": ["main"],
    "head_branch": "agent/example-task",
    "head_sha": "89abcdef0123456789abcdef0123456789abcdef"
  },
  "target_fetch": "<the complete verified TargetBranchFetch object>",
  "authorization": {
    "approved": true,
    "exact_target": true,
    "exact_operation": true,
    "source": "explicit_user",
    "evidence": "The user approved this exact local rebase.",
    "approved_by": "user",
    "approved_at": "2026-08-16T11:00:00.000Z"
  },
  "written_at": "2026-08-16T11:00:00.000Z"
}
```

The gate is evidence of exact user or repository-policy authorization. Do not put secrets,
tokens, private keys, `.env` contents, credentials, or raw remote output in
the snapshot. If the directory or snapshot cannot be written and re-read as
valid JSON, return `status: blocked` and do not invoke Git. Do not use the
hook to repair, replace, or delete a stale or contradictory snapshot.

## Rebase workflow

1. Record the full pre-rebase `HEAD` SHA and all preflight evidence.
2. Write and verify the local `PreRebaseGate` described above.
3. Run only the bounded operation equivalent to:

   `git -C <worktree_path> rebase <target_tracking_sha>`

   The target must be the verified full tracking SHA, not an inferred branch
   name or user-provided command fragment.
4. If Git reports a conflict or leaves an active rebase operation, do not run
   another Git mutation. Return `status: conflicted`, preserve the current
   rebase state and evidence, and recommend
   `detect-rebase-conflicts`.
5. If the command fails without a conflict, return `status: blocked` or
   `partial` with the sanitized failure evidence. Do not retry by changing the
   command or target.
6. On success, verify that the expected feature branch remains checked out,
   the target SHA is an ancestor of the new `HEAD`, no Git operation remains
   active, and the new full `HEAD` SHA is available.
7. Return `status: rebased` only when all post-rebase verification conditions
   pass. Return `partial` when Git may have changed state but verification is
   incomplete or contradictory.

The result supplies `pre_rebase_head_sha`, `rebased_base_sha`, and
`post_rebase_head_sha` for `validate-rebased-branch`. That validation is a
separate read-only step and is required before any later readiness or merge
decision.

## Output

Return exactly one English `BranchRebase` handoff containing:

- exact repository, worktree, feature branch, target branch, and full SHAs;
- the verified pull-request number, URL, base branch, head branch, and head
  SHA used by the pre-rebase gate;
- exact authorization evidence and its source;
- preflight outcomes and sanitized command evidence;
- whether the rebase was attempted and whether it succeeded, conflicted, or
  failed;
- post-rebase verification and any active-operation state;
- a structured failure for every blocked or partial result; and
- at most one advisory `recommended_next_skill`.

Never report a conflicted or partially verified rebase as successful, and never
claim that conflict resolution, pushing, merging, or cleanup occurred.
