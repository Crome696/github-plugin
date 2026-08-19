---
name: collect-review-feedback
description: Collect open pull-request review threads, request-changes findings, relevant comments, and failed checks into a grouped read-only follow-up handoff. Use automatically when a pull request needs actionable feedback collected, grouped, or separated into open, resolved, outdated, and addressed items; never modify GitHub or local files.
---

# Collect Pull-Request Review Feedback

Collect exactly one pull request's available review feedback into a version-1
[`CollectedReviewFeedback`](../../shared/schemas/CollectedReviewFeedback.yaml)
handoff. The result is a structured starting point for follow-up work, not a
review decision, merge decision, or implementation authorization.

## Boundaries

- Read supplied version-1 handoffs only. Never edit files, Git state, issues,
  pull requests, reviews, comments, checks, or discussions.
- Do not automatically invoke `load-pr-discussions`, `inspect-pr-checks`, or
  another Skill. Missing producers are limitations and
  `recommended_next_skill` is advisory.
- Preserve exact pull-request identity and every supplied source status. Reject
  conflicting repositories, numbers, URLs, or head SHAs; never guess identity.
- Preserve source bodies and check summaries as retrieved, after removing
  secrets, credentials, private keys, `.env` values, and unnecessary log output.
- Do not infer that a comment is relevant, a thread is resolved, or a point is
  addressed from wording, timestamps, comment order, a commit, or review state
  alone.
- Group only the same problem core with the same causal mechanism, relevant
  location, and correction. Keep different causes separate even when they share
  a symptom, file, author, or category.
- Do not publish comments or reviews, request changes, approve, merge, rerun
  checks, resolve threads, dismiss reviews, or authorize code changes.

## Inputs

Accept either:

```yaml
repository: owner/repository
number: 123
```

or one GitHub pull-request URL. Accept these optional version-1 handoffs when
provided:

- `LoadedPullRequestDiscussions` for reviews, inline threads, replies, and
  conversation comments.
- `ClassifiedReviewFindings` for evidence-backed and classified
  `REQUEST_CHANGES` findings.
- `PullRequestCheckInspection` for check results and explicitly retrieved
  required checks.

Validate every supplied handoff. The repository, positive pull-request number,
canonical URL, and non-null head SHA must agree. A missing identity returns
`blocked` with `failure.code: missing_identity`; a malformed or conflicting
source returns `blocked` without selecting a preferred identity.

## Workflow

1. Establish one exact pull-request identity and copy the source statuses,
   unavailable fields, head SHA, and retrieval evidence into `sources`.
2. Convert discussion threads into feedback items:
   - Include open, non-outdated threads as `open`.
   - Include resolved threads as `resolved`, and outdated threads as `outdated`,
     using the retrieved booleans as authoritative.
   - Mark a point `addressed` only when explicit supplied evidence says the
     author implemented or verified the requested correction. Keep it
     `open` or `resolved` when that evidence is absent or ambiguous.
3. Include `CHANGES_REQUESTED` review findings from
   `ClassifiedReviewFindings`, preserving finding severity, location, evidence,
   recommendation, and thread references. Map their actionable state to the
   strongest evidence-backed status; do not treat a review state by itself as
   proof that its finding was addressed.
4. Include relevant top-level review bodies and pull-request conversation
   comments only when they contain actionable feedback, an explicit request,
   or evidence that a listed point was addressed. Preserve their source
   reference and exact body. Do not manufacture a thread ID.
5. Include failed and missing required checks from
   `PullRequestCheckInspection`. Keep check feedback separate from review
   feedback, preserve `fail` or `missing`, the exact check identity, head SHA,
   and sanitized failure summary, and never turn pending, skipped, unavailable,
   or unknown states into failures.
6. Group items only when their problem core, causal mechanism, affected
   location or check, and expected correction are equivalent. Preserve all
   member references and evidence. Record uncertain matches as separate groups
   with an uncertainty instead of merging them.
7. Build summary counts by status, source kind, and group kind. Return
   `partial` when a requested source is absent, blocked, or incomplete; return
   `collected` only when every requested source is complete. A missing optional
   source is `not_supplied`, never an empty successful source.
8. Return exactly one `CollectedReviewFeedback` object. Add a short
   conversational summary after the English structured handoff without
   replacing it.

## Evidence rules

Every group and item must include a reproducible source reference, observed
feedback or check behavior, impact or requested correction, and confidence.
Use the smallest verified location for inline findings. For PR-level comments
or checks with no file location, use `pull-request/<number>` with null lines
and `side: unknown`. Keep hypotheses and missing context in `uncertainties`;
never promote them to actionable feedback.

## Output guidance

Return the contract's `status`, exact pull-request identity, source availability,
grouped feedback, uncertainties, summary, retrieval metadata, unavailable
fields, and structured failure. `REQUEST_CHANGES` feedback remains evidence for
follow-up only and never grants approval to submit a review or change code.
