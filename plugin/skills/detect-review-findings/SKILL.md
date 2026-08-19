---
name: detect-review-findings
description: Consolidate supplied pull-request diff, issue-coverage, check, discussion, and applicable external-rule evidence into source-aggregated, evidence-backed proposed ReviewFinding objects. Use automatically when a pull-request review needs one read-only finding handoff before content-level deduplication; never publish comments or reviews, make merge decisions, or change GitHub or local files.
---

# Detect Pull-Request Review Findings

Consolidate exactly one pull request's supplied review evidence into a
version-1 [`DetectedReviewFindings`](../../shared/schemas/DetectedReviewFindings.yaml)
handoff. Combine diff analysis, explicit issue coverage, required-check
results, actionable discussions, and applicable host-provided rules without
turning uncertainty or style preference into a defect.

This Skill detects proposed findings and performs source-level aggregation. It
does not replace the later content-level deduplication step, write, or publish
a `ReviewDecision`.

## Boundaries

- Read supplied version-1 handoffs, bounded repository evidence, and
  host-exposed capabilities only. Never edit files, Git state, branches,
  issues, pull requests, checks, rulesets, reviews, comments, or discussions.
- Never publish a comment or review, request changes, approve or merge a pull
  request, mark a draft ready, rerun a check, resolve or unresolve a thread,
  dismiss a review, or invoke a publication workflow.
- Do not automatically invoke `analyze-pr-diff`, `inspect-pr-checks`,
  `load-pr-discussions`, `load-linked-issue`, or another Skill. A
  `recommended_next_skill` value is advisory only.
- Do not treat source aggregation as proof that a finding is not already
  covered by another finding or an existing pull-request discussion. That
  comparison belongs to `deduplicate-review-findings`.
- Preserve the exact repository, pull-request number, canonical URL, and head
  SHA. Do not infer identity from the current checkout, branch, issue text,
  commit message, or most recently viewed pull request.
- Keep source facts, findings, and uncertainties distinct. A hypothesis,
  missing source, unavailable capability, unresolved issue relationship, or
  pending check is not an evidence-backed finding.
- Create findings only for an observed material problem, an explicit issue
  requirement or acceptance gap, an exact required-check failure or absence,
  an actionable unresolved discussion, or an applicable external rule backed
  by project or path evidence. A style preference without project-specific
  evidence is never a finding.
- Keep every finding `status: proposed`. Findings do not authorize a
  `ReviewDecision`, a publication event, a merge, or any other side effect.
- Do not add `inline_comment` or replacement suggestions. Publication payloads
  belong to a separate authorization-gated workflow.
- Redact tokens, credentials, private keys, `.env` values, personal data, and
  unnecessary command or log output. Keep authored handoff text in English;
  conversational explanations may follow the user's language.

## Input contract

Accept one of these exact pull-request identity forms:

```yaml
repository: owner/repository
number: 123
```

or one GitHub pull-request URL from which the repository and positive number
can be parsed. An optional version-1 `LoadedPullRequest` may corroborate
identity and provide file or head-SHA evidence:

```yaml
loaded_pull_request:
  schema: LoadedPullRequest
  version: 1
  status: loaded | partial | blocked
```

Accept any supplied version-1 source handoffs below. Do not fetch a missing
source by invoking its producer:

- `PullRequestDiffAnalysis` for changed-line findings and diff uncertainties.
- `LinkedIssue` with a unique `loaded_issue`, or an explicitly associated
  `LoadedIssue`, for issue requirements and acceptance coverage. A direct
  `LoadedIssue` is usable only when the caller supplies evidence that it
  belongs to this pull request; never guess that relationship from title or
  text alone.
- `PullRequestCheckInspection` for status results and required checks.
- `LoadedPullRequestDiscussions` for reviews, threads, replies, and
  conversation comments.
- Host-exposed skills, rules, agents, tools, or domain capabilities that
  provide bounded external-rule evaluation for the verified changed paths.

At least one source must be usable. Represent all five source kinds in
`sources_evaluated`, including `not_supplied` when an optional handoff was not
provided. A blocked or partial supplied source is not silently treated as
empty evidence.

Validate every handoff before using it:

1. Accept only the declared contract version `1`.
2. Require the source's repository and pull-request number to match the
   requested identity.
