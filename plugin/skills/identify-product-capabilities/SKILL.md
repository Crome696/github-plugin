---
name: identify-product-capabilities
description: Map one parent LoadedIssue plus one confirmed ProductInterview into a hierarchical English ProductCapabilityMap grouped by independently understandable Product Value and behavior areas, uniquely assign requirements, record overlaps and gaps, and do not create sub-issues. Use automatically after a confirmed product interview or when a user asks for a capability map or product-value grouping before atomic decomposition; do not use for product-topic extraction (analyze-product-issue), interviewing (conduct-product-interview), atomic decomposition (decompose-product-capabilities), atomicity classification (assess-issue-atomicity), dependency graphing (build-product-dependency-graph), product prioritization (prioritize-product-issues), repository-area mapping (identify-affected-areas), session capability resolution (resolve-context-capabilities), issue rewriting (rewrite-github-issue or structure-issue), sub-issue creation, or publication.
---

# Identify Product Capabilities

Determine the domain capabilities and behavior areas of the feature from the
parent issue and the confirmed Product Interview. Group requirements by
independently understandable Product Value instead of technical components.
Show relationships between capabilities and assign each requirement uniquely.
Identify overlapping or missing areas. Do not create final sub-issues. The
output is a hierarchical Capability Map as an intermediate stage for atomic
decomposition.

Consume one version-1 `LoadedIssue` and one confirmed version-2
`ProductInterview`. Return the version-1 `ProductCapabilityMap` handoff. Do
not rewrite the issue, interview the user, or create GitHub issues.

`issue-agent` mode `refine` uses this map after `conduct-product-interview`
so `decompose-product-capabilities` can split the map, `assess-issue-atomicity`
can classify each unit, `build-product-dependency-graph` can map evidenced
dependencies, `prioritize-product-issues` can rank those units with the
user, and `rewrite-github-issue` can select one
independently valuable slice without inventing a split.

## Boundaries

- Keep questions and explanations in the user's conversation language.
- Keep the structured handoff and all newly authored report text in English.
  Preserve short exact source excerpts when they are needed as evidence.
- Require both a `LoadedIssue` handoff and a confirmed `ProductInterview`
  handoff. Do not silently load or re-fetch an issue, infer identity from the
  workspace, or invoke `load-github-issue`, `analyze-product-issue`, or
  `conduct-product-interview` automatically.
- A supplied version-1 `ProductAssessment` is optional interview-prep
  context only. Use it to locate already extracted topics. It does not
  replace the confirmed interview.
- Do not edit GitHub, repository files, labels, comments, issue state, or
  pull requests. Do not create, propose as a write, split, or publish
  sub-issues. The Capability Map is diagnosis and grouping only.
- Do not group by technical components, layers, APIs, UI, tests, or
  `ImplementationPlan` steps. Apply
  [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc)
  as a recognition raster for independently understandable Product Value.
- Do not invent essential product decisions or treat interview `assumptions`
  as confirmed requirements. Do not map non-goals as capabilities.
- Do not turn mapping into a requirements interview. When a required handoff
  or matching identity is missing, return a blocked result with the typed
  prerequisite instead of asking a product-decision question.
- Do not draft replacement issue text, publish anything, or start a follow-up
  Skill. Recommend at most one next Skill.
- Use `analyze-product-issue` for parent-issue product-topic extraction. Use
  `conduct-product-interview` when the interview is still missing. Use
  `decompose-product-capabilities` to split the map into atomic units. Use
  `assess-issue-atomicity` to classify those units. Use
  `build-product-dependency-graph` to map evidenced dependencies among
  classified candidates. Use `prioritize-product-issues` to rank more than
  one `atomic-enough` unit with the user. Use
  `identify-affected-areas` for repository-area mapping. Use
  `rewrite-github-issue` to draft one selected slice. Use `structure-issue`
  to organize an `IssueAssessment`.

## Input contract

The required inputs are one `LoadedIssue` version 1 handoff and one confirmed
`ProductInterview` version 2 handoff:

