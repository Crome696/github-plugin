---
name: merge-pull-request
description: Merge exactly one open GitHub pull request only after exact final authorization from the user or a matching target-repository AGENTS.md policy and a current positive MergeReadiness assessment. Recheck draft status, reviews, required checks, conflicts, base-branch freshness, and the allowed repository merge strategy immediately before the single merge operation, then verify and return the merge commit, method, and final pull-request status. Use only when the user explicitly asks to merge a verified pull request or an applicable repository policy authorizes the exact merge.
disable-model-invocation: true
---

# Merge Pull Request

Merge exactly one GitHub pull request through the GitHub pull-request merge
operation and return a version-2
[`PullRequestMerge`](../../shared/schemas/PullRequestMerge.yaml) result.
This Skill is explicitly invoked. A `MergeReadiness.status: ready` result is
diagnostic evidence and never invokes or authorizes this Skill. The final S03
reader chain is rebuilt immediately before the merge gate; an older readiness
summary is never treated as current policy.

## Boundaries

- Merge only one exact, open, non-Draft pull request with a current
  `MergeReadiness` version 3 result of `ready`.
- Require exact final authorization for the exact repository, pull-request
  number and URL, expected head SHA, base branch, merge method, commit title
  and message, and branch-deletion effect. The authorization may be an explicit
  user approval or a clearly applicable target-repository `AGENTS.md` policy.
  Plan, implementation, commit, push, Draft pull-request, review, or earlier
  general approval never satisfies this gate.
- Use a merge method only when it is both expressly authorized by the user or
  a matching repository policy and allowed by current repository policy and
  GitHub. When multiple methods are allowed, block unless policy or the exact
  user authorization selects one. Never infer a default.
- Never use local `git merge`, local `git rebase`, auto-merge, or a merge queue.
  Server-side `rebase` is permitted only when it is the exact authorized
  GitHub merge method; it never starts a local rebase workflow.
- Never resolve conflicts, rerun checks, publish or dismiss reviews, reply to
  or resolve threads, edit code, push, change repository settings, create a
  worktree, delete a local branch, or clean up a worktree.
- Do not delete the remote head branch unless `merge.delete_branch` is true and
  the exact user or repository-policy authorization independently sets
  `delete_branch_authorized: true`.
  Never clean up before a successful merge verification. Cleanup remains a
  separately authorized workflow.
- Keep durable handoffs and GitHub-facing content in English. Conversation
  summaries may use the conversation language.
- Never expose tokens, credential-bearing remote URLs, private keys, `.env`
  values, personal data, or raw sensitive logs.

## Input contract

Require one version-2 [`PullRequestMerge`](../../shared/schemas/PullRequestMerge.yaml)
handoff in `status: approved` and one current version-3
[`MergeReadiness`](../../shared/schemas/MergeReadiness.yaml) result nested in
`readiness` or supplied alongside it.

Before any GitHub write, reject or return `blocked` when any of the following
is absent, malformed, stale, or inconsistent:

1. `repository` is an explicit `owner/repository`, and the pull-request number
   is positive. Canonical URL, base branch, head branch, and full expected head
   and base SHAs are present.
2. `authorization.exact_target`, `authorization.exact_merge_operation`, and
   `authorization.merge_authorized` are all `true`. Its evidence covers the
   exact identity, expected head and base SHAs, base branch, method, commit
   metadata, and remote branch-deletion effect.
3. `merge.method` is exactly `merge`, `squash`, or `rebase`; commit title and
   message are exact approved values or `null`.
4. `merge.delete_branch: true` also has
   `authorization.delete_branch_authorized: true`. With either field false,
   omit branch deletion.
5. `readiness.schema` is `MergeReadiness`, `version` is `3`, `status` is
   `ready`, its repository, pull-request number, and assessed head SHA
   equal the merge target, and its `issue_coverage.status` is either
   `covered` or `waived` (with complete waiver evidence). A partial
   assessment, `needs-attention`, or `blocked` assessment never passes.
6. The read-only readiness evidence is complete, current, and tied to its
   recorded head. Do not treat a positive assessment as merge authorization.
7. The selected strategy is expressly authorized by current repository policy
   or the exact final user or repository-policy authorization. If repository
   policy permits several methods but does not choose one, the authorization
   must choose one.
8. The final S03 reader chain has produced one complete, current,
   identity-matched `PullRequestReadinessEvidence` snapshot after the last
   live PR/base preflight. Required checks, approval thresholds, change
   requests, and thread dispositions are evaluated from that snapshot.

Read the applicable repository instructions, especially the target
repository's `AGENTS.md`, before deciding whether a repository-policy
authorization covers the exact merge. Apply it only when it clearly names this
repository, pull request or branch scope, merge operation, selected method,
commit metadata, and branch-deletion effect. Preserve its source path and
concise applicable quote or paraphrase in `authorization.evidence`, set
`authorization.source: repository_policy`, and do not wait for a separate chat
approval. A generic task-scoped authorization is insufficient. The policy
replaces the conversational gate only; it does not replace live PR, SHA,
readiness, strategy, or hook evidence.

