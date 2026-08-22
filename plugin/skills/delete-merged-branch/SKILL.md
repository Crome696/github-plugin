---
name: delete-merged-branch
description: Delete exactly one verified, fully merged feature branch locally and/or remotely after separate exact authorization from the user or a matching target-repository AGENTS.md policy. Recheck pull-request merge identity, branch integration, worktree usage, recoverable work, default-branch protection, and branch state immediately before each deletion, never force-delete under uncertainty, and return a verified CleanupResult. Use only when the user explicitly asks to delete a merged branch or an applicable repository policy authorizes the exact deletion.
disable-model-invocation: true
---

# Delete Merged Branch

Delete one no-longer-needed feature branch after a successful merge and
separate authorization. Return exactly one version-1
[`CleanupResult`](../../shared/schemas/CleanupResult.yaml) handoff.
This Skill is an explicitly invoked, destructive cleanup workflow.

## Boundaries

- Cleanup never follows implicitly from a merge, push, pull request, review,
  issue closure, plan, or implementation authorization.
- Require separate exact authorization for each requested target and effect:
  repository, pull request or merge evidence, feature branch, remote name and
  branch ref, local branch deletion, remote branch deletion, and any worktree
  removal. The authorization may be an explicit user approval or a clearly
  applicable target-repository `AGENTS.md` policy. Local and remote deletion
  are independent operations.
- Never delete the default branch, a protected target branch, the primary
  checkout, or a branch currently checked out by any worktree.
- Never use `git branch -D`, force-push, remote force-delete, `git reset`,
  `git clean`, checkout/switch, or implicit worktree removal. This Skill does
  not remove worktrees; preserve them and return a blocked result unless a
  separately authorized cleanup workflow owns that operation.
- Preserve uncommitted, staged, untracked, unmerged, detached, or otherwise
  recoverable work. Unknown worktree ownership, active Git operations,
  conflicting state, or incomplete evidence is a stop condition.
- Do not infer that a branch is unused from its name, age, merged label, local
  tracking state, or absence of a visible worktree alone.
- Keep durable handoffs and authored text in English. Never expose credentials,
  private keys, `.env` values, personal data, or credential-bearing URLs.

## Required input

Require all of the following before any deletion:

1. A version-2 `PullRequestMerge` with `status: merged` and successful
   verification, including the exact repository, pull-request number, head
   branch, head SHA, base branch, base SHA, and merge commit SHA.
2. An explicit cleanup request identifying exactly one feature branch and
   separately selecting `local`, `remote`, or both deletion scopes. A remote
   deletion must identify one exact remote and branch ref.
3. A version-1 `CleanupResult` draft with `status: planned`, exact target
   identity, and `authorization.explicit: true`. The authorization evidence
   must name every requested deletion effect. A generic task authorization,
   merge approval, push authorization, or `PullRequestMerge.merge.delete_branch`
   field never substitutes for this cleanup authorization.
4. The applicable repository instructions, especially the target repository's
  `AGENTS.md`, loaded for this operation. Apply a repository-policy
  authorization only when it clearly names the exact deletion operation and
  target, including each requested local or remote effect; record its source
  path and concise quote or paraphrase in the cleanup authorization evidence.

Only `PullRequestMerge` version 2 is supported. A version-1, missing-version,
or otherwise legacy merge handoff is an unsupported input: return `blocked`
with the narrowest supported unsupported-version or legacy-input failure code
and perform no deletion. Do not adapt a v1 merge result into v2.

Reject missing, malformed, stale, cross-repository, contradictory, or
multi-target input with `status: blocked`; do not search for a likely branch.

## Read-only preflight

Perform these checks immediately before each requested deletion and record the
command, target, timestamp, returned value, and pass/fail/unknown outcome:

```text
gh pr view <number> --repo <owner>/<repo> --json number,url,state,mergedAt,mergeCommit,baseRefName,headRefName,headRefOid
git -C <repository_path> rev-parse --show-toplevel
git -C <repository_path> symbolic-ref --quiet --short HEAD
git -C <repository_path> rev-parse --verify <base_branch>^{commit}
git -C <repository_path> rev-parse --verify <feature_branch>^{commit}
git -C <repository_path> merge-base --is-ancestor <feature_branch> <base_branch>
git -C <repository_path> branch --list --format=%(refname:short)%00%(objectname)
git -C <repository_path> worktree list --porcelain
git -C <repository_path> status --porcelain=v1 --untracked-files=all
git -C <repository_path> ls-files -u
git -C <repository_path> rev-parse --git-path MERGE_HEAD
git -C <repository_path> rev-parse --git-path CHERRY_PICK_HEAD
git -C <repository_path> rev-parse --git-path REVERT_HEAD
git -C <repository_path> rev-parse --git-path rebase-merge
git -C <repository_path> rev-parse --git-path rebase-apply
git -C <repository_path> rev-parse --git-path BISECT_LOG
git -C <repository_path> ls-remote --heads <remote> refs/heads/<feature_branch>
```

For a remote target, also confirm the remote URL without recording
credentials, the observed remote SHA, and that the exact remote ref still
matches the approved target.

Every required preflight check must pass:

- The live PR is merged and its repository, number, URL, head branch, head SHA,
  base branch, and merge commit match the supplied `PullRequestMerge`.
