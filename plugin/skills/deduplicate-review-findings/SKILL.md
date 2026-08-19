---
name: deduplicate-review-findings
description: Deduplicate proposed pull-request review findings against one another and retrieved pull-request discussion threads, preserve distinct causal problems, and return an auditable cleaned finding list. Use automatically after finding detection when duplicate, already-discussed, or already-addressed review feedback must be identified without publishing a review or changing GitHub.
---

# Deduplicate Pull-Request Review Findings

Compare one version-1
[`DetectedReviewFindings`](../../shared/schemas/DetectedReviewFindings.yaml)
handoff with the supplied version-1
[`LoadedPullRequestDiscussions`](../../shared/schemas/LoadedPullRequestDiscussions.yaml)
snapshot. Return one version-1
[`DeduplicatedReviewFindings`](../../shared/schemas/DeduplicatedReviewFindings.yaml)
handoff containing active survivor findings, auditable suppressed entries, and
structured references to existing discussion threads.

This Skill is a read-only normalization step between finding detection and
classification. It does not decide whether a review should be published.

## Boundaries

- Read only supplied version-1 handoffs and bounded identity evidence. Never
  edit files, Git state, branches, worktrees, issues, pull requests, checks,
  reviews, comments, or discussions.
- Never publish a comment or review, request changes, approve or merge a pull
  request, mark a draft ready, resolve or unresolve a thread, dismiss a
  review, or create a `ReviewDecision`.
- Do not automatically invoke `detect-review-findings`,
  `load-pr-discussions`, `classify-review-findings`, or another Skill.
  `recommended_next_skill` is advisory only.
- Preserve the exact repository, pull-request number, canonical URL, and head
  SHA from the valid source handoff. Do not infer identity from the current
  checkout, branch, title, wording, or most recently viewed pull request.
- Never merge findings only because they share a category, severity, author,
  wording, symptom, or nearby line. Distinct causal mechanisms remain
  separate.
- Never suppress a finding without recording its original ID, disposition,
  rationale, evidence, and relevant discussion references in `suppressed`.
- Keep every active and suppressed finding `status: proposed`. Deduplication
  does not authorize a `ReviewDecision`, publication, dismissal, or merge.
- Redact tokens, credentials, private keys, `.env` values, personal data, and
  unnecessary command or log output. Keep authored handoff text in English;
  conversational explanations may follow the user's language.

## Input contract

Accept one required version-1 `DetectedReviewFindings` handoff. Its status must
be `detected` or `partial`, and its findings must be usable. A blocked,
unsupported, malformed, or missing source cannot be deduplicated reliably.

Accept one optional version-1 `LoadedPullRequestDiscussions` handoff. It must
identify the same repository, pull request, and canonical URL when those
values are available. A `loaded` snapshot enables complete discussion
matching. A `partial` snapshot may be used for the fields it retrieved, but
the result must be `partial` and list its missing fields. A blocked or absent
snapshot cannot be treated as an empty discussion history.

An optional version-1 `LoadedPullRequest` may corroborate repository,
pull-request number, URL, and head-SHA identity. It is identity evidence only;
do not use it to fetch additional findings or discussions.

Validate every supplied handoff:

1. Accept only contract version `1`.
2. Require repository, pull-request number, and URL when available to agree.
3. Require every supplied non-null head SHA to match the detection source.
4. Reject conflicting identity or malformed findings; never choose one source
   by preference.
5. Preserve source status, unavailable fields, and limitations in `source`,
   `discussions`, and `uncertainties`.

If the discussion snapshot is absent, deduplicate findings against one
another, set `discussions.availability: not_supplied`, return `partial`, and
recommend `load-pr-discussions`. Do not claim that existing feedback was
checked.

## Evidence and match certainty

Use concise, reproducible references:

- `handoff:DetectedReviewFindings.findings[F-001]`
- `handoff:DetectedReviewFindings.uncertainties[U-001]`
- `handoff:LoadedPullRequestDiscussions.threads[<id>]`
- `handoff:LoadedPullRequestDiscussions.threads[<id>].comments[<id>]`
- `handoff:LoadedPullRequestDiscussions.reviews[<index>]`
- `handoff:LoadedPullRequestDiscussions.conversation_comments[<index>]`
- `discussion:<thread-id>`
- `diff:<path>:<line-range>` or `check:<name>`

Determine a problem core from the observed behavior or gap, causal mechanism,
affected contract or requirement, material impact, and smallest verified
location. Compare those facts, not wording, author, timestamps, severity, or
the number of repeated sources.

Use these match outcomes:

- `same_problem`: the findings describe the same observed failure or
  requirement gap, caused by the same mechanism, at the same or equivalent
  relevant location.
- `different_cause`: the findings may share a symptom, category, or location,
  but the observed mechanisms, conditions, or required fixes differ. Keep
  them separate.
- `related_context`: a thread or finding concerns nearby behavior but does not
  establish the same problem core. Keep the active finding and record a
  `related` thread reference when a thread ID exists.