## Current-state preflight

Perform every check as close as possible to the write. Record the exact
repository, PR number, head SHA, base branch, base SHA, timestamp, command or
endpoint, and relevant returned field for each check.

1. Confirm authentication without recording confidential output:

   ```text
   gh auth status
   ```

2. Load the exact live PR, including its state, Draft state, branches, head and
   base OIDs, mergeability, merge-state status, merge-commit value, and current
   allowed merge methods where GitHub exposes them. Never infer an equivalent
   PR from the checkout, branch, remote, or title.
3. Confirm the PR is still open and non-Draft; its canonical repository, number,
   URL, base branch, head branch, and head SHA equal the approved handoff.
4. Confirm the current base SHA from the PR payload and a direct fresh
   base-branch lookup equal `expected_base_sha`. Preserve the returned SHA in
   `preflight.live_base_sha`. A changed, unavailable, or ambiguous base state
   blocks before merging.
5. Re-run the dedicated source readers, `build-pr-readiness-evidence`, and
   `assess-merge-readiness` for the live PR head. The resulting version-3
   assessment must return `ready` for the same repository, PR, and current head SHA,
   and its `issue_coverage.status` must still be either `covered` or
   `waived` (with complete waiver evidence).
   Refresh required-check policy and outcomes, approval policy and reviews,
   required open-thread evidence, mergeability/conflicts, and required linked
   issue coverage. Treat unavailable policy evidence as a block, never as a
   pass. Do not reuse a prior `MergeReadiness` summary as the policy source.
6. Confirm the selected merge method is both currently enabled by GitHub and
   selected by the exact user or repository-policy authorization or applicable
   documented repository policy.
   Never substitute `merge`, `squash`, or `rebase`.
7. Confirm that every authorization field still describes the exact live
   repository, PR, head and base SHAs, base branch, method, approved metadata,
   and deletion effect.

Set each `preflight` result to `pass`, `fail`, or `unknown`. A single `fail` or
`unknown` blocks the merge. If the current head, base, Draft state, reviews,
checks, conflicts, required threads, strategy, or other required state changes
at any point, return `blocked` with `failure.code: state_changed`; do not
attempt a merge.

## Execution announcement and final race check

Immediately before the write, state the exact effect:

> Merge GitHub pull request `<owner>/<repository>#<number>` from
> `<head_branch>` at `<expected_head_sha>` into `<base_branch>` at
> `<expected_base_sha>` using the
> authorized `<method>` method, with the exact approved commit metadata and
> remote branch deletion set to `<true|false>`. No rebase workflow, cleanup,
> review, thread, check, or other mutation will be performed.

Do not ask again when the recorded final authorization is explicit or
repository-policy-backed and still matches the exact operation. If
authorization is missing, ambiguous, stale, or does not cover the precise
operation, stop and obtain new explicit final approval.

Then perform one minimal live read of the PR. Verify it remains open, non-Draft,
mergeable, and at the expected head SHA, expected base SHA, and base branch.
The merge command must carry the same full expected head SHA through the
supported CLI `--match-head-commit` or API `sha` compare-and-set field. If the
platform cannot express that exact head binding, return `blocked` without
writing. If anything differs from the passed preflight, return `blocked`
without writing.

## Local pre-merge gate

After the final live race check and immediately before the one GitHub merge
write, write exactly one current version-3
[`PreMergeGate`](../../shared/schemas/PreMergeGate.yaml) snapshot to
`.cursor/hooks/state/pre-merge.json`. The state directory is local-only and is
already ignored by the repository. Do not reuse an old, partial, stale, or
identity-mismatched snapshot, and do not repair missing handoffs by editing the
gate.

The snapshot must preserve the exact values from the approved
`PullRequestMerge`, current `MergeReadiness`, and verified workspace:

```json
{
  "schema": "PreMergeGate",
  "version": 3,
  "workspace": {
    "repository": "<BranchWorkspace.repository>",
    "path": "<BranchWorkspace.worktree_path>"
  },
  "pull_request": {
    "repository": "<PullRequestMerge.repository>",
    "number": "<PullRequestMerge.pull_request.number>",
    "url": "<PullRequestMerge.pull_request.url>",
    "base_branch": "<PullRequestMerge.pull_request.base_branch>",
    "head_branch": "<PullRequestMerge.pull_request.head_branch>"
  },
  "expected_head_sha": "<PullRequestMerge.expected_head_sha>",
  "expected_base_sha": "<PullRequestMerge.expected_base_sha>",
  "merge": "<exact PullRequestMerge.merge>",
  "authorization": "<exact PullRequestMerge.authorization>",
  "preflight": "<exact final PullRequestMerge.preflight>",
  "readiness": "<current version-3 MergeReadiness with embedded version-1 PullRequestReadinessEvidence>",
  "written_at": "<current ISO-8601 timestamp>"
}
```

