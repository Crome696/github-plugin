---
name: decompose-product-capabilities
description: Decompose confirmed Product Capabilities from LoadedIssue v1 plus ProductCapabilityMap v1 into the smallest English value-oriented units, each describing one observable outcome and enabling independent acceptance, while preserving parent traceability. Use automatically after a mapped CapabilityMap or when preparing atomic slices; do not use for capability mapping, atomicity, dependency graphing, prioritization, complete draft composition (compose-product-sub-issues), acceptance-criteria drafting, issue rewriting, sub-issue creation, or publication.
---

# Decompose Product Capabilities

Decompose confirmed Product Capabilities iteratively into the smallest
value-oriented units. Each unit must describe a single observable behavior or
outcome and enable independent acceptance criteria. Continue decomposing when
a unit still contains multiple behaviors, actors, rules, or outcomes. Stop
when further decomposition would only produce technical tasks without
independent domain meaning. Preserve traceability to the parent issue and the
parent capability.

Consume one version-1 `LoadedIssue` and one version-1 `ProductCapabilityMap`.
Return the version-1 `ProductCapabilityDecomposition` handoff. Do not rewrite
the issue, map capabilities, draft acceptance criteria, or create GitHub
issues.

`issue-agent` mode `refine` uses this decomposition after
`identify-product-capabilities` so `assess-issue-atomicity` can classify
each unit, `build-product-dependency-graph` can map evidenced
dependencies, `prioritize-product-issues` can rank those units with the
user, and `rewrite-github-issue` can select one atomic slice. The separate
`compose-product-sub-issues` Skill consumes the later confirmed results to
compose the complete draft set.

## Boundaries

- Keep questions and explanations in the user's conversation language.
- Keep the structured handoff and all newly authored report text in English.
  Preserve short exact source excerpts when they are needed as evidence.
- Require both a `LoadedIssue` handoff and a `ProductCapabilityMap` handoff.
  Do not silently load or re-fetch an issue, infer identity from the
  workspace, or invoke `load-github-issue` or
  `identify-product-capabilities` automatically.
- Do not edit GitHub, repository files, labels, comments, issue state, or
  pull requests. Do not create, propose as a write, split, or publish
  sub-issues. Decomposition is diagnosis only.
- Do not split by technical components, layers, APIs, UI, tests, or
  `ImplementationPlan` steps. Apply
  [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc)
  as the stop raster for independently understandable Product Value.
- Do not invent essential product decisions or treat map gaps, overlaps, or
  interview assumptions as confirmed requirements. Do not turn non-goals
  into units.
- Do not write the full acceptance-criteria set. Record
  `independent_acceptance` as proof that criteria can pass or fail alone.
  Use `define-acceptance-criteria` when observable completion conditions
  still need drafting.
- Do not turn decomposition into a requirements interview. Ask at most one
  concise question only when a required handoff, matching identity, or
  selected unit is missing.
- Do not draft replacement issue text, publish anything, or start a follow-up
  Skill. Recommend at most one next Skill.
- Do not compose issue drafts here; `compose-product-sub-issues` requires
  atomicity and product-priority confirmation first.
- Use `identify-product-capabilities` for the hierarchical Capability Map.
  Use `assess-issue-atomicity` to classify each unit as `too-large`,
  `atomic-enough`, or `over-fragmented`. Use
  `build-product-dependency-graph` to map evidenced product and mandatory
  technical dependencies among classified candidates. Use
  `prioritize-product-issues` to rank more than one `atomic-enough` unit
  with the user. Use
  `rewrite-github-issue` to draft one selected `atomic-enough` unit. Use
  `structure-issue` to organize an `IssueAssessment`. Use
  `define-acceptance-criteria` to formulate pass/fail criteria for one
  selected unit.

## Input contract

The required inputs are one `LoadedIssue` version 1 handoff and one
`ProductCapabilityMap` version 1 handoff:

```yaml
loaded_issue:
  schema: LoadedIssue
  version: 1
  status: loaded | partial | blocked
product_capability_map:
  schema: ProductCapabilityMap
  version: 1
  status: mapped | partial
```

