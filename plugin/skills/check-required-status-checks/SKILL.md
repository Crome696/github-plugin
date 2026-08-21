---
name: check-required-status-checks
description: Temporary compatibility adapter for the former required-status projection; preserve one existing PullRequestCheckInspection without reading GitHub or changing any normalized semantics. Do not invoke for new workflows.
disable-model-invocation: true
---

# Check Required Status Checks (Compatibility Adapter)

This Skill name is retained for one documented migration interval so existing
host references do not break. It accepts one supplied version-1
[`PullRequestCheckInspection`](../../shared/schemas/PullRequestCheckInspection.yaml)
handoff and returns that same normalized handoff unchanged. The sole
normalization owner is
[`inspect-pr-checks`](../inspect-pr-checks/SKILL.md). New callers MUST consume
that Skill directly; `wait-required-checks` no longer invokes this adapter.

This Skill has no independent required-check semantics. It does not fetch,
classify, project, deduplicate, recalculate summaries, or decide whether a
pull request may merge.

## Boundaries

- Read exactly one supplied `PullRequestCheckInspection` handoff only. Never
  read GitHub, edit pull requests, branches, rulesets, branch protection,
  comments, or local files.
- Never read GitHub or local files, rerun workflows, dispatch CI, cancel jobs,
  request reviews, merge, or mark a pull request ready.
- Never infer, match, deduplicate, classify, or reclassify a requirement or
  check. Preserve exact names, contexts, results, raw values, flags, summary
  counts, policy evidence, timestamps, and failure summaries.
- Preserve the exact repository, pull-request number, base branch, and head
  SHA. Do not substitute another pull request or commit.
- Keep structured fields in English and never return secrets, credentials,
  environment values, complete logs, or unrelated output.

## Input

Accept only one version-1 `PullRequestCheckInspection` with `status: inspected`
or `partial`. Validate its repository, pull-request number and URL, base
branch, and non-null head SHA. Reject a raw repository/number, URL, or
`LoadedPullRequest` as the primary input; those belong to
`inspect-pr-checks`.

## Compatibility workflow

1. Validate the input contract and exact identity.
2. Return the supplied `PullRequestCheckInspection` with every field and value
   preserved verbatim.
3. If the handoff is malformed or contradictory, return `partial` or `blocked`
   with structured failure evidence; do not repair it by recalculating fields.

## Output

Return exactly the supplied version-1 `PullRequestCheckInspection` handoff.
The adapter never creates a second semantic owner, invokes another Skill,
changes GitHub or Git state, grants merge authorization, or recommends a
workflow. Remove this adapter after the documented migration interval once
all host references consume `inspect-pr-checks` directly.