Verify that the file parses, identifies the same repository, pull request,
base and head SHAs, selected method, commit metadata, and branch-deletion
effect, and contains explicit authorization. The host-specific `pre-merge`
checker validates the complete snapshot deterministically and performs no live
GitHub acquisition or policy interpretation.
Hook then performs its own deterministic read-only validation. It must fail
closed when Draft status, reviews, open blocking threads, approvals, required
checks, mergeability, base freshness, issue linkage, readiness, or explicit
authorization changes or becomes unavailable. The Hook does not merge,
repair blockers, rerun checks, mutate reviews or threads, or rewrite the
snapshot.

## Merge operation

Perform exactly one GitHub pull-request merge with:

- the exact repository and PR number;
- the exact approved method;
- expected head SHA protection when the GitHub API or CLI supports it;
- exact approved commit title and message only when non-null and supported by
  the selected method; and
- remote branch deletion only when both deletion fields are true.

Use the GitHub API or an equivalent `gh pr merge` invocation. Do not add an
auto-merge, merge-queue, admin-bypass, local-Git, force, review, or cleanup
option. The API/CLI invocation is allowed only when it carries the exact
expected-head compare-and-set; unsupported forms fail closed.

If the merge command errors, times out, or reports an ambiguous result, do not
retry. Perform exactly one read-only PR lookup:

- Return `blocked` if the lookup proves no merge occurred.
- Return `partial` if the PR may have been merged but the resulting identity,
  strategy, commit, or final state cannot be fully verified.

## Post-merge verification

After a successful response, reload the exact PR and verify:

1. canonical repository, PR number, and URL;
2. final merged state and merged timestamp;
3. returned merge commit SHA;
4. the final target branch contains the verified merge commit;
5. the actual method agrees with the authorized method where GitHub provides
   evidence; if GitHub cannot expose that fact directly, preserve the executed
   method and verification limitation explicitly;
6. remote head-branch deletion only when requested and authorized; a
   non-requested branch is preserved and recorded as `not_requested`.

Return `status: merged` only when all required verification checks pass. Return
`partial` when a merge may or did occur but any required verification is
unavailable, contradictory, or fails. Return `blocked` only when no merge was
attempted or the single post-error lookup proves no merge occurred.

When the host-specific `post-merge` Hook observes this command, it may inject a
read-only `PostMergeStatus` containing the same live merge identity, expected
issue-closure result, cleanup availability, open actions, and deviations. This
status is diagnostic only and never performs or authorizes issue closure,
branch deletion, or worktree removal.

Populate `result.merge_commit_sha`, `merge.method`, and final PR state only
from observed GitHub data. The user-facing result must state the merge commit
SHA, used strategy, PR URL, final PR state, and whether the remote head branch
was deleted. Never begin cleanup; advise a separate explicitly authorized
cleanup workflow only after `status: merged`.

## Failure codes

| Code | Meaning |
| --- | --- |
| `invalid_input` | Required identity, SHA, strategy, or contract fields are missing or invalid. |
| `authorization_missing` | The exact final merge or requested branch-deletion authorization is absent. |
| `readiness_not_ready` | The supplied current readiness result is not `ready`. |
| `stale_readiness` | Readiness identity or head SHA differs from the live PR. |
| `state_changed` | The live PR, head, base, Draft state, checks, reviews, conflicts, or other required preflight state changed. |
| `method_not_allowed` | The selected method is not explicitly selected or not currently allowed. |
| `auth_unavailable` | GitHub authentication cannot support the required read or merge operation. |
| `inaccessible` | Required PR, policy, check, review, or ruleset evidence cannot be retrieved. |
| `merge_failed` | GitHub rejected the single merge operation and the follow-up proves no merge occurred. |
| `verification_failed` | A merge may have occurred but required post-merge verification is incomplete or contradictory. |
| `api_failure` | A required GitHub request failed before a merge attempt. |

## Final checklist

- [ ] Exact final merge authorization covers target, head, base, method, metadata, and deletion effect, with user or `AGENTS.md` evidence.
- [ ] Current version-3 `MergeReadiness` is `ready` for the exact live head and embeds one complete version-1 `PullRequestReadinessEvidence` snapshot.
- [ ] Live PR is open, non-Draft, mergeable, and unchanged directly before the write.
- [ ] Required checks, reviews, approvals, threads, and policy evidence are current and passing.
- [ ] The exact method is currently allowed and explicitly selected.
- [ ] Exactly one GitHub merge operation was attempted.
- [ ] Merge commit, strategy, and final PR state were verified, or `partial` preserves the uncertainty.
- [ ] No cleanup, local Git mutation, branch deletion without approval, review mutation, or other side effect occurred.
