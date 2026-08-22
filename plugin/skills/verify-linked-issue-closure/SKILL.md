---
name: verify-linked-issue-closure
description: Verify read-only whether one uniquely linked GitHub issue reached its expected closure state after a verified pull-request merge, preserving exact merge, relationship, issue-state, and timeline evidence. Use automatically for post-merge linked-issue closure verification; never close or edit an issue, change a pull request, publish GitHub content, or modify Git or local files.
---

# Verify Linked Issue Closure

Verify exactly one merged pull request and return one version-1
[`LinkedIssueClosureVerification`](../../shared/schemas/LinkedIssueClosureVerification.yaml)
handoff. This Skill is diagnostic and read-only. It does not authorize issue
closure, GitHub publication, integration, or cleanup.

## Boundaries

- Read GitHub and supplied handoffs only. Never close, reopen, edit, label,
  assign, or comment on an issue; change a pull request; merge or rebase;
  modify Git, a worktree, or local files; or invoke another Skill.
- Preserve exact repository, PR number, canonical URL, head SHA, base branch,
  merge timestamp, and merge-commit SHA. Do not combine stale supplied
  evidence with a newer live state.
- Select an issue only when a supplied `LinkedIssue` or retrieved GitHub
  relationship evidence establishes exactly one `linked` candidate.
  Mentioned-only, ambiguous, cross-repository, or inferred candidates are not
  primary issues.
- Keep closing intent, the GitHub closing relationship, target branch, issue
  state, closure timestamp, and closure attribution separate. A closed issue
  or temporal proximity alone does not prove that this PR closed it.
- Keep the structured handoff and rationale in English. Add a concise
  conversation-language summary after the handoff.

## Input contract

Accept either:

```yaml
repository: owner/repository
number: 123
```

or one pull-request URL from which the exact repository and positive number can
be parsed. Accept optional version-2 `PullRequestMerge`, version-1 `LinkedIssue`, and
`PullRequestIssueLink` handoffs only when their repository, PR, issue, branch,
and revision identities match the live target.

Only `PullRequestMerge` version 2 is supported. A supplied version-1,
missing-version, or otherwise legacy merge handoff must return `blocked` with
`failure.code: unsupported_version` (or the contract's equivalent legacy
failure code); do not reinterpret or adapt it into v2.

Validate one non-empty owner/repository and a positive integer PR number.
Reject aliases, decimals, zero, negative numbers, and repository mismatches.
If identity cannot be established, return `blocked` with
`failure.code: missing_identity`; never search for a likely PR or issue.

## Verify the merge

Load current PR and repository identity with the narrowest available reads:

```text
gh pr view <number> --repo <owner>/<repo> --json number,url,state,mergedAt,mergeCommit,baseRefName,headRefOid,body
gh repo view <owner>/<repo> --json nameWithOwner,defaultBranchRef
```

Run `gh auth status` only when authentication is not already known to be
available. Never copy credentials or sensitive authentication output into the
handoff.

Require all of the following before returning `verified` or `not-closed`:

1. The exact PR is live and has `state: MERGED`.
2. `mergedAt`, `mergeCommit.oid`, `baseRefName`, and `headRefOid` are available.
3. Any supplied `PullRequestMerge` reports `status: merged`, matches every live
   identity and revision field, and includes successful post-merge
   verification.
4. The base branch is compared with the current default branch. GitHub closing
   keywords normally trigger only after merge into the default branch.

If the PR is not verifiably merged, return `blocked` with
`failure.code: merge_not_verified`. If supplied merge evidence conflicts with
the live merge, return `blocked` with `failure.code: stale_merge_evidence`.

## Establish the linked issue

Reuse a complete matching `LinkedIssue` handoff when available. Otherwise load
only the relationship evidence needed to reproduce its selection:

```text
gh api --paginate --slurp "repos/<owner>/<repo>/issues/<number>/timeline" -H "Accept: application/vnd.github+json"
gh api graphql -f query='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:100){nodes{number title url repository{nameWithOwner}}}}}}' -F owner=<owner> -F name=<repo> -F number=<number>
```

Apply these rules:

- `linked` requires a supported closing keyword or explicit retrieved GitHub
  relationship.
- `mentioned` is a concrete reference without closing or relationship
  evidence.
- Dedupe candidates by repository and issue number while preserving every
  evidence source.
- Exactly one linked candidate is required. Multiple linked candidates are
  `ambiguous`; mentioned-only candidates are `unresolved`.
- Quoted, negated, or code-only closing-keyword examples do not establish
  close intent.
