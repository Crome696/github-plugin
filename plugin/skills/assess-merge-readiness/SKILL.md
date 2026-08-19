---
name: assess-merge-readiness
description: Assess one GitHub pull request for evidence-backed merge readiness from its draft state, review state, open threads, approvals, required checks, conflicts, linked-issue coverage, and remaining blockers. Use automatically when a workflow needs a current merge-readiness assessment; never merge, rebase, resolve conflicts, rerun checks, mutate reviews or threads, or change local files.
---

# Assess Pull-Request Merge Readiness

Assess exactly one live GitHub pull request and return a version-2
[`MergeReadiness`](../../shared/schemas/MergeReadiness.yaml) handoff. This is a
diagnostic, read-only assessment. `ready` means only that the retrieved,
applicable conditions are satisfied; it never authorizes a merge.

## Boundaries

- Read GitHub and supplied handoffs only. Never edit a pull request, issue,
  review, thread, branch, ruleset, branch protection, or local file.
- Never merge, rebase, resolve conflicts, mark a pull request ready for review,
  rerun checks, publish a review, reply to or resolve a thread, or clean up Git.
- Use only observable repository and GitHub requirements. Do not invent an
  approval threshold, required check, issue relationship, acceptance criterion,
  merge policy, or blocker.
- Preserve the exact repository, pull-request number, canonical URL, base
  branch, and current head SHA. A changed or conflicting head SHA invalidates
  the assessment; refresh and assess the new head instead of combining states.
- Keep unavailable, ambiguous, stale, and unsupported evidence explicit. Never
  treat missing data as passing.
- Do not expose credentials, tokens, private keys, `.env` values, or raw
  sensitive logs.

## Input contract

Accept either:

```yaml
repository: owner/repository
number: 123
```

or one GitHub pull-request URL from which the exact repository and positive
pull-request number can be parsed. Do not guess identity from the current
checkout, branch, remote, issue, or most recently viewed pull request.

Optional supplied `LoadedPullRequest`, `LoadedPullRequestDiscussions`,
`OpenReviewThreadAssessment`, `LinkedIssue`, and
`PullRequestCheckInspection` and `RequiredApprovalInspection` handoffs may
provide evidence, but validate their
repository, number, URL, and head SHA. Refresh live state
when an input is absent, stale, partial, or inconsistent. If identity remains
unavailable, return `blocked` with `failure.code: missing_identity`.

## Evidence sources

Use the narrowest available evidence and record the endpoint, command, field,
identifier, and head SHA in each material evidence entry:

1. Exact pull-request payload for `state`, `isDraft`, `mergeable`,
   `mergeStateStatus`, `baseRefName`, and `headRefOid`.
2. Retrieved branch-protection and applicable active-ruleset data for required
   checks and review requirements. A workflow file, repository habit, or raw
   approval count is not sufficient.
3. Check-run and commit-status results for the exact head SHA, including
   required-check matching.
4. Reviews and review requests for submitted state, approval, dismissal, and
   change-request evidence.
5. Grouped review discussions for open, resolved, outdated, and ambiguous
   threads. Do not count a thread as resolved merely because a later commit
   appears related.
6. GitHub timeline and linked issue evidence for issue linkage and explicit
   closing relationships. Issue text alone does not establish coverage.
7. Supplied, SHA-bound feedback-resolution or test evidence only when its
   source and current-head relationship are explicit.

An empty list means the source loaded and contained no entries. A `null` field
or `unavailable_fields` entry means the source was unavailable. Preserve both
states distinctly.

## Assessment rules

Return exactly one status:

- `blocked`: the exact PR cannot be loaded, identity conflicts, authentication
  or primary evidence is unavailable, the PR is not open, the head is stale or
  ambiguous, or required evidence is insufficient to make a reliable
  assessment.
- `needs-attention`: the PR is assessable but has one or more evidenced
  conditions requiring action or confirmation, including Draft status, known
  conflicts, failing, pending, skipped, or missing required checks, active
  change requests, unresolved actionable threads, unmet retrieved approval
  requirements, missing or ambiguous linked-issue coverage, or documented
  remaining blockers.