3. Require every supplied non-null head SHA to match the verified pull-request
   head SHA.
4. Reject conflicting identity, malformed fields, or a blocked source that is
   presented as complete.
5. Preserve source status and unavailable fields in `sources_evaluated`.

Missing identity returns `blocked` with `failure.code: missing_identity`.
Conflicting or malformed identity returns `blocked`; never select one source
by preference or guess a replacement pull request.

## Evidence and certainty

Use concise, reproducible evidence references:

- `handoff:PullRequestDiffAnalysis.findings[F-001]`
- `handoff:PullRequestDiffAnalysis.uncertainties[U-001]`
- `handoff:LoadedIssue.body` or `handoff:LoadedIssue.comments[<index>]`
- `handoff:LinkedIssue.loaded_issue` and
  `handoff:LinkedIssue.evidence[<index>]`
- `handoff:PullRequestCheckInspection.required_checks[<index>]`
- `handoff:PullRequestCheckInspection.checks[<index>]`
- `handoff:LoadedPullRequestDiscussions.threads[<id>]`
- `handoff:LoadedPullRequestDiscussions.reviews[<index>]`
- `handoff:LoadedPullRequestDiscussions.conversation_comments[<index>]`
- `capability:<name>` for a host capability and its supplied result
- `diff:<path>:<line-range>` or `check:<name>` when the source provides it

An evidence-backed finding identifies the observed behavior or material gap,
its source, and its relevant location. An uncertainty identifies what is
known, what is missing, why the conclusion cannot be established, and how to
verify it. Do not promote an uncertainty to a finding merely to fill a
category.

For file-bound findings, use the smallest repository-relative changed hunk.
Use `side: RIGHT` for added or modified behavior and `side: LEFT` for deleted
behavior. For a check, discussion, or other PR-level finding with no verified
file location, use `pull-request/<number>` as the location path, leave line
values null, set `side: unknown`, and state in `evidence` that the source is
not file-bound. Do not invent a workflow path or line number.

## External capability and rule use

Inspect capabilities already exposed by the current host session before
evaluating external rules. Apply only a capability that:

1. Is available in the current session.
2. Is relevant to the verified changed paths or explicit review scope.
3. Produces bounded evidence rather than an unsupported preference.

Record every considered capability in `capabilities_applied`, including its
exact name and type, availability, whether it was applied, its bounded usage,
and evidence for relevance. An unavailable capability is a limitation, not a
defect. Do not install, authenticate, configure, or invent a capability, and
do not reference artifacts from another plugin.

## Workflow

### 1. Validate identity and initialize source coverage

Validate the identity, optional `LoadedPullRequest`, and every supplied
handoff. Establish one repository, pull-request number, canonical URL, and
head SHA. If a head SHA is unavailable from all trusted sources, preserve it
as null and record the limitation; do not manufacture one from a branch or
commit message.

Create one `sources_evaluated` entry for each of:

1. `diff_analysis`
2. `issue_coverage`
3. `checks`
4. `discussions`
5. `external_rules`

Use:

- `loaded` when the supplied source was retrieved and complete.
- `partial` when useful evidence exists but fields or pages are unavailable.
- `blocked` when a supplied source failed its primary load.
- `unavailable` when the source was requested but could not be used.
- `not_supplied` when no source was provided and no retrieval was requested.

List evidence and unavailable fields for every entry. A source's
`finding_count` counts only findings that survive deduplication.

### 2. Transfer and assess diff evidence

When `PullRequestDiffAnalysis` is supplied and valid:

- Carry forward only its `proposed` findings with their category, severity,
  confidence, location, evidence, impact, recommendation, verification, and
  references.
- Add `diff_analysis` to each carried finding's `sources`.
- Keep its uncertainties as uncertainties; do not reinterpret them as
  findings.
- Preserve the diff analysis's changed-line anchors and head-SHA evidence.

Do not invent a diff finding when the source is absent, blocked, or uncertain.
If a diff finding is materially qualified by issue, check, discussion, or
rule evidence, merge that evidence later rather than overwriting the original
source fact.

### 3. Evaluate issue coverage

Use only explicit requirements, acceptance criteria, expected behavior, or
non-goals present in the supplied issue evidence. Compare them with the
supplied diff findings, changed files, changed behavior, and verification
evidence.

