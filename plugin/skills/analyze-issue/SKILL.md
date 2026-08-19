---
name: analyze-issue
description: Analyze one loaded GitHub issue for clarity, completeness, feasibility, scope, testability, dependencies, risks, contradictions, and missing information, then judge implementation readiness without rewriting it. Use automatically when a user asks to analyze a loaded issue, identify readiness gaps, or find blockers from a LoadedIssue snapshot; do not use for parent-issue product-topic extraction (use analyze-product-issue), numeric quality scoring, requirements elicitation, acceptance-criteria authoring alone, issue rewrites, or publication.
---

# Analyze GitHub Issues

Analyze exactly one version-1 `LoadedIssue` as an evidence-backed, read-only
diagnostic. Identify what the issue states, what it assumes, what remains
unknown, and whether implementation can begin without inventing product
decisions. Return the version-1 `IssueAnalysis` handoff; do not rewrite the
issue.

`issue-agent` mode `refine` uses this analysis to select bounded clarification
questions and identify which requirements, acceptance criteria, or quality
checks need attention before drafting a revision.

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
- Base every finding on available evidence. Mark interpretations as `inferred`
  or `uncertain`; never present them as explicit requirements.
- Treat labels as supporting metadata, not requirements, unless the issue text
  clearly makes a label authoritative.
- Do not resolve conflicting title, body, comment, metadata, or repository
  evidence silently. Record the conflict as a contradiction finding.
- Do not turn the analysis into a requirements interview. Ask at most one
  concise question only when the required handoff or its identity is missing.
  Parent-issue product-topic extraction belongs to
  [analyze-product-issue](../analyze-product-issue/SKILL.md).
- Do not draft replacement issue text, publish anything, or start a follow-up
  Skill. Recommend at most one next Skill.

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
that the issue was analyzed without the snapshot. If the supplied object is
malformed or has an unsupported version, return a `blocked`
[`IssueAnalysis`](../../shared/schemas/IssueAnalysis.yaml) result.

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

An `explicit_requirements` item must be `evidenced`. Put interpretations in
`implicit_assumptions`, and put unresolved decisions in `open_questions`.
Missing acceptance criteria are not authored by this Skill; record the gap and
recommend `define-acceptance-criteria` when appropriate.

## Workflow

### 1. Validate the snapshot

Check the input shape, `schema`, `version`, required fields, and source status.
Copy the source repository, number, URL, LoadedIssue version, LoadedIssue
status, and `unavailable_fields` into `IssueAnalysis.source` without
normalizing or inventing values.

If `LoadedIssue.status` is `blocked`, return:

- `status: blocked`
- `overall_readiness: blocked`
- `implementation_ready: false`
- empty inventories and findings
- `recommended_next_skill: none`
- `failure.code: blocked_source`

Do not create findings about issue content that was not available.

### 2. Account for partial evidence

For `LoadedIssue.status: partial`, inspect every path in
`unavailable_fields`. Continue only when the remaining snapshot supports a
reliable assessment. If an unavailable field could change a material finding,
readiness decision, dependency assessment, or contradiction check:

- set `status: partial`
- preserve the missing path
- set `overall_readiness: needs_work`
- set `implementation_ready: false`
- use `failure.code: incomplete_source`
- describe the uncertainty in the affected finding or inventory item

Do not treat `null` as an empty list. An empty list means the source was
retrieved and contained no entries.

### 3. Build the evidence inventories

Extract, without rewriting the issue:

1. Explicit requirements — requested behavior or constraints stated in the
   title, body, or clearly attributable comments.
2. Implicit assumptions — behavior, actors, platforms, permissions, data, or
   constraints that the request appears to rely on but does not state.
3. Acceptance criteria — only observable completion conditions actually stated
   or directly evidenced.
4. Affected areas — users, components, integrations, surfaces, or workflows
   named or supported by the evidence.
5. Open questions — decisions an implementer or verifier still has to make.
6. Potential blockers — missing access, dependency, permission, environment,
   decision, or evidence that could prevent implementation or verification.

Every item contains `text`, `evidence`, and `certainty`. Keep separate items
for separate decisions. Do not fill an empty inventory with generic guesses.

### 4. Evaluate the nine analysis categories

Create a finding when the issue has a meaningful strength, gap, risk, or
conflict. Use these categories:

- `clarity` — ambiguous terms, actors, behavior, or desired outcome.
- `completeness` — missing problem, users, current behavior, target behavior,
  constraints, non-goals, or completion conditions.
- `feasibility` — requested outcome lacks a demonstrated feasible path or
  conflicts with known supplied context.
- `scope` — work is unbounded, mixes unrelated outcomes, hides multiple
  requirements, is too small to carry product value, or lacks exclusions.
  Apply [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc).
