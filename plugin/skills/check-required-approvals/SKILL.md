---
name: check-required-approvals
description: Inspect exactly one GitHub pull request's explicitly retrieved review-approval requirements and current effective review state for the recorded head SHA, returning evidence-backed satisfied and missing requirements for MergeReadiness. Use automatically when a merge-readiness workflow needs a focused approval gate; never infer review requirements, submit or dismiss reviews, request reviewers, merge, or modify GitHub or local files.
---

# Check Required Approvals

Inspect exactly one live GitHub pull request and return a version-1
[`RequiredApprovalInspection`](../../shared/schemas/RequiredApprovalInspection.yaml)
handoff. This is a diagnostic, read-only producer for `MergeReadiness`.
It reports explicit policy and review evidence; it never grants merge
authorization.

## Boundaries

- Read GitHub and supplied read-only handoffs only. Never edit a pull request,
  review, review request, branch-protection rule, ruleset, or local file.
- Never submit, dismiss, or request a review. Never merge, rebase, rerun
  checks, resolve threads, or change repository policy.
- Derive requirements only from retrieved base-branch protection and applicable
  active rulesets. Do not infer policy from repository habits, workflow files,
  CODEOWNERS files, pull-request text, branch names, review counts, or pending
  requests.
- Preserve exact repository, pull-request number, canonical URL, base branch,
  and current head SHA. Never combine evidence from different heads.
- Keep empty, partial, unavailable, ambiguous, and stale evidence distinct.
  Missing policy evidence is not proof that no policy exists.
- Do not expose credentials, tokens, private keys, `.env` values, or raw
  sensitive logs.

## Input contract

Accept either:

```yaml
repository: owner/repository
number: 123
```

or one exact GitHub pull-request URL. An optional `LoadedPullRequest` handoff
may supply identity, but the live pull request remains the source of truth.
Reject missing, malformed, conflicting, zero, negative, decimal, or
non-numeric pull-request numbers. If identity cannot be clarified, return
`blocked` with `failure.code: missing_identity`.

## Policy semantics

Retrieve and report only fields GitHub actually returns:

- `required_approving_review_count` establishes the minimum approval count.
- `dismiss_stale_reviews`, `require_code_owner_reviews`,
  `require_last_push_approval`, and required review-thread resolution are
  policy conditions only when explicitly returned by the applicable source.
- A ruleset review requirement contributes only when an active, target-branch
  ruleset is retrieved and its rule parameters explicitly identify it.
- Do not claim a code-owner approval, last-push approval, stale-review
  condition, or thread-resolution condition is satisfied without the
  corresponding author, commit, ownership, or thread evidence.
- Count only current, non-dismissed reviews whose returned state is
  `APPROVED`. Preserve raw states for every review.
- `CHANGES_REQUESTED` reviews are active change requests only when current
  review evidence supports that state. Pending review requests remain facts;
  they are missing requirements only when an explicit retrieved policy makes
  them relevant.

## Workflow

1. Validate the exact repository and positive pull-request number. Run
   `gh auth status` when authentication is not already known, without copying
   sensitive output.
2. Load the exact pull request and preserve the returned identity and head:

   ```text
   gh pr view <number> --repo <owner>/<repo> --json number,url,state,baseRefName,headRefOid,reviews,reviewRequests
   ```

   If the primary request fails, return `blocked`; do not substitute another
   pull request.
3. Retrieve the base branch's review-protection payload:

   ```text
   gh api "repos/<owner>/<repo>/branches/<base_branch>/protection/required_pull_request_reviews" -H "Accept: application/vnd.github+json"
   ```

   Extract only `required_approving_review_count`, `dismiss_stale_reviews`,
   `require_code_owner_reviews`, and `require_last_push_approval` when present.
   An explicitly unprotected branch is `empty`; permission, authentication,
   ambiguous 404, or server failures are `unavailable`.
4. Retrieve the repository ruleset inventory and each applicable active
   ruleset:

   ```text
   gh api --paginate --slurp "repos/<owner>/<repo>/rulesets?includes_parents=true&per_page=100" -H "Accept: application/vnd.github+json"
   gh api "repos/<owner>/<repo>/rulesets/<ruleset_id>" -H "Accept: application/vnd.github+json"
   ```

   Keep only active rulesets targeting the PR base branch. Extract review
   requirements only from returned `rules` entries and their explicit
   parameters. If a required detail cannot be loaded, preserve `partial` or
   `unavailable`; do not infer its contents.
5. Normalize exact requirements while retaining all source references. If no
   source was available, do not emit an empty requirement list. Record
   `requirements.status: empty` only when an available source explicitly
   reports no review requirements.
6. Normalize reviews and review requests from the exact PR payload. Preserve
   review IDs, authors, raw states, submitted timestamps, commit IDs, and
   evidence. Mark `qualifying_approval: true` only for a current,
   non-dismissed `APPROVED` review tied to the current head evidence.
7. Compare effective approvals and active change requests with retrieved
   requirements. Emit separate `satisfied_requirements` and
   `missing_requirements` entries with the smallest endpoint, field, review, or
   request evidence. Keep policy uncertainty separate from confirmed missing
   requirements.
8. Return exactly one complete `RequiredApprovalInspection` object. Use
   `inspected` only when the primary data and all requested policy sources are
   available, `partial` when enrichment or policy evidence is unavailable, and
   `blocked` when exact identity or primary PR data cannot be loaded. Append a
   concise conversation-language summary without replacing the English
   structured handoff.

## Output requirements

Return [`RequiredApprovalInspection`](../../shared/schemas/RequiredApprovalInspection.yaml)
with:

- exact PR identity, base branch, and current `head_sha`;
- source status and endpoint evidence for branch protection and rulesets;
- explicit requirements and policy conditions only;
- effective approvals, active change requests, and pending review requests;
- separate satisfied and missing requirements plus uncertainties;
- `requirements_met: null` whenever required policy or review evidence is
  unavailable, partial, stale, or ambiguous;
- sanitized failure data and `inspected_at`.

Never include a merge command, merge authorization, review publication payload,
thread mutation, or claim that GitHub was changed.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository or PR number is absent and cannot be clarified. | `blocked` |
| `invalid_pull_request_number` | The supplied number is not a positive integer or conflicts with supplied identity. | `blocked` |
| `pull_request_not_found` | The exact PR does not exist in the exact repository. | `blocked` |
| `auth_unavailable` | GitHub authentication is unavailable. | `blocked` |
| `inaccessible` | Primary or policy evidence is permission-protected. | `blocked` for primary data, otherwise `partial` |
| `requirement_unavailable` | A potentially applicable branch-protection or ruleset source cannot be retrieved. | `partial`; never treat it as empty |
| `stale_head` | Supplied review evidence does not match the current PR head. | `blocked`; refresh before continuing |
| `api_failure` | A required request fails or returns unsupported data. | `blocked` for primary data, otherwise `partial` |
