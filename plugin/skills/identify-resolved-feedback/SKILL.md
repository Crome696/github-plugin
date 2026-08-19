---
name: identify-resolved-feedback
description: Compare collected pull-request feedback with the latest verified pull-request state, later commits, current diff, and explicit test evidence to identify feedback that may already be fixed. Use automatically during pull-request feedback follow-up; mark only clearly evidenced items as resolved candidates and never modify discussions or publish replies.
---

# Identify Resolved Pull-Request Feedback

Compare one read-only
[`CollectedReviewFeedback`](../../shared/schemas/CollectedReviewFeedback.yaml)
handoff with the latest verified pull-request state and supplied diff, commit,
and test evidence. Return exactly one version-1
[`ResolvedReviewFeedback`](../../shared/schemas/ResolvedReviewFeedback.yaml)
handoff.

`resolved_candidate` is an analysis result, not confirmation that a GitHub
thread is resolved. The Skill never changes GitHub or the local checkout.

## Boundaries

- Read only supplied version-1 handoffs and bounded identity evidence. Never
  edit files, Git state, branches, worktrees, issues, pull requests, reviews,
  comments, checks, or discussions.
- Never resolve or unresolve a thread, reply to or publish a comment, submit a
  review, request changes, approve, merge, rerun checks, or mark a pull request
  ready.
- Do not automatically invoke another Skill. `recommended_next_skill` is
  advisory only.
- Preserve the exact repository, pull-request number, canonical URL, and
  latest head SHA from validated sources. Never infer identity from titles,
  wording, timestamps, or the current checkout.
- Treat thread state, review state, comment order, timestamps, and a similar
  change as context only. None proves that feedback was fixed.
- Never label an item resolved candidate without concrete evidence in the latest
  diff, later commit, or explicit test result.
- Keep hypotheses and missing context in `uncertainties`; do not promote them
  to candidates.
- Redact secrets, credentials, private keys, `.env` values, personal data, and
  unnecessary command or log output. Keep the structured handoff in English.

## Inputs and identity validation

Require:

1. One version-1 `CollectedReviewFeedback` handoff with status `collected` or
   `partial`.
2. One latest pull-request state snapshot identifying repository, number, URL,
   base revision, latest head SHA, and retrieved commits/files where available.

Accept supplied current diff, later-commit evidence, and explicit test evidence
as bounded sources. They must identify the same pull request and latest head
SHA when a SHA is available. Reject missing or conflicting identity rather than
choosing a preferred source.

Validate:

1. Every contract version is `1`.
2. Repository, number, canonical URL, and non-null head SHAs agree.
3. The latest state is newer than the feedback baseline when a baseline SHA or
   retrieval marker is supplied; otherwise record the missing comparison
   baseline.
4. Feedback items have a problem core, requested correction or check failure,
   source reference, and confidence.
5. Diff and test evidence is explicit and reproducible; do not treat an
   unverified claim that tests passed as test evidence.

Return `blocked` for identity conflicts, malformed required inputs, or an
unusable latest state. Return `partial` when a requested source is missing,
blocked, stale, paginated incompletely, or lacks a comparison baseline.

## Resolution test

Evaluate every `open` feedback item and every failed or missing-check item
independently. Preserve already `resolved`, `outdated`, or `addressed` items
as source context; do not relabel them as newly resolved candidates.

Mark an item `resolved_candidate` only when all applicable conditions hold:

- The current head is the verified latest state.
- The changed code or configuration directly addresses the same problem core,
  causal mechanism, and requested correction, or an explicit test demonstrates
  the exact previously failing behavior now passes.
- The evidence points to the smallest relevant diff hunk, commit, or test
  result and identifies the observed correction.
- The evidence supports a plausible impact statement explaining why the
  original issue no longer occurs.

For a failed check, require an explicit successful result for the same check or
an equivalent verified behavior; a changed code path alone is insufficient.
For a missing required check, require a retrieved successful result and
evidence that it is the same required check at the latest head.

Use `high` confidence only when the correction and its effect are directly
demonstrated. Use `medium` only for a complete causal match with one material
limitation. Do not create a candidate with low confidence. Keep any unresolved
alternative in `uncertainties`.

## Workflow

1. Establish one pull-request identity and latest head SHA; copy source
   availability, baseline, and retrieval limitations into `source` and
   `latest_state`.
2. Read feedback items in input order and preserve their IDs, locations,
   problem cores, requested corrections, and source references.
3. Compare each item with later commits and the latest diff by causal mechanism,
   not keyword overlap, proximity, author, or commit message.
4. Check explicit test evidence. Record the exact test name, result, head SHA,
   and relevant output summary; unavailable or pending tests remain uncertain.
5. Emit one candidate record only for an unambiguous match. Preserve the
   original feedback reference and every evidence reference.
6. Add an uncertainty for each ambiguous, partially covered, or unverifiable
   item, including the concrete verification needed.
7. Set `status: identified` only when all requested feedback and relevant
   evidence were evaluated; otherwise set `partial`. Use `blocked` for failed
   preconditions.
8. Return at most one advisory `recommended_next_skill`; never execute it.

## Output

First provide a concise conversational summary. Then return exactly one
English version-1 `ResolvedReviewFeedback` handoff. Every candidate must
include a reproducible feedback reference, diff/commit or test reference,
observed correction, expected correction, impact, confidence, and a
resolution rationale.