- The feature branch is fully integrated into the verified base branch. For a
  merge commit, ancestry must prove integration. For squash or rebase merges,
  use the verified PR head identity, changed-file/commit evidence, merge
  result, and current base state; do not claim raw branch-tip ancestry when it
  is not observable.
- The target is not the default branch, base branch, or a protected branch.
- The local branch resolves to the expected PR head or an explicitly verified
  equivalent. A changed or unknown tip blocks deletion.
- No worktree has the target branch checked out. A registered worktree with
  uncommitted or recoverable content blocks deletion; do not remove it.
- The repository is not in a merge, rebase, cherry-pick, revert, bisect, or
  unmerged state, and the target worktree is clean when local deletion is
  requested.
- A remote branch exists only when remote deletion is requested, and its
  current SHA and ref identity match the approved target.

Do not treat absent, skipped, unavailable, or ambiguous evidence as a pass.
If any check fails or is unknown, preserve the target and return `blocked`.

## Announcement and operation order

Immediately before a write, state the exact effect:

> Delete feature branch `<branch>` from `<owner>/<repository>` at the verified
> merged PR `<pr-number>` and base `<base-branch>`. Delete local branch:
> `<true|false>`; delete remote `<remote>` branch: `<true|false>`. No force
> deletion, worktree removal, reset, clean, merge, rebase, or unrelated
> mutation will occur.

If both scopes are authorized, perform local deletion first and remote deletion
second. Do not perform the second operation if the first operation has an
ambiguous result or its postcondition cannot be verified. Do not ask again when
the recorded user or repository-policy authorization is current and exactly
matches the operation; otherwise stop and obtain exact authorization.

### Local branch

Use exactly:

```text
git -C <repository_path> branch -d <feature_branch>
```

Immediately verify that the exact local ref no longer exists and that no
unapproved worktree or recoverable artifact was removed. If Git refuses the
safe deletion, do not retry with `-D`; return `blocked` and preserve the
branch.

### Remote branch

Use exactly:

```text
git -C <repository_path> push <remote> --delete <feature_branch>
```

Immediately verify that the exact remote ref no longer exists with a fresh
`git ls-remote`. Never retry an ambiguous remote write. If the ref may still
exist or the result cannot be verified, return `partial` and record the
uncertainty; never use a force option.

## Post-deletion verification

Populate one `CleanupResult` action for every requested and skipped target:

- `local_branch` uses `remove` only after the local ref is absent and records
  the preflight and postcondition evidence.
- `remote_branch` uses `remove` only after the remote ref is absent and records
  the remote, observed prior SHA, and postcondition evidence.
- `worktree` uses `preserve` or `not_run`; it must never claim removal.
- Any unsafe or unrequested target uses `preserve`, `inspect`, or `not_run`
  with a concrete reason.

Return `completed` only when every requested deletion and its verification pass.
Return `partial` when a deletion may have occurred but verification is
incomplete or contradictory. Return `blocked` when no deletion was attempted.
Set `preserved_artifacts` for every branch, worktree, or file retained because
of uncertainty, recoverable work, active use, missing authorization, or failed
verification. Include `completed_at` only for an observed completed result.

## Failure codes

Use the narrowest applicable code:

| Code | Meaning |
| --- | --- |
| `missing_input` | Required merge, cleanup, target, or repository evidence is absent or malformed. |
| `unsupported_version` | The supplied merge handoff is not the supported `PullRequestMerge v2`. |
| `legacy_input` | A `PullRequestMerge v1` or other legacy merge handoff was supplied; no adapter is allowed. |
| `merge_not_verified` | The exact pull request is not proven successfully merged. |
| `branch_not_integrated` | Full integration into the verified base is not proven. |
| `target_protected` | The target is the default, base, protected, or otherwise forbidden branch. |
| `worktree_in_use` | The branch is checked out or associated with an active worktree. |
| `recoverable_work` | Uncommitted, untracked, unmerged, or otherwise recoverable work must be preserved. |
| `operation_in_progress` | Merge, rebase, cherry-pick, revert, bisect, or another Git operation is active. |
| `authorization_missing` | Exact authorization for one or more requested deletion effects is absent. |
| `state_changed` | Immediate live state differs from the approved target. |
| `safe_delete_refused` | Git refused the non-force local deletion; no force fallback is allowed. |
| `remote_delete_failed` | The remote rejected the non-force deletion. |
| `verification_incomplete` | A deletion may have occurred but its postcondition is unavailable or contradictory. |
| `api_failure` | A required read or Git operation failed before a deletion attempt. |

## Final checklist

- [ ] Exact merged PR and merge result match the feature branch and base branch.
- [ ] Full branch integration is proven using appropriate merge-method evidence.
- [ ] Exact separate authorization covers each requested local, remote, and
      worktree effect.
- [ ] Default, protected, primary-checkout, active-worktree, and uncertain
      targets were preserved.
- [ ] No recoverable work or in-progress Git operation was discarded.
- [ ] Local and remote deletion were treated as independent operations.
- [ ] Only non-force deletion commands were used.
- [ ] Each attempted deletion has immediate postcondition verification.
- [ ] The returned `CleanupResult` preserves every skipped or unsafe artifact.