- `ready`: the PR is open and non-Draft, mergeable, every explicitly retrieved
  required check passes, every explicitly retrieved review requirement is met,
  no current evidence-backed required problem or active change request remains,
  and required
  issue coverage is established by evidence, either as:
  - exactly one evidence-backed linked issue relationship (`issue_coverage.status: covered`), or
  - a waived unique-link condition with complete waiver evidence (`issue_coverage.status: waived`).
  All assessed fields must be available and tied to the same current head SHA.

If no requirement source establishes that an approval, check, issue, or thread
condition is required, report the source as unavailable or not applicable
instead of inventing a requirement. If a potentially applicable requirement
source is unavailable, use `blocked`; do not return `ready`.

## Workflow

1. Validate the supplied repository and PR number. Run `gh auth status` when
   authentication is not already known, without copying sensitive output.
2. Load the exact PR:

   ```text
   gh pr view <number> --repo <owner>/<repo> --json number,url,state,isDraft,baseRefName,baseRefOid,headRefOid,mergeable,mergeStateStatus,reviews,reviewRequests,statusCheckRollup
   ```

3. Retrieve the applicable base-branch protection and active rulesets. Extract
   only returned required checks and review requirements. Preserve inaccessible
   sources as unavailable.
4. Retrieve checks for the returned head SHA and compare required checks by
   exact name or context. Classify each as `pass`, `fail`, `pending`, `skipped`,
   or `missing` using the source evidence; never infer a required check.
5. Retrieve review requirements and current review state through the
   `check-required-approvals` workflow or a supplied
   `RequiredApprovalInspection` tied to the current head. Use only explicit
   branch-protection and applicable-ruleset evidence for approval thresholds
   and policy conditions. Count only current,
   non-dismissed approvals and active change requests supported by retrieved
   data. A missing or partial approval-policy source prevents `ready`; never
   interpret it as no required approvals. Record open, resolved, outdated, and
   ambiguous threads separately. When
   an `OpenReviewThreadAssessment` is supplied and tied to the current head,
   use its required-problem and uncertainty classifications as the preferred
   focused thread evidence. Do not turn optional discussions into blockers.
6. Resolve linked-issue and acceptance coverage only from explicit GitHub
   relationship, timeline, or supplied requirement evidence. Mark ambiguous or
   unavailable coverage explicitly. When the merge authorization records an
   exact unique-link waiver for this repository, pull request, and current
   head SHA, set `issue_coverage.status: waived` and include complete waiver
   evidence in `MergeReadiness.issue_coverage.waiver`.
7. Construct one status decision. Add one concrete blocker for every
   actionable condition, with severity, observable impact, and reproducible
   evidence. Keep uncertainties separate from confirmed blockers.
8. Return one complete version-2 `MergeReadiness` object tied to the current
   head SHA, followed by a concise conversation-language explanation.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository or PR number is absent and cannot be clarified. | `blocked` |
| `invalid_pull_request_number` | The PR number is not a positive integer or conflicts with supplied identity. | `blocked` |
| `pull_request_not_found` | The exact PR does not exist in the exact repository. | `blocked` |
| `auth_unavailable` | GitHub authentication is unavailable. | `blocked` |
| `inaccessible` | Required primary or policy evidence cannot be retrieved. | `blocked` |
| `stale_head` | Supplied evidence does not match the current PR head SHA. | `blocked`; refresh before continuing |
| `api_failure` | A required request fails or returns an unsupported response. | `blocked` |

## Output requirements

Return [`MergeReadiness`](../../shared/schemas/MergeReadiness.yaml) with:

- `status`: exactly `ready`, `needs-attention`, or `blocked`;
- exact PR identity, base branch, and current `head_sha`;
- mergeability, draft/state evidence, check and review state, and the
  `RequiredApprovalInspection` source when used;
- issue-coverage state and explicit requirement-source availability;
- evidence-backed `blockers`, `remaining_conditions`, and `uncertainties`;
- `assessed_at` and failure data when applicable.

Never include merge authorization, a merge command, rebase instructions,
conflict-resolution instructions, or a claim that the PR was changed.
