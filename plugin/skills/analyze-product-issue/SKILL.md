---
name: analyze-product-issue
description: Analyze one loaded parent GitHub issue from a product perspective and return a version-1 ProductAssessment covering problem, desired outcome, actors, use cases, functional requirements, business rules, constraints, acceptance criteria, dependencies, priorities, and open questions, while detecting mixed features, implicit requirements, and unclear product decisions. Use automatically when a user asks to analyze a parent issue from a product view, prepare a product assessment, or extract interview-ready product topics from a LoadedIssue snapshot; do not use for implementation-readiness analysis (analyze-issue), numeric quality scoring (assess-issue-quality), requirements interviews (conduct-product-interview, structure-issue, or rewrite-github-issue), capability mapping (identify-product-capabilities), atomic decomposition (decompose-product-capabilities), atomicity classification (assess-issue-atomicity), dependency graphing (build-product-dependency-graph), product prioritization (prioritize-product-issues), sub-issue creation, or publication.
---

# Analyze Parent Issues From a Product Perspective

Analyze a parent issue from a product perspective. Extract problem, desired
outcome, users/actors, use cases, functional requirements, business rules,
constraints, acceptance criteria, dependencies, priorities, and open
questions. Detect mixed features, implicit requirements, and unclear product
decisions. Separate evidenced information from assumptions. Do not create
sub-issues. The output is a structured Product Assessment as the basis for
the subsequent interview.

Analyze exactly one version-1 `LoadedIssue` as an evidence-backed, read-only
product diagnostic. Return the version-1 `ProductAssessment` handoff. Do not
rewrite the issue, interview the user, or create GitHub issues.

`issue-agent` mode `refine` uses this assessment so
`conduct-product-interview` can skip evidenced product topics and focus on
mixed features, implicit requirements, and unclear decisions.

## Boundaries

- Keep questions and explanations in the user's conversation language.
- Keep the structured handoff and all newly authored report text in English.
  Preserve short exact source excerpts when they are needed as evidence.
- Require a `LoadedIssue` handoff. Do not silently load or re-fetch an issue,
  infer its identity from the workspace, or invoke `load-github-issue`
  automatically.
- Read GitHub and repository files only when explicitly available or when the
  thin repository context is needed to interpret the snapshot. Do not edit
  GitHub, repository files, labels, comments, issue state, or pull requests.
- Do not create, propose as a write, split, or publish sub-issues. Record
  mixed features as diagnosis only. Slice selection belongs to
  `conduct-product-interview`, not this analysis.
- Do not turn the analysis into a requirements interview. Ask at most one
  concise question only when the required handoff or its identity is missing.
  Document remaining product gaps in `open_questions`, `unclear_decisions`,
  and `interview_focus` instead of asking them here.
- Base every item on available evidence. Mark interpretations as `inferred`
  or `uncertain`; never present them as confirmed requirements.
- Treat labels as supporting metadata, not requirements, unless the issue text
  clearly makes a label authoritative.
- Do not resolve conflicting title, body, comment, metadata, or repository
  evidence silently. Record the conflict as an unclear decision.
- Do not draft replacement issue text, publish anything, or start a follow-up
  Skill. Recommend at most one next Skill.
- Use `analyze-issue` for implementation-readiness analysis of a loaded
  issue. Use `assess-issue-quality` for the six-dimension 1–5 rubric. Use
  `conduct-product-interview` for the subsequent product interview. Use
  `identify-product-capabilities` only after that interview is confirmed.
  Use `decompose-product-capabilities` only after that map is confirmed.
  Use `assess-issue-atomicity` only after that decomposition is confirmed.
  Use `build-product-dependency-graph` only after that assessment is
  confirmed. Use `prioritize-product-issues` only after that graph is
  confirmed.

## Input contract

The primary input is one `LoadedIssue` version 1 handoff:

```yaml
loaded_issue:
  schema: LoadedIssue
  version: 1
  status: loaded | partial | blocked
```

The handoff must contain the required fields from
[`LoadedIssue`](../../shared/schemas/LoadedIssue.yaml), including the exact
title and body, issue identity, comments, metadata, linked pull requests,
`unavailable_fields`, and `failure`.

If no handoff is present, ask the user to provide the loaded issue snapshot or
the repository and issue identity for a separate loading step. Do not claim
that the issue was assessed without the snapshot. If the supplied object is
malformed or has an unsupported version, return a `blocked`
[`ProductAssessment`](../../shared/schemas/ProductAssessment.yaml) result.

## Evidence and certainty

Use concise source references that let a reviewer locate the evidence:

- `title`
- `body`
- `comment[1]` or another stable comment position
- `label[name]`
- `linked_pull_requests[0]`
- `metadata.<field>`
- `repository:<path>` when explicitly supplied repository context was used

Classify inventory items as:

- `evidenced` — directly stated or retrieved from the supplied snapshot.
- `inferred` — a reasonable interpretation supported by evidence but not
  explicitly stated.
- `uncertain` — evidence is incomplete, conflicting, or unavailable.

Put confirmed source statements in the matching `topics` list with
`certainty: evidenced`. Put interpretations in `assumptions` or
`implicit_requirements`. Put unresolved product decisions in
`unclear_decisions` and `open_questions`. Empty lists are valid. Do not fill
gaps with generic guesses.

## Workflow

### 1. Validate the snapshot

Check the input shape, `schema`, `version`, required fields, and source status.
Copy the source repository, number, URL, LoadedIssue version, LoadedIssue
status, and `unavailable_fields` into `ProductAssessment.source` without
normalizing or inventing values.