The issue snapshot must contain the required fields from
[`LoadedIssue`](../../shared/schemas/LoadedIssue.yaml). The map must contain
the required fields from
[`ProductCapabilityMap`](../../shared/schemas/ProductCapabilityMap.yaml).

Treat `ProductCapabilityMap.status: mapped` as confirmed grouping. A
`partial` map may continue only when remaining gaps cannot change which
units exist. Explicit gaps already recorded in that map remain documented;
they do not reopen mapping here.

If either required handoff is absent, ask the user to provide the loaded
parent issue and the Capability Map. Do not claim that decomposition ran
without both. If a supplied object is malformed or has an unsupported
version, return a `blocked`
[`ProductCapabilityDecomposition`](../../shared/schemas/ProductCapabilityDecomposition.yaml)
result.

## Split and stop

Use concise source references that let a reviewer locate the evidence:

- `title`, `body`, `comment[1]`, `label[name]`, `metadata.<field>`
- `map.capabilities[<id>]`
- `map.requirements[<id>]`
- `map.capabilities[<id>].behavior_areas[<id>]`

Continue decomposing a candidate while any of the following is true:

- more than one observable behavior
- more than one actor
- more than one independently acting business rule
- more than one outcome

Stop and emit a unit when:

- `atomic_enough` — one actor, one observable outcome, and acceptance
  criteria can pass or fail without a sibling unit.
- `inseparable_dependency` — a documented dependency makes independent
  validation impossible; keep the inseparable work in one unit.

Do not emit a unit whose only remaining split would be a technical task
without independent domain meaning, such as "add a DTO", "write tests", or
"prepare a migration" as a standalone slice of one outcome.

Each unit must keep:

- `parent_capability_id` and `parent_capability_name` from the map
- parent-issue identity in `source` without inventing replacements
- `assigned_requirement_ids` drawn only from that parent capability

Relation types:

- `depends_on` — this unit cannot be understood or validated without the
  target.
- `sequences` — this unit should follow the target but still has its own
  Product Value.

## Workflow

### 1. Validate the inputs

Check each input shape, `schema`, `version`, required fields, and source
status. Copy the parent-issue repository, number, URL, LoadedIssue version,
LoadedIssue status, ProductCapabilityMap version, ProductCapabilityMap
status, and combined `unavailable_fields` into
`ProductCapabilityDecomposition.source` without normalizing or inventing
values.

If either source `status` is `blocked`, return:

- `status: blocked`
- empty `units`, `relations`, and `gaps`
- `recommended_next_skill: none`
- `failure.code: blocked_source`

Do not invent units about issue content that was not available.

If the map is not `mapped` or `partial`, return `blocked` with
`failure.code: unconfirmed_map`. Do not decompose unconfirmed grouping.

If repository, number, or URL identities disagree between the loaded issue
and the map source, return `blocked` with
`failure.code: identity_mismatch`.

### 2. Account for partial evidence

For `LoadedIssue.status: partial` or `ProductCapabilityMap.status: partial`,
inspect every path in `unavailable_fields`. Continue only when the remaining
snapshot and map still support a reliable decomposition. If an unavailable
field could change a split, a stop, or a relationship:

- set `status: partial`
- preserve the missing path
- use `failure.code: incomplete_source`

Do not treat `null` as an empty list. An empty list means the source was
retrieved and contained no entries.

### 3. Inventory confirmed capabilities

Use only mapped capabilities and uniquely assigned requirements. Do not
fill map `gaps` or `overlaps`. Do not copy unassigned requirements into
units; record them as `gaps` of kind `unassigned_requirement`.

Skip explicit non-goals. Keep separate items for separate Product Value.

### 4. Decompose iteratively

Apply [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc).
For each confirmed capability, split until every remaining candidate is a
unit under Split and stop.

Assign each mapped requirement to exactly one unit through
`assigned_requirement_ids`. If two units appear to own the same
requirement, pick the unit whose observable outcome still holds without the
sibling and keep the requirement uniquely assigned.

Record unit-to-unit `relations` with evidence. Identify gaps:

- `unassigned_requirement` — a mapped requirement has no unit.
- `empty_capability` — a capability produced no unit.
- `compound_unit` — a candidate still contains multiple behaviors, actors,
  rules, or outcomes.
- `missing_trace` — a unit cannot name its parent capability or parent
  issue identity.

