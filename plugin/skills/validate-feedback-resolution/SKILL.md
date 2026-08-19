---
name: validate-feedback-resolution
description: Validate whether every explicitly confirmed pull-request feedback item was addressed after external follow-up by comparing the latest diff, commits, tests, checks, and discussion context. Use automatically after feedback-resolution implementation; report per-item status, evidence, remaining problems, and whether a thread is eligible for a separate resolution workflow without replying or changing GitHub.
---

# Validate Pull-Request Feedback Resolution

Consume one version-1 `ClassifiedReviewFeedback` and one version-1
`FeedbackResolutionPlan`, then return exactly one version-1
[`FeedbackResolutionValidation`](../../shared/schemas/FeedbackResolutionValidation.yaml)
handoff. This Skill verifies external follow-up; it never performs or
authorizes a GitHub or Git operation.

## Boundaries

- Read only supplied handoffs and bounded current pull-request evidence. Never
  edit code, files, Git state, branches, worktrees, pull requests, reviews,
  comments, checks, or discussions.
- Never reply, resolve or reopen a thread, submit a review, rerun checks, mark
  a pull request ready, merge, or invoke another Skill.
- Evaluate exactly the IDs in `FeedbackResolutionPlan.scope.confirmed_feedback_item_ids`.
  Preserve every selected ID exactly once, including when evidence is missing.
- Preserve repository, pull-request number, canonical URL, plan baseline SHA,
  and current head SHA. Reject conflicting identity or stale current-state
  evidence rather than selecting a preferred source.
- Keep all handoff text in English. Redact secrets, credentials, private keys,
  personal data, and unnecessary raw logs.

## Required evidence

Require:

1. `ClassifiedReviewFeedback` with status `classified` or `partial`.
2. `FeedbackResolutionPlan` with status `planned` or `partial`.
3. A current pull-request snapshot with diff and commit evidence.
4. A current discussion snapshot identifying each relevant thread and its
   current state or explicitly recording that it is unavailable.
5. A current check inspection and SHA-bound test evidence when a feedback item
   or plan validation requires tests or checks.

`CollectedReviewFeedback`, `ResolvedReviewFeedback`, and external follow-up
notes are optional supporting sources. They never replace current diff,
discussion, check, or test evidence.

Return `blocked` for missing or malformed required inputs, identity conflicts,
unsupported versions, duplicate or unknown selected IDs, or an unusable
current state. Return `partial` when the requested evaluation is possible but
one or more material sources are missing, stale, pending, paginated
incompletely, or unavailable.

## Per-item validation

Evaluate each confirmed item by problem core, causal mechanism, expected
correction, affected location, and required validation:

- `addressed`: direct current evidence demonstrates the complete expected
  correction and its effect.
- `partially_addressed`: evidence demonstrates only part of the correction or
  leaves a material behavior, validation, or thread issue unresolved.
- `not_addressed`: the current evidence shows that the expected correction was
  not implemented or the original problem remains.
- `unverifiable`: the available sources cannot establish whether the correction
  works. State the exact missing evidence and verification needed.

Do not infer a solution from similar wording, commit messages, timestamps,
author identity, file proximity, or thread state. A changed code path alone is
insufficient when tests or checks were required.

For tests, require a successful result for the exact previously failing
behavior or a verified equivalent at the current head. For checks, require
the same check to pass at the current head; `pending`, `skipped`, `missing`,
`unavailable`, or a result from another SHA is not success.

Every result must include:

- the original feedback and resolution-group references;
- the preserved expected correction and observed current state;
- the smallest reproducible diff, commit, test, check, or thread evidence;
- observed effect, confidence, remaining problems, and a concrete follow-up;
- thread state and a separate `resolution_eligible` decision.

## Thread safety

Set `resolution_eligible: true` only when the item is `addressed`, all
applicable required tests and checks directly pass at the current head, the
thread identity and location are current and unambiguous, and no remaining
problem or uncertainty exists. This is an advisory diagnostic field only.

Set `resolution_eligible: false` with `do_not_resolve` for every partial,
unaddressed, unverifiable, stale, ambiguous, or insufficiently evidenced item.
An already resolved thread is context, not proof of the correction.

## Workflow

1. Validate versions, exact identity, plan baseline, selected IDs, and current
   head freshness.
2. Preserve selected IDs in plan order and map each to its classification,
   resolution group, original location, and discussion thread.
3. Compare the current diff and later commits by causal mechanism and expected
   behavior, not keyword overlap.
4. Verify every applicable test and required check against the current head.
5. Inspect thread status and location only as corroborating context; never treat
   it as proof of resolution.
6. Emit one result for every selected ID, with remaining problems or explicit
   missing verification.
7. Set `validated` only when every selected item is fully evaluated and all
   applicable evidence is complete. Use `partial` for material limitations and
   `blocked` for failed preconditions.

The output is read-only evidence. It does not authorize thread mutation,
responses, review publication, check reruns, or merging.
