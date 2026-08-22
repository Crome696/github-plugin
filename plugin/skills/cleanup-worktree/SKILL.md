---
name: cleanup-worktree
description: Remove exactly one verified Git worktree after a successfully merged pull request and separate exact cleanup authorization from the user or a matching target-repository AGENTS.md policy. Recheck worktree ownership, branch identity, repository state, recoverable changes, active Git operations, and primary-checkout protection immediately before safe removal, then verify removal and return a CleanupResult. Use only when the user explicitly asks to remove a merged implementation worktree or an applicable repository policy authorizes the exact cleanup.
disable-model-invocation: true
---

# Cleanup Worktree

Remove one implementation worktree only after its pull request has been
successfully merged and the exact cleanup operation has been separately
authorized. Return exactly one version-1
[`CleanupResult`](../../shared/schemas/CleanupResult.yaml) handoff.
This Skill is an explicitly invoked, destructive local-Git workflow.

## Boundaries

- Cleanup never follows implicitly from a merge, push, pull request, review,
  issue closure, plan, implementation, or branch-deletion authorization.
- Require one exact authorization covering the repository, absolute worktree
  path, associated branch, merge evidence, worktree removal, and any
  `git worktree prune` effect. The authorization may be an explicit user
  approval or a clearly applicable target-repository `AGENTS.md` policy. A
  generic task authorization is insufficient.
- Accept exactly one registered worktree target. Never search for or select a
  likely target from a branch name, path fragment, title, age, or current
  checkout.
- Never remove the primary checkout, the default or protected branch, an
  unregistered or ambiguously owned worktree, or any worktree whose state is
  not fully known and clean.
- Never use `git worktree remove --force`, `git clean`, `git reset`, branch
  deletion, checkout, switch, merge, rebase, cherry-pick, stash, or remote
  mutation. Do not modify files to make cleanup possible.
- Preserve all uncommitted, staged, untracked, unmerged, detached, or otherwise
  recoverable work. An active merge, rebase, cherry-pick, revert, bisect, or
  conflicting index is a stop condition.
- `git worktree prune` is allowed only after the exact worktree removal
  succeeds, only when separately covered by the exact authorization, and only
  after a dry-run confirms the intended stale metadata. Never use a force
  option or prune metadata belonging to an unrelated worktree.
- If a removal command errors, times out, or has an ambiguous result, do not
  retry. Perform one read-only verification and return `partial` if removal
  may have occurred; otherwise return `blocked`.
- Keep durable handoffs and authored text in English. Never expose credentials,
  private keys, `.env` values, personal data, or credential-bearing URLs.

## Required input

Require all of the following before any write:

1. A version-2 `PullRequestMerge` with `status: merged` and successful
   verification, including the exact repository, pull-request number,
   head branch, head SHA, base branch, base SHA, and merge commit SHA.
2. An explicit cleanup request identifying exactly one absolute worktree path
   and its associated branch. The request must state whether stale metadata
   pruning is authorized.
3. A version-1 `CleanupResult` draft with `status: planned`,
   `authorization.explicit: true`, and evidence naming every requested effect.
4. The applicable repository instructions, especially the target repository's
  `AGENTS.md`, loaded for this operation. Apply a repository-policy
  authorization only when it clearly names this exact cleanup operation,
  target, and any requested stale-metadata pruning, and preserve its source
  path and concise quote or paraphrase in the cleanup authorization evidence.

Only `PullRequestMerge` version 2 is supported. A version-1, missing-version,
or otherwise legacy merge handoff is an unsupported input: return `blocked`
with the narrowest supported unsupported-version or legacy-input failure code
and perform no write. Do not adapt a v1 merge result into v2.

Reject missing, malformed, stale, cross-repository, contradictory, or
multi-target input with `status: blocked`; do not infer identity or
authorization.

## Read-only preflight

Run every check immediately before removal. Record the exact command, target,
timestamp, returned value, and `pass`, `fail`, or `unknown` outcome without
recording sensitive output:

```text
git -C <repository_path> rev-parse --show-toplevel
git -C <repository_path> worktree list --porcelain
git -C <repository_path> status --porcelain=v1 --untracked-files=all
git -C <repository_path> ls-files -u
git -C <repository_path> symbolic-ref --quiet --short HEAD
git -C <repository_path> rev-parse --verify <base_branch>^{commit}
git -C <repository_path> rev-parse --verify <worktree_branch>^{commit}
git -C <repository_path> merge-base --is-ancestor <worktree_branch> <base_branch>
git -C <repository_path> rev-parse --git-path MERGE_HEAD
git -C <repository_path> rev-parse --git-path CHERRY_PICK_HEAD
git -C <repository_path> rev-parse --git-path REVERT_HEAD
git -C <repository_path> rev-parse --git-path rebase-merge
git -C <repository_path> rev-parse --git-path rebase-apply
git -C <repository_path> rev-parse --git-path BISECT_LOG
git -C <repository_path> -C <worktree_path> status --porcelain=v1 --untracked-files=all
git -C <repository_path> -C <worktree_path> ls-files -u
```

Also reload the exact merged pull request through the available GitHub
capability and confirm that its repository, number, URL, head branch, head SHA,
base branch, base SHA, and merge commit still match the supplied
`PullRequestMerge`. Do not treat an unavailable or ambiguous GitHub result as
proof of a successful merge.