Do not fill gaps with invented behavior. Do not create GitHub sub-issues
for remaining units.

### 5. Choose status and one follow-up

Set status as follows:

- `decomposed` only when every mapped requirement is uniquely assigned to a
  unit, every unit has one actor and one observable outcome, and remaining
  gaps are documented rather than guessed.
- `partial` when decomposition is possible but assignment, source evidence,
  or a material split is incomplete.
- `blocked` when a required handoff cannot be used.

Choose exactly one recommendation:

- `assess-issue-atomicity` — one or more units exist and should be
  classified before a slice is drafted. This is the usual next step after
  a decomposed or partial refine decomposition.
- `rewrite-github-issue` — one already classified `atomic-enough` unit is
  the selected slice, or only one such unit remains.
- `structure-issue` — the units should be organized into an
  `IssueAssessment` without a GitHub rewrite.
- `define-acceptance-criteria` — one selected unit is atomic but still
  lacks observable completion conditions.
- `none` — the source is blocked, or no follow-up is justified.

Do not invoke the recommendation automatically. When units exist, recommend
`assess-issue-atomicity` so each candidate is classified before a slice is
drafted.

## Output contract

First give a concise summary in the conversation language. Then return one
English `ProductCapabilityDecomposition` version-1 handoff using the field
names from
[`ProductCapabilityDecomposition`](../../shared/schemas/ProductCapabilityDecomposition.yaml):

```yaml
status: decomposed
source:
  repository: octo-org/widgets
  number: 42
  url: https://github.com/octo-org/widgets/issues/42
  loaded_issue_version: 1
  loaded_issue_status: loaded
  product_capability_map_version: 1
  product_capability_map_status: mapped
  unavailable_fields: []
units:
  - id: unit-invoice-csv-export
    name: Export current-month invoices as CSV
    observable_outcome: "A billing user can download this month's invoices as CSV from the billing dashboard."
    product_value: "A billing user can take this month's invoices without waiting for accounting."
    actor: billing user
    parent_capability_id: cap-billing-self-service
    parent_capability_name: Billing self-service
    assigned_requirement_ids:
      - req-csv-export
      - req-empty-month
    evidence: "map.capabilities[cap-billing-self-service]"
    stop_reason: atomic_enough
    independent_acceptance: "The download succeeds with a CSV of this month's invoices, including an empty file for an empty month, without saved payment methods."
  - id: unit-saved-payment-method
    name: Save a payment method for later invoices
    observable_outcome: "A billing user can store one payment method and reuse it on later invoices."
    product_value: "A billing user can pay later invoices without re-entering card details."
    actor: billing user
    parent_capability_id: cap-billing-self-service
    parent_capability_name: Billing self-service
    assigned_requirement_ids:
      - req-save-payment-method
    evidence: "map.capabilities[cap-billing-self-service]"
    stop_reason: atomic_enough
    independent_acceptance: "Saving one payment method succeeds and later invoices can use it even if CSV export is not delivered."
relations: []
gaps: []
recommended_next_skill: assess-issue-atomicity
failure: null
```

Use `failure: null` only for `decomposed` results.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No `LoadedIssue` or no `ProductCapabilityMap` handoff is available. | Ask one concise handoff question or return `blocked` if it cannot be supplied. |
| `invalid_input` | Required fields are missing or have invalid types. | `blocked`; do not decompose guessed values. |
| `unsupported_version` | A required handoff is not version 1. | `blocked`; request a compatible handoff. |
| `blocked_source` | A source handoff has `status: blocked`. | `blocked`; preserve known identity and return no fabricated units. |
| `incomplete_source` | A partial snapshot or map lacks material evidence. | `partial`; identify unavailable fields and uncertainty. |
| `identity_mismatch` | The loaded issue and Capability Map identify different issues. | `blocked`; do not merge unrelated sources. |
| `unconfirmed_map` | The Capability Map is not `mapped` or `partial`. | `blocked`; require confirmed grouping. |
| `decomposition_failure` | An unexpected local failure prevents a reliable decomposition. | `blocked`; describe the operation without exposing secrets or raw credentials. |

A failure message must not expose tokens, credentials, private keys, `.env`
contents, or unnecessary raw CLI output.
