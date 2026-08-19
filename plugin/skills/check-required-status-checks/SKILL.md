---
name: check-required-status-checks
description: Determine the status checks actually required for one GitHub pull request, distinguish required checks from optional checks, and report failed, pending, skipped, or missing requirements with evidence. Use automatically when a workflow needs a focused, read-only required-status-check assessment; never rerun CI, modify GitHub, or change local files.
---

# Check Required Status Checks

Project one supplied version-1
[`PullRequestCheckInspection`](../../shared/schemas/PullRequestCheckInspection.yaml)
handoff into its focused required-check view. `inspect-pr-checks` owns the
single live GitHub fetch; this Skill performs no second network read and
returns the same stable contract with the required and optional outcomes
preserved.

This Skill is diagnostic and read-only. It reports policy evidence already
retrieved by `inspect-pr-checks`; it does not decide whether a pull request may
merge.

## Boundaries

- Read exactly one supplied `PullRequestCheckInspection` handoff only. Never
  read GitHub, edit pull requests, branches, rulesets, branch protection,
  comments, or local files.
- Never rerun workflows, dispatch CI, cancel jobs, request reviews, merge, or
  mark a pull request ready.
- A check is required only when an exact entry is returned by branch-protection
  or an applicable active ruleset. Never infer requirements from workflow files,
  check frequency, branch names, pull-request text, repository conventions, or
  similar display names.
- Preserve the exact repository, pull-request number, base branch, and head
  SHA. Do not substitute another pull request or a different commit.
- Keep policy evidence unavailable or partial separate from an empty policy
  result. Record an empty successfully retrieved source as
  `requirement_sources[].status: empty`; do not report a requirement as missing
  when the requirement source could not be retrieved.
- Match a requirement to a check by exact context or name equality. Do not use
  aliases, case folding, substring matching, or workflow-name matching.
- Preserve raw GitHub status and conclusion values. Sanitize failure summaries;
  never return secrets, credentials, environment values, complete logs, or
  unrelated CLI output.

## Input

Accept only one version-1 `PullRequestCheckInspection` with `status: inspected`
or `partial`. Validate its repository, pull-request number and URL, base
branch, and non-null head SHA. Reject a raw repository/number, URL, or
`LoadedPullRequest` as the primary input; those belong to
`inspect-pr-checks`.

## Projection workflow

1. Validate the input contract and preserve its exact repository, pull-request
   identity, base branch, head SHA, source statuses, and inspection timestamp.

2. Preserve the required-check set. Deduplicate only exact name/context matches
   and retain every source reference. Set `checks[].required` to `true` for an
   exact required match, `false` only when all requirement sources are known and
   the check matches none, and `null` when policy evidence is partial or
   unavailable.

3. Preserve all check results, raw status and conclusion values, failure
   summaries, URLs, timestamps, and unavailable fields. Do not reclassify a
   check in this projection.
4. Verify the summary counts from the preserved `checks` list without changing
   any result. If the input is incomplete or contradictory, return `partial` or
   `blocked` with structured failure evidence rather than fabricating a result.

## Output

Return exactly one version-1 `PullRequestCheckInspection` handoff. The focused
projection may be passed to `assess-merge-readiness` or
`collect-review-feedback`, but it never reruns CI, reads GitHub, changes GitHub
or Git state, grants merge authorization, or invokes `inspect-pr-checks`
automatically. To obtain current live evidence, callers must run
`inspect-pr-checks` first.