If `LoadedIssue.status` is `blocked`, return:

- `status: blocked`
- empty `topics` lists and empty diagnostic inventories
- `interview_focus: []`
- `recommended_next_skill: none`
- `failure.code: blocked_source`

Do not create product items about issue content that was not available.

### 2. Account for partial evidence

For `LoadedIssue.status: partial`, inspect every path in
`unavailable_fields`. Continue only when the remaining snapshot supports a
reliable product assessment. If an unavailable field could change a material
topic, mixed-feature finding, implicit requirement, or unclear decision:

- set `status: partial`
- preserve the missing path
- use `failure.code: incomplete_source`
- describe the uncertainty in the affected item

Do not treat `null` as an empty list. An empty list means the source was
retrieved and contained no entries.

### 3. Extract the product topics

Extract, without rewriting the issue or interviewing the user:

1. Problem — what is wrong or missing, for whom, and what impact is stated.
2. Desired outcome — the bounded result the parent issue appears to seek.
3. Users/actors — user groups, roles, or systems named or implied.
4. Use cases — journeys that must succeed for that outcome.
5. Functional requirements — requested behavior or capabilities.
6. Business rules — rules, thresholds, permissions, or policy constraints.
7. Constraints — technical, legal, operational, or platform limits.
8. Acceptance criteria — only observable completion conditions actually
   stated or directly evidenced. Do not author missing criteria here.
9. Dependencies — platforms, integrations, data, permissions, or owners.
10. Priorities — what must ship in this issue versus later follow-up.
11. Open questions — decisions an interviewer still has to resolve.

Keep separate items for separate decisions. Apply
[`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc)
only as a recognition raster for mixed features. Do not split, lock a slice,
or create GitHub issues.

### 4. Detect gaps that the interview must cover

Record:

- `assumptions` — interpretations that must not be treated as confirmed
  requirements.
- `implicit_requirements` — behavior, actors, data, or constraints the
  request appears to rely on but does not state.
- `mixed_features` — more than one independent user-visible outcome, mixed
  journeys, or bundled feature lists in the same parent issue.
- `unclear_decisions` — missing, ambiguous, or contradictory product
  choices that would change scope, actors, behavior, or acceptance.

Do not flatten contradictions into one invented interpretation.

### 5. Choose interview focus and one follow-up

Set `interview_focus` to at most two prioritized follow-up topics for the
subsequent interview. Prefer questions that change scope, atomicity,
acceptance, or the selected outcome. Do not ask those questions in this
Skill.

Choose exactly one recommendation:

- `conduct-product-interview` — the parent issue needs an adaptive product
  interview from this assessment. This is the usual next step.
- `rewrite-github-issue` — interview decisions are already available and
  the next step is an issue rewrite draft.
- `structure-issue` — requirements should be organized into an
  `IssueAssessment` without a GitHub rewrite.
- `define-acceptance-criteria` — product topics are evidenced, and
  observable pass/fail conditions are the main gap.
- `none` — the source is blocked, or no follow-up is justified.

Do not invoke the recommendation automatically.

## Output contract

First give a concise summary in the conversation language. Then return one
English `ProductAssessment` version-1 handoff using the field names from
[`ProductAssessment`](../../shared/schemas/ProductAssessment.yaml):

```yaml
status: analyzed
source:
  repository: octo-org/widgets
  number: 42
  url: https://github.com/octo-org/widgets/issues/42
  loaded_issue_version: 1
  loaded_issue_status: loaded
  unavailable_fields: []
topics:
  problem:
    - text: "Billing users cannot export the current month's invoices."
      evidence: "body"
      certainty: evidenced
  desired_outcome:
    - text: "A billing user can download the current month's invoices as CSV."
      evidence: "body"
      certainty: evidenced
  actors:
    - text: "Billing users"
      evidence: "body"
      certainty: evidenced
  use_cases: []
  functional_requirements: []
  business_rules: []
  constraints: []
  acceptance_criteria: []
  dependencies: []
  priorities: []
assumptions:
  - text: "CSV is the intended export format."
    evidence: "body mentions export without naming a format."
    certainty: inferred
implicit_requirements: []
mixed_features:
  - text: "Invoice export and saved payment methods are independent outcomes."
    evidence: "body"
    certainty: evidenced
unclear_decisions:
  - text: "The export format is not decided."
    evidence: "body"
    certainty: uncertain
open_questions:
  - text: "Which export format is in scope for this parent issue?"
    evidence: "No format is stated in body."
    certainty: uncertain
interview_focus:
  - text: "Which one outcome should the subsequent interview lock first?"
    evidence: "body lists invoice export and saved payment methods."
    certainty: evidenced
recommended_next_skill: conduct-product-interview
failure: null
```

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No `LoadedIssue` handoff is available. | Ask one concise handoff question or return `blocked` if it cannot be supplied. |
| `invalid_input` | Required fields are missing or have invalid types. | `blocked`; do not analyze guessed values. |
| `unsupported_version` | The snapshot is not `LoadedIssue` version 1. | `blocked`; request a compatible handoff. |
| `blocked_source` | The source handoff has `status: blocked`. | `blocked`; preserve known identity and return no fabricated product items. |
| `incomplete_source` | A partial snapshot lacks material evidence. | `partial`; identify unavailable fields and uncertainty. |
| `analysis_failure` | An unexpected local analysis failure prevents a reliable result. | `blocked`; describe the operation without exposing secrets or raw credentials. |

Use `failure: null` only for `analyzed` results. A failure message must not
expose tokens, credentials, private keys, `.env` contents, or unnecessary raw
CLI output.