- A supplied `PullRequestIssueLink` with `refs` is neutral and does not create
  an expectation of closure. A supplied `fixes`, `closes`, or `resolves`
  relationship establishes the close-on-merge intent that must be verified.

Do not load an issue until one unique linked candidate is established.
Ambiguous or unresolved linkage returns `blocked` with `failure: null` because
the reads succeeded but the target required for verification was not unique.

## Verify the issue state and closure attribution

Load the exact selected issue and its timeline:

```text
gh issue view <issue-number> --repo <issue-owner>/<issue-repo> --json title,state,stateReason,number,url,updatedAt,closedAt
gh api --paginate --slurp "repos/<issue-owner>/<issue-repo>/issues/<issue-number>/timeline" -H "Accept: application/vnd.github+json"
```

Determine `closure.expected` independently:

- `true` when the selected issue has a validated close-on-merge relationship
  and the relationship is consistent. The target branch is recorded separately:
  GitHub's automatic closing behavior normally triggers only for a merge into
  the repository's default branch, while the post-merge fallback may close the
  exact still-open issue after a verified merge elsewhere.
- `false` for a neutral reference or an explicit close-on-merge opt-out.
- `null` when relationship or target-branch evidence is unavailable or
  conflicting.

Determine attribution from observable evidence:

- `verified` only when GitHub relationship or timeline evidence directly ties
  the issue closure to this PR or its verified merge.
- `supported` when consistent relationship, merge, issue state, and timing
  evidence support attribution but the platform does not expose a direct
  causal event.
- `unsupported` when the issue is closed but no evidence ties closure to this
  PR.
- `conflicting` when closure evidence identifies a different actor, PR, or
  cause.
- `unavailable` when required timeline or relationship fields cannot be
  retrieved.
- `not-applicable` when no automatic closure was expected.

Set temporal consistency to `consistent` only when `closedAt` is at or after
`mergedAt` and no retrieved event contradicts attribution. Timing is supporting
evidence only, never causal proof.

## Explain an issue that remains open

When automatic closure was expected but the issue remains open, set
`status: not-closed`, `failure: null`, and report the narrowest evidence-backed
cause. Prefer, in order:

1. The PR merged into a branch where GitHub's automatic closing behavior does
   not trigger; the exact close-on-merge intent remains available for the
   separate fallback workflow.
2. The relationship is keyword-only, malformed, quoted, negated, or points to
   a different repository or issue.
3. GitHub does not report the selected issue in `closingIssuesReferences`.
4. The issue was reopened after an observed closure event.
5. The state transition may not yet be observable; state the observation time
   and do not claim platform delay without evidence.
6. The cause is unknown because the required timeline or relationship evidence
   is unavailable.

Provide exactly one safe next step that preserves the read-only boundary, such
as reloading the exact issue relationship and timeline, confirming the base
branch and closing keyword, or handing the exact `not-closed` result to
`close-linked-issue` for the separately governed fallback. Never execute issue
closure inside this Skill.

## Deterministic result

Return exactly one `LinkedIssueClosureVerification`:

- `verified`: automatic closure was expected, the exact issue is closed, timing
  is consistent, and direct or sufficiently complete relationship evidence
  supports attribution to the verified merge.
- `not-closed`: automatic closure was expected, the exact issue remains open,
  and all primary reads completed.
- `not-applicable`: the unique relationship is neutral or explicitly carries
  no close-on-merge intent.
- `inconclusive`: the issue is closed but attribution to this PR is unsupported,
  conflicting, or materially incomplete, or the expectation cannot be
  determined after successful primary reads.
- `blocked`: exact PR, merge, or unique issue identity cannot be established,
  authentication is unavailable, or a required primary payload cannot be read.

Use `failure: null` for successfully observed `verified`, `not-closed`,
`not-applicable`, `inconclusive`, ambiguous, or unresolved outcomes. Populate
`failure` only for an operational or identity-validation failure. Keep
confirmed blockers separate from uncertainties.

## Output requirements

Include:

- exact PR, head, base, merge timestamp, merge-commit, and default-branch
  evidence;
- every issue candidate and the exact selected issue, or why selection was
  withheld;
- closing-keyword and GitHub relationship evidence separately;
- live issue state, state reason, `closedAt`, `updatedAt`, and timeline evidence;
- expected closure, observed state, attribution, temporal consistency, cause,
  and one safe next step;
- blockers, uncertainties, all evidence sources, rationale, and verification
  timestamp;