- Create an issue-coverage finding only when an explicit requirement or
  acceptance criterion is demonstrably unmet, contradicted, or left without
  the required changed behavior or verification.
- Set `related_acceptance_criterion` to the exact requirement reference when
  available.
- Use `scope`, `correctness`, `tests`, or `documentation` only when the
  evidence supports that category.
- Do not infer a requirement from an issue title, label, milestone, branch
  name, conventional feature expectation, or a missing issue field.
- If the issue is ambiguous, not linked, partial, or missing explicit
  criteria, record an issue-coverage uncertainty instead of a finding.

An issue relationship is evidence, not authorization to alter the issue or
pull request.

### 4. Evaluate checks

Use only `PullRequestCheckInspection.required_checks` populated from retrieved
branch-protection or applicable-ruleset evidence. For each exact matching
check:

- Create a finding for `result: fail` when the required check failed.
- Create a finding for `result: missing` only when the inspection explicitly
  identifies the required check as missing for this head SHA.
- Do not create a failure finding for `pending` or `skipped` alone. Preserve a
  material pending or skipped state as an uncertainty when its consequence
  cannot yet be established.
- Never infer required status from workflow names, repository conventions,
  check frequency, pull-request text, or branch names.
- Use `major` by default for an evidence-backed required-check failure or
  absence; use `blocker` only when the retrieved source explicitly establishes
  that acceptance or verification cannot proceed.

Use the check's verified workflow or file location when one is supplied.
Otherwise use the PR-level location convention described above and explain
the non-file anchor.

### 5. Evaluate discussions

Use exact review, thread, reply, and conversation evidence to identify
actionable feedback:

- A thread can produce a finding only when it is explicitly unresolved,
  non-outdated, and contains a concrete defect, required change, or
  verification gap.
- A `CHANGES_REQUESTED` review without actionable supporting text is not
  itself a finding.
- Preserve the thread location when available. Use the PR-level location
  only when no file location was retrieved.
- Resolved or outdated threads do not create active findings. They may
  identify an already-addressed duplicate or qualify an existing diff
  finding; do not dismiss a separate evidence-backed defect solely because a
  related thread is resolved.
- Do not infer agreement, resolution, severity, or author intent from the
  latest comment, timestamps, or body wording.

If discussion pagination or resolution data is unavailable, record the
limitation as an uncertainty and do not report the affected feedback as
confirmed.

### 6. Apply external rules

Apply only relevant host-provided rule evaluations with evidence tied to the
verified repository, changed path, contract, or explicit project policy.
Create a finding only when the rule identifies a material, actionable problem
and its application is supported by that evidence.

Do not report formatting, naming, architectural, testing, or documentation
preferences as findings when they are not established by repository
instructions, project documentation, an explicit contract, or an applicable
host capability with concrete evidence. Record unsupported or unavailable
rule evaluations as uncertainties or source limitations.

### 7. Aggregate source-equivalent candidates, rank, and verify findings

Merge source-equivalent candidate findings when they describe the same problem
core at the same or equivalent relevant location. This is a bounded
source-aggregation step; `deduplicate-review-findings` performs the later
content-level comparison against all findings and existing discussion threads.
During this aggregation:

1. Keep one stable `F-001`-style ID and `status: proposed`.
2. Union the contributing `sources` and references.
3. Preserve all material evidence in one concise evidence field.
4. Retain the highest severity supported by observed impact; do not escalate
   because multiple people or sources repeat a preference.
5. Raise confidence only when independent sources corroborate the same
   observed problem; otherwise keep the strongest source's confidence.
6. Keep the smallest verified location and a concrete verification step.

Every final finding must include `category`, `severity`, `location`, evidence,
impact, recommendation, and `confidence`, plus `status`, `verification`, and
its contributing `sources`. A finding with no concrete location or source
must be converted to an uncertainty, not emitted with a guessed anchor.

### 8. Set status and recommendation

Return:

- `detected` when identity is valid, at least one source is usable, all five
  source kinds are represented, host capabilities were checked, and no
  supplied source has a material unresolved failure.
- `partial` when reliable findings exist but a supplied source is partial,
  unavailable, blocked, or missing material fields.
