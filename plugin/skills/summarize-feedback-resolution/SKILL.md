---
name: summarize-feedback-resolution
description: Summarize one completed pull-request feedback follow-up into resolved, open, disputed, and blocked items with evidence-linked solutions, commits, tests, checks, next steps, and diagnostic merge impact. Use automatically after feedback-resolution validation; never modify GitHub, Git, code, threads, or checks.
---

# Summarize Pull-Request Feedback Resolution

Consume one version-1
[`FeedbackResolutionValidation`](../../shared/schemas/FeedbackResolutionValidation.yaml)
handoff and return exactly one version-1
[`FeedbackResolutionSummary`](../../shared/schemas/FeedbackResolutionSummary.yaml)
handoff. This Skill produces a read-only status summary after external
follow-up; it never performs or authorizes a mutation.

## Boundaries

- Read only the supplied validation handoff and bounded current pull-request,
  commit, diff, test, check, and discussion evidence.
- Preserve the exact repository, pull-request number, URL, baseline head SHA,
  and current head SHA. Conflicting or stale identity evidence is blocked.
- Preserve every selected feedback ID exactly once. Never invent a feedback
  item, solution, requirement, test result, check requirement, or merge rule.
- Keep authored handoff content in English and redact secrets, credentials,
  private keys, personal data, and unnecessary raw logs.
- Never edit code, files, Git state, branches, worktrees, issues, pull
  requests, reviews, comments, checks, or discussions. Never reply, resolve or
  reopen a thread, rerun checks, mark a pull request ready, merge, or invoke
  another Skill.

## Required evidence and status mapping

Require a version-1 `FeedbackResolutionValidation` with status `validated` or
`partial`, exact pull-request identity, current head SHA, and one result for
each selected item. Return `blocked` for missing or malformed input, identity
conflicts, duplicate or missing result IDs, or unsupported versions. Return
`partial` when material evidence or current-state fields are unavailable.

Classify each validation result independently:

- `addressed` becomes `resolved` only when its evidence demonstrates the
  expected correction and all applicable required tests and checks pass.
- `not_addressed` becomes `open` and must retain the remaining problem and
  concrete correction needed.
- `partially_addressed` becomes `disputed` when the evidence shows competing
  interpretations, incomplete correction, or unresolved material impact.
- `unverifiable` becomes `blocked` when required evidence is missing, stale,
  pending, unavailable, or an external dependency prevents verification.

Thread state is context only. It never proves a correction. Do not call an item
resolved merely because its thread is resolved or outdated.

## Merge impact and next steps

Derive `merge_impact` only from the item statuses and explicitly retrieved
current-head check and test evidence. A pending, skipped, missing, unavailable,
or differently SHA-bound check or test is not a pass. Report whether merge is
diagnostically `ready`, `blocked`, `uncertain`, or `not_ready`; this field
never authorizes merging. Include one actionable next step for every open,
disputed, or blocked item and retain unresolved questions separately.

## Workflow

1. Validate contract versions, exact identity, selected IDs, and current-head
   freshness.
2. Preserve results in input order and map each result to exactly one summary
   group with its smallest evidence references.
3. Link every claimed solution to observed diff, commit, test, or check
   evidence; use thread evidence only as corroborating context.
4. Record shared blockers, uncertainties, prioritized next steps, and the
   diagnostic merge impact without inferring policy.
5. Set `summarized` only when every item is evaluated with complete material
   evidence. Use `partial` for limitations and `blocked` for failed
   preconditions.

The output is an evidence handoff only. It does not authorize thread
resolution, replies, review publication, check reruns, code changes, commits,
pushes, or merging.