- `recommended_next_skill: null` unless one already available read-only
  diagnostic Skill is the single safe next step. The field is advisory and
  never invokes or authorizes that Skill.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository or PR number is absent and cannot be established. | `blocked` |
| `unsupported_version` | A supplied merge handoff is not the supported `PullRequestMerge v2`. | `blocked` |
| `legacy_input` | A `PullRequestMerge v1` or other legacy merge handoff was supplied; no adapter is allowed. | `blocked` |
| `invalid_pull_request_number` | The PR number is not a positive integer. | `blocked` |
| `pull_request_not_found` | The exact PR cannot be loaded. | `blocked` |
| `merge_not_verified` | The exact PR is not verifiably merged. | `blocked` |
| `stale_merge_evidence` | Supplied merge identity conflicts with live evidence. | `blocked` |
| `issue_not_found` | The unique selected issue cannot be loaded. | `blocked` |
| `inaccessible` | Required GitHub content is inaccessible. | `blocked` |
| `auth_unavailable` | GitHub authentication is absent or unusable. | `blocked` |
| `api_failure` | A required read-only request fails. | `blocked` |

## Compact examples

Expected closure remains open:

```yaml
schema: LinkedIssueClosureVerification
version: 1
status: not-closed
repository: octo-org/widgets
pull_request: {number: 42, url: https://github.com/octo-org/widgets/pull/42, state: merged, base_branch: main, head_sha: abc123}
merge: {status: verified, merged_at: "2026-08-11T10:00:00Z", merge_commit_sha: def456, target_is_default_branch: true, evidence: ["Live PR is merged into main."]}
linkage:
  status: linked
  primary_issue: {repository: octo-org/widgets, number: 17, url: https://github.com/octo-org/widgets/issues/17, title: Preserve issue context}
  candidates: []
  closing_relationship: {status: confirmed, expected_to_close: true, keyword_evidence: ["pull_request.body: Fixes #17"], github_evidence: ["closingIssuesReferences includes #17"], evidence: []}
  evidence: []
issue: {status: loaded, repository: octo-org/widgets, number: 17, url: https://github.com/octo-org/widgets/issues/17, title: Preserve issue context, state: open, state_reason: null, closed_at: null, updated_at: "2026-08-11T10:01:00Z", evidence: ["Live issue state is open."]}
closure:
  expected: true
  observed: open
  attribution: unavailable
  temporal_consistency: unavailable
  cause: GitHub reports the closing relationship, but the live issue remains open after the verified default-branch merge; no retrieved event explains the missing transition.
  safe_next_step: Reload the exact issue timeline and closing relationship before an authorized human decides whether manual closure is appropriate.
  evidence: []
blockers: []
uncertainties: []
evidence: {status: complete, sources: []}
rationale: The exact linked issue did not reach the closure state expected from the verified merge.
recommended_next_skill: null
verified_at: "2026-08-11T10:02:00Z"
failure: null
```

Closed state without causal evidence:

```yaml
schema: LinkedIssueClosureVerification
version: 1
status: inconclusive
repository: octo-org/widgets
pull_request: {number: 42, url: https://github.com/octo-org/widgets/pull/42, state: merged, base_branch: main, head_sha: abc123}
merge: {status: verified, merged_at: "2026-08-11T10:00:00Z", merge_commit_sha: def456, target_is_default_branch: true, evidence: []}
linkage:
  status: linked
  primary_issue: {repository: octo-org/widgets, number: 17, url: https://github.com/octo-org/widgets/issues/17, title: Preserve issue context}
  candidates: []
  closing_relationship: {status: keyword-only, expected_to_close: null, keyword_evidence: ["pull_request.body: Fixes #17"], github_evidence: [], evidence: []}
  evidence: []
issue: {status: loaded, repository: octo-org/widgets, number: 17, url: https://github.com/octo-org/widgets/issues/17, title: Preserve issue context, state: closed, state_reason: completed, closed_at: "2026-08-11T09:00:00Z", updated_at: "2026-08-11T09:00:00Z", evidence: []}
closure: {expected: null, observed: closed, attribution: unsupported, temporal_consistency: inconsistent, cause: The issue closed before this PR merged, so this merge cannot explain the closure., safe_next_step: Inspect the exact issue timeline to identify the observed closure source., evidence: []}
blockers: []
uncertainties: []
evidence: {status: partial, sources: []}
rationale: The issue is closed, but the closure cannot be attributed to this pull-request merge.
recommended_next_skill: null
verified_at: "2026-08-11T10:02:00Z"
failure: null
```