- `testability` — outcomes are subjective, unmeasured, or lack pass/fail
  verification.
- `dependencies` — required systems, data, permissions, platforms, or owners
  are missing or unspecified.
- `risks` — safety, migration, compatibility, operational, or rollback risks
  supported by the available evidence.
- `contradictions` — two attributable sources require incompatible behavior or
  define different scope.
- `missing_information` — a specific decision or evidence is absent and
  materially affects implementation or verification.

Use severity consistently:

- `blocker` — a reliable assessment or safe implementation cannot proceed
  until the identified issue is resolved.
- `major` — a material decision, boundary, dependency, or verification detail
  is missing, ambiguous, risky, or conflicting.
- `minor` — a non-blocking clarification or improvement would reduce
  implementation or verification risk.
- `info` — an evidence-backed observation with no current readiness impact.

Set confidence to `high`, `medium`, or `low` based on the quality and directness
of the evidence. Every finding must include a concrete `summary`, `rationale`,
`evidence`, optional `uncertainty`, and a specific
`recommended_improvement`. Recommend a decision or verification step, not
replacement issue prose.

### 5. Determine readiness

Apply these rules in order:

1. `blocked` source or invalid required input → `overall_readiness: blocked`
   and `implementation_ready: false`.
2. An assessable source with any unresolved material gap, blocker, major
   finding, material open question, or potential blocker →
   `overall_readiness: needs_work` and `implementation_ready: false`.
3. `ready` requires no blocker or major finding, no material open question or
   potential blocker, and enough explicit scope and observable verification
   evidence to implement without guessing.

A ready analysis is not publication authorization and does not authorize
implementation work.

### 6. Recommend one follow-up

Choose exactly one recommendation:

- `structure-issue` — requirements, scope boundaries, dependencies, risks, or
  non-goals are the main gaps.
- `define-acceptance-criteria` — the issue is scoped, but observable
  pass/fail conditions or verification are the main gap.
- `rewrite-issue` — only when the user explicitly asks for a direct text-only
  rewrite with a change summary and no interview, approval, or publication.
- `rewrite-github-issue` — only when the user explicitly asks for a rewrite
  workflow with interview or task-scoped publication after the analysis.
- `assess-issue-quality` — only when the user also requests the separate
  six-dimension 1–5 quality rubric.
- `none` — the issue is ready, the source is blocked, or no follow-up is
  justified.

Do not invoke the recommendation automatically.

## Output contract

First give a concise summary in the conversation language. Then return one
English `IssueAnalysis` version-1 handoff using the field names from
[`IssueAnalysis`](../../shared/schemas/IssueAnalysis.yaml):

```yaml
status: analyzed
source:
  repository: octo-org/widgets
  number: 42
  url: https://github.com/octo-org/widgets/issues/42
  loaded_issue_version: 1
  loaded_issue_status: loaded
  unavailable_fields: []
implementation_ready: false
overall_readiness: needs_work
inventories:
  explicit_requirements:
    - text: "The issue requests preserving the original issue body."
      evidence: "body"
      certainty: evidenced
  implicit_assumptions:
    - text: "The existing loader is the component affected."
      evidence: "body; repository:README.md"
      certainty: inferred
  acceptance_criteria: []
  affected_areas:
    - text: "GitHub issue loading workflow"
      evidence: "body"
      certainty: evidenced
  open_questions:
    - text: "What verification proves preservation for an empty body?"
      evidence: "No observable empty-body condition is stated in body."
      certainty: uncertain
  potential_blockers: []
findings:
  - id: A-001
    category: testability
    severity: major
    confidence: high
    summary: "The completion condition is not observable for the empty-body case."
    rationale: "An implementer can preserve non-empty text, but the issue does not define how an empty body is verified."
    evidence: "body"
    uncertainty: null
    recommended_improvement: "Add a pass/fail check covering an issue whose body is empty."
recommended_next_skill: define-acceptance-criteria
failure: null
```

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No `LoadedIssue` handoff is available. | Ask one concise handoff question or return `blocked` if it cannot be supplied. |
| `invalid_input` | Required fields are missing or have invalid types. | `blocked`; do not analyze guessed values. |
| `unsupported_version` | The snapshot is not `LoadedIssue` version 1. | `blocked`; request a compatible handoff. |
| `blocked_source` | The source handoff has `status: blocked`. | `blocked`; preserve known identity and return no fabricated findings. |
| `incomplete_source` | A partial snapshot lacks material evidence. | `partial`; identify unavailable fields and uncertainty. |
| `analysis_failure` | An unexpected local analysis failure prevents a reliable result. | `blocked`; describe the operation without exposing secrets or raw credentials. |

Use `failure: null` only for `analyzed` results. A failure message must not
expose tokens, credentials, private keys, `.env` contents, or unnecessary raw
CLI output.
