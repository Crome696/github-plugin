---
name: classify-review-findings
description: Reclassifies one supplied DeduplicatedReviewFindings handoff by evidence-supported severity and domain category, preserves every active finding and its thread references, marks uncertain findings for discussion, and never removes or publishes findings. Use automatically when cleaned pull-request review findings need impact-first classification or severity and category normalization.
---

# Classify Pull-Request Review Findings

Classify exactly one version-1
[`DeduplicatedReviewFindings`](../../shared/schemas/DeduplicatedReviewFindings.yaml)
handoff into a version-1
[`ClassifiedReviewFindings`](../../shared/schemas/ClassifiedReviewFindings.yaml)
handoff. Reassess each finding from its observed impact and evidence. This
Skill is a read-only classification step after finding deduplication and before any
later human discussion or review-publication workflow.

## Boundaries

- Read only the supplied handoffs and bounded identity evidence. Never edit
  files, Git state, branches, worktrees, issues, pull requests, checks,
  reviews, comments, or discussions.
- Never remove, filter, merge, deduplicate, dismiss, resolve, or publish a
  finding. Preserve every input finding in its original order and preserve its
  original ID.
- Never publish a comment or review, request changes, approve or merge a pull
  request, mark a draft ready, or create a `ReviewDecision`.
- Do not automatically invoke `deduplicate-review-findings`,
  `detect-review-findings`, `analyze-pr-diff`, `load-pull-request`, or another
  Skill. A `recommended_next_skill` value is advisory only.
- Do not infer repository, pull-request, head-SHA, impact, category, or
  reviewer intent from the current checkout, branch, title, wording,
  timestamps, or the number of sources.
- Keep source facts, classifications, and discussion flags distinct. A
  discussion flag does not prove that the finding is a defect.
- Do not expose tokens, credentials, private keys, `.env` values, personal
  data, or unnecessary command or log output.
- Keep the handoff and authored artifact text in English; conversational
  explanations may follow the user's language.

## Input contract

Accept one required version-1 `DeduplicatedReviewFindings` handoff. Its status
must be `deduplicated` or `partial` and its active findings must be usable. A
blocked,
unsupported, malformed, or missing source cannot be classified reliably.

An optional version-1 `LoadedPullRequest` may corroborate repository, pull
request number, URL, and head-SHA identity. It is identity evidence only; do
not use it to fetch more review findings or introduce findings absent from the
required source.

Validate the source before classifying:

1. Accept only contract version `1`.
2. Require the source repository, pull-request number, URL when available, and
   non-null head SHA to match any corroborating handoff.
3. Preserve a null head SHA when the source legitimately lacks it; never
   manufacture one from a branch or commit message.
4. Require every active finding to contain the source contract's required ID,
   category, severity, confidence, location, evidence, impact,
  recommendation, verification, source, merge, and thread-reference fields.
5. Preserve `merged_from` and `related_threads` exactly; do not re-deduplicate
  the active list. Suppressed source entries remain audit data in the source
  handoff and are not silently promoted to active findings.
6. If a required field is malformed or identity conflicts, return `blocked`
   or `partial` evidence rather than fabricating a replacement classification.

## Classification categories

Assign one primary category from the existing review vocabulary:

- `correctness`: observed incorrect behavior, state, output, error handling,
  or contract violation.
- `architecture`: an evidence-backed boundary, dependency, abstraction, or
  integration problem.
- `security`: an evidence-backed confidentiality, integrity, authorization,
  authentication, or vulnerability problem.
- `performance`: an evidence-backed latency, resource, throughput, or
  scalability problem.
- `maintainability`: an actionable change-risk or extensibility problem that
  is not better described by another category.
- `tests`: a concrete verification or regression-coverage gap tied to changed
  behavior or an explicit required check.
- `documentation`: a missing or incorrect public contract, user-visible
  behavior, configuration, migration, or operational instruction supported by
  repository or task evidence.
- `scope`: a change outside explicit pull-request or task scope supported by
  scope evidence.

Choose the category of the observed problem, not the category suggested by
the reviewer's wording. Do not use a category as a severity shortcut. If the
source category remains the best evidence-supported category, keep it.

## Severity rules

Severity is determined by real consequence and evidence, never by emphasis,
imperative language, labels, author seniority, or repeated wording:

- `blocker`: the change cannot safely be accepted or the required acceptance
  or verification cannot proceed as written.
- `major`: a material defect, security risk, compatibility problem, or
  evidence-backed missing required verification affects the changed behavior.
