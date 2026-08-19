---
name: close-linked-issue
description: Close exactly one uniquely linked GitHub issue after a verified pull-request merge when automatic closure did not occur and the implementation is fully evidenced. Require exact final authorization from the user, a matching target-repository AGENTS.md policy, or a validated close-on-merge intent for the narrow integrate-pr fallback; refresh the pull request, relationship, and issue immediately before the write, optionally publish a separately authorized merge-reference comment, and verify every external effect.
disable-model-invocation: true
---

# Close Linked Issue

Close exactly one uniquely linked GitHub issue through the GitHub issue-state
operation and return a version-2
[`LinkedIssueClosure`](../../shared/schemas/LinkedIssueClosure.yaml) result.
This Skill is explicitly invoked and is a narrow post-merge mutation workflow.
Triage close without a merged pull request belongs to
[close-github-issue](../close-github-issue/SKILL.md).

## Boundaries

- Never close an issue unless the exact pull request is verifiably merged, the
  relationship identifies exactly one linked issue, automatic closure was
  expected but did not occur, and current evidence establishes complete
  implementation.
- Require fresh exact authorization for closing the exact repository and issue.
  The authorization may be an explicit user approval, a clearly applicable
  target-repository `AGENTS.md` policy, or the narrow
  `close_on_merge_intent` fallback authorization described below. Merge
  approval, `MergeReadiness`, a closing keyword by itself, a linked-issue
  result, or generic task-scoped issue-update authorization never substitutes
  for the required exact target and current `not-closed` verification.
- An optional merge-reference comment is a separate GitHub write. Require
  separate exact authorization for its exact text from the user or a matching
  target-repository `AGENTS.md` policy, and publish it only after issue closure
  is verified.
- Never close an already closed issue. Return `no-op` when the immediate
  preflight confirms that automatic or earlier closure already occurred.
- Never mutate issue title, body, labels, assignees, milestones, pull requests,
  reviews, threads, branches, Git state, local files, or worktrees.
- Never retry an ambiguous write, roll back a closure, or conceal partial
  verification. Never expose credentials, tokens, private keys, or sensitive
  logs.
- Keep the handoff and authored GitHub text in English.

## Required handoffs

Require all of the following before any write:

1. A version-1 `PullRequestMerge` with `status: merged`, successful verification,
   and exact repository, PR number, head SHA, base branch, and merge commit.
2. A version-1 `LinkedIssueClosureVerification` with `status: not-closed`,
   `closure.expected: true`, `linkage.status: linked`, one selected issue, and
   matching PR, merge, and issue identity.
3. A current, identity- and SHA-matched `LinkedIssueStatusAssessment` with
   `status: consistent`. This is required evidence that every explicit issue
   acceptance criterion is covered. Missing criteria, partial or unverifiable
   coverage, conflicting relationships, or a stale head blocks as incomplete
   implementation.
4. A version-1 `PullRequestIssueLink` with `status: linked`,
   `closes_issue_on_merge: true`, exactly one matching issue, and matching
   pull-request repository, number, branches, and head SHA. This handoff is
   required when `authorization.source: close_on_merge_intent` is used.
5. A version-2 `LinkedIssueClosure` handoff with `status: approved`,
   `authorization.exact_target: true`, `authorization.exact_close_operation:
   true`, `authorization.close_authorized: true`, and an explicit
   authorization source. A separate requested comment requires
   `comment_authorized: true` and exact `comment_text`.

Reject missing, malformed, stale, cross-repository, or contradictory inputs
with `status: blocked`; do not search for a likely issue or PR.

Before asking for close or comment approval, read the applicable repository
instructions, especially the target repository's `AGENTS.md`. A policy may
replace the conversational gate only when it clearly names this repository,
the uniquely linked issue, the close operation, and, when requested, the exact
comment effect. Record its source path and concise quote or paraphrase in
`authorization.evidence`, use `authorization.source: repository_policy`, and
do not wait for another affirmative response. For the integrate-pr fallback,
use `authorization.source: close_on_merge_intent` only when the supplied
`PullRequestIssueLink`, verified merge, and current `not-closed` verification
all match the exact target. That source replaces only the conversational close
approval; it does not replace merge, linkage, implementation, issue-state,
freshness, or secret evidence.

## Immediate live preflight

Perform these reads as close as possible to the write and record repository,
identifiers, returned fields, and timestamps:

```text
gh pr view <number> --repo <owner>/<repo> --json number,url,state,mergedAt,mergeCommit,baseRefName,headRefOid
gh api graphql -f query='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:100){nodes{number title url repository{nameWithOwner}}}}}}' -F owner=<owner> -F name=<repo> -F number=<number>
gh issue view <issue-number> --repo <issue-owner>/<issue-repo> --json title,state,stateReason,number,url,updatedAt,closedAt
gh api --paginate --slurp "repos/<issue-owner>/<issue-repo>/issues/<issue-number>/timeline" -H "Accept: application/vnd.github+json"
```