```yaml
loaded_issue:
  schema: LoadedIssue
  version: 1
  status: loaded | partial | blocked
product_interview:
  schema: ProductInterview
  version: 2
  status: complete
```

The issue snapshot must contain the required fields from
[`LoadedIssue`](../../shared/schemas/LoadedIssue.yaml). The interview must
contain the required fields from
[`ProductInterview`](../../shared/schemas/ProductInterview.yaml).

Treat `ProductInterview.status: complete` as confirmed. Explicitly accepted
residual open points already recorded in that complete interview remain
documented gaps; they do not reopen the interview here.

If either required handoff is absent, return a `blocked`
`ProductCapabilityMap` result that identifies the missing handoff; do not ask a
product-decision question. Do not claim that the Capability Map ran without
both. If a supplied object is malformed or has an unsupported version, return
a `blocked`
[`ProductCapabilityMap`](../../shared/schemas/ProductCapabilityMap.yaml)
result.

## Evidence and grouping

Use concise source references that let a reviewer locate the evidence:

- `title`, `body`, `comment[1]`, `label[name]`, `metadata.<field>`
- `interview.confirmed_decisions[<topic>]`
- `assessment.topics.<topic>` only when a `ProductAssessment` was supplied

Classify each requirement `origin` as:

- `parent_issue` — stated in the loaded parent issue snapshot.
- `product_interview` — a `confirmed_decisions` item from the interview.

Do not copy `assumptions` or unaccepted `open_questions` into `requirements`.
Record those as `gaps` of kind `uncovered_interview_decision` when they would
change grouping.

Group capabilities by independently understandable Product Value: one bounded
outcome a reader can understand without reconstructing intent from the parent
issue. Nest behavior areas under that capability. Set `parent_id` to another
capability `id` for hierarchy, or `null` for a root capability.

Relation types:

- `depends_on` — this capability cannot be understood or validated without
  the target.
- `sequences` — this capability should follow the target but still has its
  own Product Value.
- `overlaps` — the same requirement or outcome appears to sit in both;
  record the requirement in `overlaps` and assign it to exactly one
  capability.

## Workflow

### 1. Validate the inputs

Check each input shape, `schema`, `version`, required fields, and source
status. Copy the parent-issue repository, number, URL, LoadedIssue version,
LoadedIssue status, ProductInterview version, ProductInterview status, and
combined `unavailable_fields` into `ProductCapabilityMap.source` without
normalizing or inventing values.

If either source `status` is `blocked`, return:

- `status: blocked`
- empty `requirements`, `capabilities`, `overlaps`, and `gaps`
- `recommended_next_skill: none`
- `failure.code: blocked_source`

Do not invent capabilities about issue content that was not available.

If the interview is not `complete`, return `blocked` with
`failure.code: unconfirmed_interview`. Do not map from unconfirmed decisions.

If repository, number, or URL identities disagree between the loaded issue
and the interview source, return `blocked` with
`failure.code: identity_mismatch`.

### 2. Account for partial evidence

For `LoadedIssue.status: partial`, inspect every path in
`unavailable_fields`. Continue only when the remaining snapshot and confirmed
interview still support a reliable map. If an unavailable field could change
grouping, assignment, or a relationship:

- set `status: partial`
- preserve the missing path
- use `failure.code: incomplete_source`

Do not treat `null` as an empty list. An empty list means the source was
retrieved and contained no entries.

### 3. Inventory requirements

Collect distinct requirements from the parent issue title, body, comments,
and metadata, and from interview `confirmed_decisions`. Give each item a
stable `id`, `text`, `origin`, and `evidence`.

Keep separate items for separate Product Value. Do not merge independent
outcomes. Do not split one inseparable outcome into technical layers. Skip
explicit non-goals.

When a `ProductAssessment` is supplied, use evidenced topics only as locators
for parent-issue requirements. Do not reconfirm inferred assessment items.

### 4. Build the hierarchical Capability Map

Apply [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc).
Create one capability per independently understandable Product Value. Under
each capability, list behavior areas that describe user- or
stakeholder-visible behavior for that value.