The target passes only when all of these are true:

- The worktree is registered exactly once at the approved absolute path and
  its branch and repository match the approved identity.
- The worktree is not the primary checkout, and neither its branch nor the
  base branch is the default or protected branch.
- The branch is integrated into the verified base using merge-method-appropriate
  evidence. Do not claim raw tip ancestry for squash or rebase merges when it
  is not observable.
- The worktree has no staged, unstaged, untracked, unmerged, or recoverable
  changes, and no Git operation is in progress in the repository or worktree.
- The target path is distinct from every other registered worktree, and the
  requested cleanup still matches the exact live state.

Any failed, missing, unavailable, or unknown check blocks before removal.
Record the target in `preserved_artifacts` with a concrete reason.

## Announcement and operation order

Immediately before the write, state the exact effect:

> Remove worktree `<absolute_path>` for branch `<branch>` from repository
> `<owner>/<repository>` after verified merged PR `<number>` at head
> `<head_sha>` into `<base_branch>`. Remove only this worktree:
> `<true>`. Run authorized stale-metadata pruning:
> `<true|false>`. No force removal, file cleanup, branch deletion, checkout,
> reset, merge, rebase, remote mutation, or unrelated change will occur.

Do not ask again when the recorded user or repository-policy authorization is
current and exactly matches this operation. Otherwise stop and obtain exact
authorization.

## Worktree removal

Use exactly:

```text
git -C <repository_path> worktree remove <absolute_worktree_path>
```

Do not add `--force` or any cleanup fallback. Immediately verify that the
approved path is no longer registered, the path no longer exists, and no other
worktree or primary-checkout state changed.

If pruning is authorized and the removal verification passes, first inspect:

```text
git -C <repository_path> worktree prune --dry-run
```

Proceed with:

```text
git -C <repository_path> worktree prune
```

only when the dry-run lists solely stale metadata for the already removed
approved target. Verify again with `git worktree list --porcelain` and preserve
any unrelated stale metadata instead of pruning it.

## Result and verification

Populate one `CleanupResult` action for the worktree and one for pruning when
requested:

- `worktree` uses `remove` only after the exact postcondition is verified.
- `worktree` uses `preserve` or `not_run` for every unsafe, uncertain, dirty,
  active, protected, or unauthorized target.
- `other` uses `inspect` or `preserve` for stale metadata that was not safely
  attributable to the removed target.
- Every action includes evidence and a concrete reason when applicable.
- `preserved_artifacts` includes every retained worktree, branch, file, or
  metadata target that could contain recoverable work or has uncertain
  ownership.

Return `completed` only when every authorized requested action and its
postcondition pass. Return `partial` when a removal or prune may have occurred
but verification is incomplete or contradictory. Return `blocked` when no
destructive operation was attempted. Use `planned` only for a validated draft
before execution.

## Failure codes

Use the narrowest applicable code:

| Code | Meaning |
| --- | --- |
| `missing_input` | Required merge, target, repository, or contract evidence is absent or malformed. |
| `unsupported_version` | The supplied merge handoff is not the supported `PullRequestMerge v2`. |
| `legacy_input` | A `PullRequestMerge v1` or other legacy merge handoff was supplied; no adapter is allowed. |
| `merge_not_verified` | The exact pull request is not proven successfully merged. |
| `worktree_not_registered` | The exact path is not registered as one worktree. |
| `worktree_identity_mismatch` | Repository, path, branch, or worktree identity differs from approval. |
| `primary_checkout_target` | The requested path is the primary checkout. |
| `target_protected` | The associated branch or base is default, protected, or otherwise forbidden. |
| `branch_not_integrated` | Integration into the verified base is not proven. |
| `recoverable_work` | Uncommitted, untracked, unmerged, or otherwise recoverable work must be preserved. |
| `worktree_in_use` | The target is active, checked out elsewhere, or ambiguously associated. |
| `operation_in_progress` | A merge, rebase, cherry-pick, revert, bisect, or conflicting Git operation is active. |
| `authorization_missing` | Exact authorization for removal or pruning is absent. |
| `state_changed` | Immediate live state differs from the approved target. |
| `safe_remove_failed` | Git rejected non-force worktree removal. |
| `prune_not_safe` | Dry-run identified unrelated or ambiguous stale metadata. |
| `verification_incomplete` | Removal may have occurred but its postcondition is unavailable or contradictory. |
| `api_failure` | A required read or Git operation failed before removal. |

## Final checklist

- [ ] The exact pull request is successfully merged and still matches all
      supplied identity and SHA evidence.
- [ ] Exact separate authorization covers this repository, absolute path,
      branch, removal, and any pruning effect.
- [ ] The target is one registered non-primary worktree and is not protected.
- [ ] The worktree and repository contain no recoverable or unmerged work.
- [ ] No Git operation is in progress and all required evidence is known.
- [ ] Only the safe non-force `git worktree remove` command was used.
- [ ] Pruning, if requested, was dry-run checked and limited to the exact stale
      metadata of the removed target.
- [ ] The worktree removal and every requested postcondition were verified.
- [ ] Every unsafe, uncertain, or preserved artifact is represented in the
      returned `CleanupResult`.