Require every preflight check to be `pass`:

- PR repository, number, URL, `MERGED` state, head SHA, base branch, and merge
  commit match the supplied verified merge.
- The live closing relationship still contains exactly the selected issue in
  the same repository. Mentioned-only, ambiguous, missing, or changed
  relationships block.
- The issue identity matches and its state is `OPEN`.
- `updatedAt` has not changed since the verification baseline, when available.
- The relationship still establishes validated close-on-merge intent and the
  target branch is the verified merge target.
- The implementation assessment remains current for the exact head SHA.

If the issue is already closed, return `no-op` with fresh evidence and do not
attempt a write. If any state is changed, unknown, unavailable, or ambiguous,
return `blocked` with the narrowest failure code.

## Close authorization and announcement

Immediately before the write, state the exact effect:

> Close GitHub issue `<issue-owner>/<issue-repository>#<issue-number>` because
> uniquely linked pull request `<owner>/<repository>#<pr-number>` was verified
> merged at `<merge_commit_sha>` into `<base_branch>`. No issue metadata,
> pull-request, review, thread, branch, or cleanup mutation will occur.

Do not infer authorization from any other workflow. Continue without another
chat prompt when exact user or repository-policy authorization is current and
matches the preflight target, or when the exact `close_on_merge_intent`
fallback is established by the required linked-issue handoff and current
verification. Stop when exact authorization is absent, stale, ambiguous, or
does not match the preflight target.

## Close operation

Perform exactly one issue-state mutation:

```text
gh issue close <issue-number> --repo <issue-owner>/<issue-repository>
```

Do not add title, body, label, assignee, milestone, comment, merge, or cleanup
options. If the command errors or has an ambiguous result, do not retry. Reload
the issue once:

- return `blocked` if it is still open and no closure occurred;
- return `partial` if it may be closed but identity or required verification is
  incomplete.

## Post-close verification

Reload the exact issue and verify:

1. repository, issue number, URL, and selected issue identity;
2. `state: CLOSED`;
3. `closedAt` and `stateReason` where GitHub exposes them;
4. issue fields outside the state transition are unchanged;
5. the closure occurred after the verified merge and remains attributable only
   as supported by observable timeline evidence.

Return `closed` only when all required checks pass. If any requested comment is
not authorized, return `closed` after closure verification and record that it
was not requested or authorized.

## Optional merge-reference comment

Only after a verified `closed` result and separate exact user or
repository-policy authorization may the Skill publish the exact approved
comment. The comment must be derived solely from
verified evidence, for example:

```text
Closed manually after PR <https://github.com/<owner>/<repo>/pull/<number>> was merged with commit `<merge_commit_sha>` into `<base_branch>` on `<merged_at>`. GitHub did not automatically close this uniquely linked issue.
```

Refresh the issue immediately before publishing. Do not publish if it was
reopened, the target changed, the comment text changed, or authorization is
missing. Publish one comment, reload the issue comments, and verify the exact
comment identity, author, body, and timestamp. Return `closed-with-comment`
only after that verification; otherwise return `partial` while preserving the
verified closure result.

## Result and failure semantics

- `closed`: issue closure was written and fully verified.
- `closed-with-comment`: closure and the separately authorized comment were
  both written and verified.
- `no-op`: immediate preflight proved the issue was already closed; this Skill
  performed no write.
- `blocked`: no write occurred because required identity, verification,
  authorization, implementation evidence, or preflight state was not valid.
- `partial`: a write may have occurred but closure or comment verification is
  incomplete or contradictory.

Use these failure codes:

| Code | Meaning |
| --- | --- |
| `missing_input` | Required handoff or identity is absent or malformed. |
| `verification_not_eligible` | Merge, linkage, closure expectation, or implementation evidence is insufficient. |
| `stale_verification` | Supplied evidence does not match the current PR head or issue baseline. |
| `already_closed` | The target was already closed; use `no-op` without mutation. |
| `approval_missing` | Exact close or comment authorization is absent. |
| `state_changed` | Immediate live state differs from the approved target. |
| `permission_denied` | GitHub rejected the authorized operation. |
| `api_failure` | A required read or write failed. |
| `verification_incomplete` | A write may have occurred but required verification is unavailable or contradictory. |

## Final checklist

- [ ] Exact unique linked issue is selected.
- [ ] Verified merge and `not-closed` automatic-closure evidence match live PR identity.
- [ ] Current implementation evidence is complete for the exact head SHA.
- [ ] Exact close authorization covers the repository, issue, and operation,
  with user, `AGENTS.md`, or validated close-on-merge intent evidence.
- [ ] PR, relationship, and issue state were refreshed immediately before writing.
- [ ] Already closed, ambiguous, incomplete, changed, or unknown states caused no close write.
- [ ] Exactly one `gh issue close` operation was attempted.
- [ ] Issue closure and preserved fields were verified.
- [ ] Any comment had separate exact authorization and independent verification.
- [ ] No unrelated GitHub, Git, or local mutation occurred.