Assign each requirement to exactly one capability through
`assigned_requirement_ids`. If two capabilities appear to own the same
requirement, pick the capability whose Product Value still holds without the
sibling, record the conflict in `overlaps`, and do not dual-assign.

Record capability-to-capability `relations` with evidence. Identify gaps:

- `unassigned_requirement` — a collected requirement has no capability.
- `uncovered_interview_decision` — a confirmed decision or accepted open
  point has no mapped behavior area.
- `empty_capability` — a capability has no assigned requirements.
- `missing_behavior` — a capability's Product Value implies a behavior area
  that neither source evidenced.

Do not fill gaps with invented behavior.

### 5. Choose status and one follow-up

Set status as follows:

- `mapped` only when every collected requirement is uniquely assigned and
  remaining gaps are documented rather than guessed.
- `partial` when mapping is possible but assignment, source evidence, or a
  material behavior area is incomplete.
- `blocked` when a required handoff cannot be used.

Choose exactly one recommendation:

- `decompose-product-capabilities` — the map is usable and should be split
  into the smallest value-oriented units. This is the usual next step after
  a mapped or partial refine map.
- `rewrite-github-issue` — draft one already selected independently valuable
  capability when decomposition is unnecessary or already available.
- `structure-issue` — the map should be organized into an `IssueAssessment`
  without a GitHub rewrite.
- `none` — the source is blocked, or no follow-up is justified.

Do not invoke the recommendation automatically. Do not create GitHub
sub-issues for the remaining capabilities.

## Output contract

First give a concise summary in the conversation language. Then return one
English `ProductCapabilityMap` version-1 handoff using the field names from
[`ProductCapabilityMap`](../../shared/schemas/ProductCapabilityMap.yaml):

```yaml
status: mapped
source:
  repository: octo-org/widgets
  number: 42
  url: https://github.com/octo-org/widgets/issues/42
  loaded_issue_version: 1
  loaded_issue_status: loaded
  product_interview_version: 2
  product_interview_status: complete
  unavailable_fields: []
requirements:
  - id: req-csv-export
    text: "A billing user can download the current month's invoices as CSV."
    origin: product_interview
    evidence: "interview.confirmed_decisions[outcome]"
  - id: req-empty-month
    text: "Downloading an empty month returns an empty CSV rather than an error."
    origin: product_interview
    evidence: "interview.confirmed_decisions[edge_cases]"
capabilities:
  - id: cap-invoice-csv-export
    parent_id: null
    name: Export current-month invoices as CSV
    product_value: "A billing user can download this month's invoices without waiting for accounting."
    behavior_areas:
      - id: beh-download
        name: Download current month
        description: "The billing user can start a CSV download from the billing dashboard."
      - id: beh-empty-month
        name: Empty-month file
        description: "An empty month still produces a downloadable empty CSV."
    assigned_requirement_ids:
      - req-csv-export
      - req-empty-month
    relations: []
overlaps: []
gaps: []
recommended_next_skill: decompose-product-capabilities
failure: null
```

Use `failure: null` only for `mapped` results.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No `LoadedIssue` or no `ProductInterview` handoff is available. | Return a blocked map identifying the missing handoff; do not ask a product-decision question. |
| `invalid_input` | Required fields are missing or have invalid types. | `blocked`; do not map guessed values. |
| `unsupported_version` | A required handoff is not its supported version, including ProductInterview version 2. | `blocked`; request a compatible handoff. |
| `blocked_source` | A source handoff has `status: blocked`. | `blocked`; preserve known identity and return no fabricated capabilities. |
| `incomplete_source` | A partial snapshot lacks material evidence. | `partial`; identify unavailable fields and uncertainty. |
| `identity_mismatch` | The loaded issue and interview identify different issues. | `blocked`; do not merge unrelated sources. |
| `unconfirmed_interview` | The interview is not `complete`. | `blocked`; require a confirmed Product Interview. |
| `mapping_failure` | An unexpected local failure prevents a reliable map. | `blocked`; describe the operation without exposing secrets or raw credentials. |

A failure message must not expose tokens, credentials, private keys, `.env`
contents, or unnecessary raw CLI output.