- `minor`: a non-blocking but actionable defect or maintainability risk.
- `suggestion`: a small, evidence-backed improvement with no demonstrated
  behavioral impact.

Use the smallest severity supported by the observed impact. Do not escalate a
finding because its text says “must”, “critical”, or “blocking”. Do not
downgrade a demonstrable material impact because the wording is tentative.
Repeated sources may increase confidence, but they do not increase severity.

For an incoming `nit`, use `suggestion` in this contract and record
`previous_severity: nit` when that is the only severity change. Existing
`ReviewFinding`, `DetectedReviewFindings`, and `DeduplicatedReviewFindings`
contracts remain unchanged.

When the evidence does not establish material impact, retain the finding,
choose only the lowest classification defensible from the evidence, and set
`needs_discussion: true`. Explain that the severity is provisional; never
present an unsupported blocker or major impact as fact.

## Evidence and discussion flags

Every classification rationale must name the observed impact and the
evidence supporting both the category and severity. Use reproducible
references such as:

- `handoff:DeduplicatedReviewFindings.findings[F-001]`
- `handoff:DeduplicatedReviewFindings.uncertainties[U-001]`
- `diff:<path>:<line-range>`
- `check:<name>`
- `discussion:<thread-id>`
- `issue:<reference>`
- `capability:<name>`

Set `needs_discussion: true` when any of the following applies:

- the finding has low confidence or materially incomplete evidence;
- sources disagree about the observed behavior, impact, category, or scope;
- the location or affected behavior cannot be verified;
- the finding's impact is plausible but not established;
- the category or severity is provisional;
- the input has a repeated ID or another ambiguity that affects discussion.

When `needs_discussion` is true, provide a concise `discussion_reason` that
states what is uncertain and what evidence or decision would resolve it. A
discussion flag does not authorize dismissal, rewriting, removal, or
publication. A high-confidence finding may still need discussion when its
severity has a material consequence; a low-confidence finding must not be
silently presented as settled.

Keep input `uncertainties` as separate uncertainty records and carry them
forward unchanged unless the output contract requires a formatting-preserving
normalization. Do not turn an uncertain finding into an uncertainty or remove
it from `findings`.

## Workflow

### 1. Validate identity and source

Resolve exactly one supplied `DeduplicatedReviewFindings` handoff. Establish the
repository, pull-request number, URL, and head SHA from that source and
corroborate only with the optional `LoadedPullRequest`. Conflicting identity
blocks classification; do not select one source by preference.

Record the source contract, version, status, active finding count, suppressed
count, uncertainty count, and source evidence in `source`. The output's
`findings_preserved` must equal the number of active input findings. Preserve
the source's `merged_from` and `related_threads` metadata in every output
finding.

### 2. Preserve the finding list

Copy every active input finding exactly once and in the original order. Preserve its
ID, status, evidence, impact, recommendation, verification, location,
references, source list, related acceptance criterion, `merged_from`, and
`related_threads`. Do not deduplicate, filter, or resurrect suppressed source
entries.

Set `previous_severity` only when the source severity differs from the
classified severity. Map source `nit` to output `suggestion`. Set
`previous_category` only when the category changes. Explain each change in
`classification_rationale`.

### 3. Classify the domain category

Compare the finding's evidence and observed problem with the category
definitions. Select exactly one primary category. Preserve the source
category when no stronger evidence supports a change. If the source category
is valid but the evidence does not resolve the choice, preserve it and mark
the finding for discussion instead of inventing a new category.

### 4. Classify impact and severity

Read the concrete impact before reading the force of the recommendation or
summary. Determine whether acceptance or verification is prevented, whether
the changed behavior has a material defect or risk, whether the issue is
actionable but non-blocking, or whether it is only a non-behavioral
improvement. Select the corresponding severity from `blocker`, `major`,
`minor`, or `suggestion` and explain the decision with evidence.

Do not treat a failed check, missing test, style preference, or scope concern
as a blocker without the source evidence required by the original finding
contract. Do not manufacture missing impact from general engineering norms.

### 5. Mark uncertainty for discussion

Set the discussion fields using the evidence rules above. Keep the finding
in the output even when it is uncertain. Preserve all input uncertainty
records independently.

### 6. Verify preservation and return

Before returning the handoff, verify:

- input and output finding counts are equal;
- every input ID occurs in the output in the same order;
- no finding was merged, removed, dismissed, or published;
- every output category and severity is an allowed enum value;
- every classification has a non-empty rationale;
- every `needs_discussion: true` entry has a concrete reason;
- repository, pull-request identity, and head SHA remain unchanged;
- `failure` is null only for `classified`.