- `uncertain_match`: available evidence is insufficient to decide. Keep the
  finding active, record an uncertainty, and do not merge or suppress it.

When two findings have the same problem core, retain the first stable
survivor ID and absorb later entries. Union material sources, evidence
references, and references. Retain the highest severity supported by observed
impact; repeated wording or people do not increase severity. Increase
confidence only when independent sources corroborate the same observed
problem.

## Discussion matching

Inspect each retrieved review thread's exact comments, location, `is_resolved`,
and `is_outdated` values. Match discussion content to the problem core, not
just to a keyword or file path.

- `already_discussed`: an open, non-outdated thread contains concrete feedback
  about the same problem core. Suppress the new duplicate and preserve
  `discussion:<thread-id>` in the suppressed entry and top-level
  `related_threads`.
- `already_addressed`: a resolved or outdated thread, or explicit addressing
  evidence in its comments, covers the same problem core. Suppress the new
  duplicate only when the thread state and content establish that it is the
  same addressed problem.
- `related`: the thread is relevant context but has a different cause,
  narrower or broader scope, or an unverified relationship. Keep the active
  finding and attach the thread reference to it.
- `duplicate`: the thread appears to repeat the same finding but its
  resolution or outdated state is unavailable. Keep the finding active,
  record the duplicate thread reference, and add a limitation rather than
  claiming that it was discussed or addressed.

A resolved or outdated thread never suppresses a separate finding with a
different causal mechanism merely because its symptom or location is similar.
Do not infer resolution from the latest comment, comment order, timestamps, or
review state alone. If thread state or pagination is unavailable, preserve the
limitation and avoid a confirmed suppression.

Top-level review bodies and conversation comments may provide evidence, but
do not invent a thread ID for a comment that is not part of a retrieved
thread. Preserve its handoff reference in the finding or suppression
evidence.

## Workflow

### 1. Validate source identity and initialize output

Resolve one repository, pull-request number, URL, and head SHA from
`DetectedReviewFindings`, corroborating only with supplied identity handoffs.
Copy the source contract, version, status, finding count, uncertainty count,
processed count, and evidence into `source`.

Initialize `discussions` from the supplied discussion handoff. Use:

- `loaded` when all requested discussion data was retrieved;
- `partial` when useful threads or comments exist but fields or pages are
  unavailable;
- `blocked` when the discussion load failed after identity resolution;
- `unavailable` when discussion evidence was requested but unusable;
- `not_supplied` when no discussion handoff was provided.

### 2. Normalize and compare new findings

Read each source finding exactly once in input order. Verify its required
finding shape and preserve its evidence, location, impact, recommendation,
verification, category, severity, confidence, sources, acceptance criterion,
and references.

Compare each finding with existing survivors:

1. Merge only a `same_problem` match at an equivalent relevant location.
2. Keep `different_cause`, `related_context`, and `uncertain_match` entries
   separate.
3. For a merge, keep the survivor's ID, add the absorbed ID to
   `merged_from`, union sources and references, combine material evidence
   concisely, and retain the strongest verified location and verification.
4. Add every absorbed finding to `suppressed` with
   `disposition: merged_into`, `merged_into: <survivor-id>`, and an
   evidence-backed rationale.
5. Do not merge two findings merely because one recommendation could fix both.
   If the causes or verification steps differ, preserve separate findings.

The active `findings` list contains only survivors. A survivor with no absorbed
entry has `merged_from: []`.

### 3. Compare survivors with discussion threads

For each active survivor, compare the problem core with every retrieved
thread and its comments. Preserve exact thread identity, state, location,
URL, comment IDs, and evidence in one top-level `related_threads` entry.

When a thread suppresses a survivor:

1. Add a `disposition` of `already_discussed` or `already_addressed` to
   `suppressed`.
2. Copy the survivor's finding data into that suppressed record.
3. Include the `discussion:<thread-id>` reference and the exact handoff
   evidence.
4. Remove the survivor from active `findings` only after the same problem core
   and suppressing state are established.

When a thread is merely related or its state is unavailable, keep the
survivor active and add `discussion:<thread-id>` to its `related_threads`.
Never remove the finding to hide uncertainty.

### 4. Preserve uncertainties and set result state

Carry input uncertainties forward unchanged except for formatting required by
the output contract. Add an uncertainty when discussion coverage, thread
state, pagination, or semantic matching cannot establish whether a problem
was discussed or addressed.

Return:

- `deduplicated` when the source is valid and discussion coverage is complete,
  including a retrieved empty thread list.
- `partial` when findings were cleaned but the source or discussion evidence
  is partial, blocked, unavailable, absent, or materially incomplete.
- `blocked` when identity conflicts, the source is missing/blocked/invalid,
  or no reliable finding list can be constructed.

Use at most one advisory `recommended_next_skill`:

- `load-pr-discussions` when discussion evidence is absent or incomplete;
- `detect-review-findings` when the required detection handoff is absent or
  unusable;
- `classify-review-findings` when deduplication completed;
- `none` only when no follow-up evidence load is justified.

## Output contract

First give a concise summary in the conversation language. Then return
exactly one English version-1 `DeduplicatedReviewFindings` handoff:

```yaml
schema: DeduplicatedReviewFindings
version: 1
status: deduplicated
repository: octo-org/widgets
pull_request:
  number: 42
  url: https://github.com/octo-org/widgets/pull/42
head_sha: 2222222222222222222222222222222222222222
source:
  schema: DetectedReviewFindings
  version: 1
  status: detected
  finding_count: 3
  uncertainty_count: 0
  findings_processed: 3
  evidence:
    - "handoff:DetectedReviewFindings"
  unavailable_fields: []
  limitation: null
discussions:
  schema: LoadedPullRequestDiscussions
  version: 1
  availability: loaded
  thread_count: 2
  evidence:
    - "handoff:LoadedPullRequestDiscussions.threads[PRRT_kwDO123]"
  unavailable_fields: []
  limitation: null
findings:
  - id: F-001
    status: proposed
    category: correctness
    severity: major
    confidence: high
    location:
      path: src/loader.ts
      start_line: 48
      end_line: 49
      side: RIGHT
      commit_sha: 2222222222222222222222222222222222222222
    evidence: "The empty response bypasses the error callback; sources: handoff:DetectedReviewFindings.findings[F-001], handoff:DetectedReviewFindings.findings[F-003]."
    impact: "Empty responses are reported as successful and downstream state remains stale."
    recommendation: "Route an empty response through the existing error or state-reset path."
    verification: "Add a regression test for an empty response and verify the callback and state transition."
    sources:
      - diff_analysis
    related_acceptance_criterion: null
    references:
      - "diff:src/loader.ts:48-49"
    merged_from:
      - F-003
    related_threads: []
suppressed:
  - id: F-002
    disposition: already_discussed
    merged_into: null
    status: proposed
    category: correctness
    severity: major
    confidence: high
    location:
      path: src/loader.ts
      start_line: 48
      end_line: 49
      side: RIGHT
      commit_sha: 2222222222222222222222222222222222222222
    evidence: "The same empty-response callback gap is already described in the open thread; source: handoff:LoadedPullRequestDiscussions.threads[PRRT_kwDO123]."
    impact: "Empty responses can leave downstream state stale."
    recommendation: "Address the callback path in the existing discussion."
    verification: "Confirm the thread's requested change is implemented and covered by a regression test."
    sources:
      - discussions
    related_acceptance_criterion: null
    references:
      - "discussion:PRRT_kwDO123"
    rationale: "The open, non-outdated thread describes the same observed callback gap at the same changed location."
    related_threads:
      - "discussion:PRRT_kwDO123"
related_threads:
  - thread_id: PRRT_kwDO123
    relationship: discussed
    is_resolved: false
    is_outdated: false
    location:
      path: src/loader.ts
      start_line: 48
      end_line: 49
      side: RIGHT
    thread_url: https://github.com/octo-org/widgets/pull/42#discussion_r123
    comment_ids:
      - PRRC_kwDO456
    evidence:
      - "handoff:LoadedPullRequestDiscussions.threads[PRRT_kwDO123]"
uncertainties: []
summary: "Three proposed findings were compared. One duplicate was merged and one finding was already covered by an open discussion; one active survivor remains."
recommended_next_skill: classify-review-findings
failure: null
deduplicated_at: "2026-08-10T07:00:00Z"
```

For `partial` or `blocked`, preserve known identity, source evidence,
survivors, suppressed entries, and uncertainties. Set `failure` to the schema
failure object and do not claim complete discussion coverage.

## Failure handling

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No `DetectedReviewFindings` handoff was supplied. | `blocked`; preserve known identity only and recommend `detect-review-findings`. |
| `invalid_input` | A required field, identity, finding, or discussion shape is malformed. | `blocked` or `partial`; never fabricate or silently drop the affected entry. |
| `unsupported_version` | A supplied handoff is not version 1. | `blocked`; request a compatible handoff. |
| `blocked_source` | The detection handoff is blocked or cannot provide usable findings. | `blocked`; preserve source failure evidence. |
| `source_conflict` | Supplied identity evidence disagrees on repository, pull-request number, URL, or head SHA. | `blocked`; do not select an identity by preference. |
| `discussion_unavailable` | Discussion data was requested but cannot be used for matching. | `partial` when findings remain reliable; otherwise `blocked`; recommend `load-pr-discussions`. |
| `incomplete_source` | Usable findings remain but source fields, pages, or discussion state limit coverage. | `partial`; preserve active findings and add explicit limitations or uncertainties. |
| `deduplication_failure` | An unexpected failure prevents reliable comparison or survivor construction. | `partial` when verified results remain; otherwise `blocked`. |