- `blocked` when identity is missing or conflicting, all supplied sources are
  unusable, no source was supplied, or aggregation cannot produce reliable
  results.

Use at most one advisory `recommended_next_skill`:

- `deduplicate-review-findings` when source aggregation completed and the
  resulting findings need content-level and discussion-thread comparison.
- `analyze-pr-diff` when diff evidence is missing or incomplete.
- `inspect-pr-checks` when required-check evidence is missing or incomplete.
- `load-pr-discussions` when discussion evidence is missing or incomplete.
- `load-linked-issue` when issue linkage is missing, ambiguous, or unresolved.
- `none` when no downstream evidence load is justified.

## Output contract

First give a concise summary in the conversation language. Then return
exactly one English version-1 `DetectedReviewFindings` handoff:

```yaml
schema: DetectedReviewFindings
version: 1
status: detected
repository: octo-org/widgets
pull_request:
  number: 42
  url: https://github.com/octo-org/widgets/pull/42
head_sha: 2222222222222222222222222222222222222222
sources_evaluated:
  - kind: diff_analysis
    input: PullRequestDiffAnalysis
    availability: loaded
    evidence:
      - "handoff:PullRequestDiffAnalysis.findings[F-001]"
    unavailable_fields: []
    limitation: null
    finding_count: 1
  - kind: issue_coverage
    input: LinkedIssue.loaded_issue
    availability: loaded
    evidence:
      - "handoff:LinkedIssue.loaded_issue.body"
    unavailable_fields: []
    limitation: null
    finding_count: 0
  - kind: checks
    input: PullRequestCheckInspection
    availability: loaded
    evidence:
      - "handoff:PullRequestCheckInspection.required_checks[0]"
      - "handoff:PullRequestCheckInspection.checks[0]"
    unavailable_fields: []
    limitation: null
    finding_count: 0
  - kind: discussions
    input: LoadedPullRequestDiscussions
    availability: not_supplied
    evidence:
      - "No discussion handoff was supplied."
    unavailable_fields:
      - discussions
    limitation: "Existing review feedback could not be checked for duplicates."
    finding_count: 0
  - kind: external_rules
    input: null
    availability: loaded
    evidence:
      - "Host capabilities were checked; no additional applicable rule was used."
    unavailable_fields: []
    limitation: null
    finding_count: 0
capabilities_applied: []
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
    evidence: "The diff returns before the required error callback for an empty response; source: handoff:PullRequestDiffAnalysis.findings[F-001]."
    impact: "Empty responses are reported as successful and downstream state remains stale."
    recommendation: "Handle the empty response through the same error or state-reset path as other invalid responses."
    verification: "Add a regression test for an empty response and verify the callback and state transition."
    sources:
      - diff_analysis
    related_acceptance_criterion: null
    references:
      - "diff:src/loader.ts:48-49"
uncertainties: []
summary: "Diff, issue, and required-check evidence were evaluated. One correctness finding is proposed; discussion evidence was not supplied."
recommended_next_skill: deduplicate-review-findings
failure: null
detected_at: "2026-08-10T07:00:00Z"
```

Use `failure: null` only for `detected`. For `partial` or `blocked`, include
the schema failure object and preserve known identity, source evidence,
findings, and uncertainties without claiming complete coverage.

## Failure handling

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository or pull-request number is absent. | Ask one identity question or return `blocked`; do not guess. |
| `invalid_input` | A URL, source handoff, field, or relationship has an invalid shape. | `blocked`; preserve no guessed identity or relationship. |
| `unsupported_version` | A supplied handoff is not version 1. | `blocked`; request a compatible handoff. |
| `source_unavailable` | A requested source cannot be read or used. | `partial` when another source remains reliable; otherwise `blocked`. |
| `source_conflict` | Supplied sources disagree on repository, pull-request number, or head SHA. | `blocked`; do not merge conflicting evidence. |
| `no_usable_source` | No source was supplied or all supplied sources are blocked or empty. | `blocked`; return no fabricated findings. |
| `incomplete_source` | A supplied source has useful evidence but missing fields, pages, or capabilities may affect coverage. | `partial`; list the limitation as a source entry and uncertainty. |
| `aggregation_failure` | An unexpected failure prevents reliable deduplication or finding construction. | `partial` if verified findings remain; otherwise `blocked`. |