Use `classified` when the source is valid and every finding has an
evidence-backed classification. Use `partial` when usable findings remain but
the source or corroborating evidence has a material limitation. Use `blocked`
when identity, source version, required fields, or the source itself cannot
support reliable classification.

## Output contract

First give a concise summary in the conversation language. Then return
exactly one English version-1 `ClassifiedReviewFindings` handoff:

```yaml
schema: ClassifiedReviewFindings
version: 1
status: classified
repository: octo-org/widgets
pull_request:
  number: 42
  url: https://github.com/octo-org/widgets/pull/42
head_sha: 2222222222222222222222222222222222222222
source:
  schema: DeduplicatedReviewFindings
  version: 1
  status: deduplicated
  finding_count: 2
  uncertainty_count: 1
  suppressed_count: 1
  findings_preserved: 2
  evidence:
    - "handoff:DeduplicatedReviewFindings"
  unavailable_fields: []
  limitation: null
findings:
  - id: F-001
    status: proposed
    category: correctness
    severity: major
    confidence: high
    needs_discussion: false
    discussion_reason: null
    classification_rationale: "The observed stale-state behavior affects the required success path; the changed-line evidence supports major severity and correctness category."
    previous_severity: minor
    previous_category: null
    location:
      path: src/loader.ts
      start_line: 48
      end_line: 49
      side: RIGHT
      commit_sha: 2222222222222222222222222222222222222222
    evidence: "The empty response returns before the required error callback; source: handoff:DeduplicatedReviewFindings.findings[F-001]."
    impact: "Empty responses are reported as successful and downstream state remains stale."
    recommendation: "Route an empty response through the existing error or state-reset path."
    verification: "Add a regression test for an empty response and verify the callback and state transition."
    sources:
      - diff_analysis
    related_acceptance_criterion: null
    references:
      - "diff:src/loader.ts:48-49"
    merged_from: []
    related_threads: []
  - id: F-002
    status: proposed
    category: maintainability
    severity: suggestion
    confidence: low
    needs_discussion: true
    discussion_reason: "The proposed refactor may reduce duplication, but no repository-specific maintenance impact is established."
    classification_rationale: "Only a small non-behavioral improvement is evidenced; severity remains suggestion and requires discussion because its benefit is unverified."
    previous_severity: nit
    previous_category: null
    location:
      path: src/loader.ts
      start_line: 75
      end_line: 75
      side: RIGHT
      commit_sha: 2222222222222222222222222222222222222222
    evidence: "The source identifies repeated logic but supplies no demonstrated maintenance consequence; source: handoff:DeduplicatedReviewFindings.findings[F-002]."
    impact: "No behavioral impact is established."
    recommendation: "Discuss whether the duplication warrants a focused follow-up."
    verification: "Confirm the duplication and its maintenance cost against repository conventions."
    sources:
      - discussions
    related_acceptance_criterion: null
    references: []
    merged_from: []
    related_threads:
      - "discussion:PRRT_kwDO123"
uncertainties:
  - id: U-001
    category: tests
    statement: "The required integration environment was not available."
    evidence: "handoff:DeduplicatedReviewFindings.uncertainties[U-001]"
    limitation: "Runtime verification could not be performed."
    confidence: medium
    verification: "Run the integration suite in the required environment."
    location: null
    sources:
      - checks
summary: "Two findings were preserved and classified by impact and evidence; one low-confidence suggestion remains flagged for discussion."
recommended_next_skill: none
failure: null
classified_at: "2026-08-10T07:00:00Z"
```

## Failure handling

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No `DeduplicatedReviewFindings` handoff was supplied. | `blocked`; preserve known identity only and recommend `deduplicate-review-findings`. |
| `invalid_input` | A required field, identity, or finding shape is malformed. | `blocked`; do not fabricate or silently remove the affected finding. |
| `unsupported_version` | A supplied handoff is not version 1. | `blocked`; request a compatible handoff. |
| `blocked_source` | The supplied deduplication handoff is blocked or cannot support classification. | `blocked`; preserve source failure evidence. |
| `source_conflict` | Supplied identity evidence disagrees on repository, pull-request number, URL, or head SHA. | `blocked`; do not select one identity by preference. |
| `incomplete_source` | Usable findings remain but source limitations affect classification confidence or coverage. | `partial`; preserve all findings and mark affected entries for discussion. |
| `classification_failure` | An unexpected failure prevents reliable classification. | `partial` when verified classifications remain; otherwise `blocked`. |
