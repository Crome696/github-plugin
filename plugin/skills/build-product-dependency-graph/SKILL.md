---
name: build-product-dependency-graph
description: Analyze atomic sub-issue candidates from ProductCapabilityDecomposition v1 and IssueAtomicityAssessment v1, map evidenced product and mandatory technical dependencies, distinguish blocks, requires, enables, related, and independent, detect cycles, and return ProductDependencyGraph v1 without ranking slices. Use automatically after atomicity assessment or when mapping sub-issue dependencies; do not use for decomposition, atomicity, prioritization, complete draft composition (compose-product-sub-issues), issue rewriting, implementation planning, sub-issue creation, or publication.
---

# Build Product Dependency Graph

Analyze the atomic sub-issue candidates and determine product as well as
mandatory technical dependencies. Distinguish `blocks`, `requires`,
`enables`, `related`, and `independent`. Avoid assumed dependencies without
evidence. Detect cycles and question problematic cuts. Produce a directed
dependency graph and identify issues that can be implemented in parallel.
Do not derive prioritization solely from technical order.

Consume one version-1 `ProductCapabilityDecomposition` and one version-1
`IssueAtomicityAssessment`. Return the version-1 `ProductDependencyGraph`
handoff. Do not rewrite the issue, reclassify atomicity, decompose
capabilities, or create GitHub issues.

`issue-agent` mode `refine` uses this graph after `assess-issue-atomicity`
so `prioritize-product-issues` can rank classified units with the user and
`rewrite-github-issue` drafts one selected `atomic-enough` unit with
explicit evidenced dependencies rather than a technical sequence ranking.
After prioritization, `compose-product-sub-issues` can compose all confirmed
atomic-unit drafts.

Technical implementation steps are not a sufficient reason for additional
Product Issues. A technical relation is allowed only when independent
validation is impossible.

## Boundaries

- Keep questions and explanations in the user's conversation language.
- Keep the structured handoff and all newly authored report text in English.
  Preserve short exact source excerpts when they are needed as evidence.
- Require both a `ProductCapabilityDecomposition` handoff and an
  `IssueAtomicityAssessment` handoff. Do not silently load or re-fetch an
  issue, infer identity from the workspace, or invoke
  `load-github-issue`, `decompose-product-capabilities`, or
  `assess-issue-atomicity` automatically.
- Do not edit GitHub, repository files, labels, comments, issue state, or
  pull requests. Do not create, propose as a write, split, or publish
  sub-issues. The graph is diagnosis only.
- Apply
  [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc)
  and [`github-evidence.mdc`](../../rules/github-evidence.mdc). Do not treat
  technical components, layers, APIs, UI, tests, migrations, DTOs, or
  `ImplementationPlan` steps as Product Issue dependencies.
- Do not invent essential product decisions or fill decomposition or
  assessment gaps. Do not turn non-goals into nodes.
- Do not assume a dependency because two units share a parent capability,
  actor, file, layer, or delivery phase.
- Do not derive product priority from graph order, topological sort, or
  technical sequence. Record `priority_boundary.technical_order_is_priority`
  as `false`.
- Do not turn graphing into a requirements interview. Ask at most one
  concise question only when a required handoff, matching identity, or
  selected unit is missing.
- Do not draft replacement issue text, publish anything, or start a follow-up
  Skill. Recommend at most one next Skill.
- Do not compose complete sub-issue drafts here; that belongs to
  `compose-product-sub-issues` after product priority is confirmed.
- Use `assess-issue-atomicity` to classify candidates. Use
  `decompose-product-capabilities` when a `too-large` candidate still needs
  splitting. Use `prioritize-product-issues` to rank more than one
  `atomic-enough` unit with the user. Use `rewrite-github-issue` to draft
  one selected `atomic-enough` unit. Use `structure-issue` to organize an
  `IssueAssessment`. Use `build-implementation-plan` only after a published
  issue is selected for implementation.

## Input contract

The required inputs are one `ProductCapabilityDecomposition` version 1
handoff and one `IssueAtomicityAssessment` version 1 handoff:

```yaml
product_capability_decomposition:
  schema: ProductCapabilityDecomposition
  version: 1
  status: decomposed | partial
issue_atomicity_assessment:
  schema: IssueAtomicityAssessment
  version: 1
  status: assessed | partial
```

The decomposition must contain the required fields from
[`ProductCapabilityDecomposition`](../../shared/schemas/ProductCapabilityDecomposition.yaml).
The assessment must contain the required fields from
[`IssueAtomicityAssessment`](../../shared/schemas/IssueAtomicityAssessment.yaml).

Treat `IssueAtomicityAssessment.status: assessed` as confirmed
classifications. A `partial` assessment or `partial` decomposition may
continue only when remaining gaps cannot change a node, edge, cycle, or
parallel group. Explicit gaps already recorded remain documented; they do
not reopen decomposition or atomicity assessment here.

If either required handoff is absent, ask the user to provide the
decomposition and the atomicity assessment. Do not claim that graphing ran
without both. If a supplied object is malformed or has an unsupported
version, return a `blocked`
[`ProductDependencyGraph`](../../shared/schemas/ProductDependencyGraph.yaml)
result.

## Relation kinds

Classify every pair of candidates. Emit a directed edge only when evidence
supports `blocks`, `requires`, `enables`, or `related`. Record
`independent` on the node, never as an edge.

Use concise source references that let a reviewer locate the evidence:

- `units[<id>]`
- `units[<id>].observable_outcome`
- `units[<id>].independent_acceptance`
- `relations[<from_id>-><to_id>]`
- `candidates[<id>]`
- `candidates[<id>].checks.<name>`
- `gaps[<kind>]`

Relation kinds:

- `requires` — directed. Source cannot be understood, accepted, or
  validated without the target. Hard prerequisite. `from_id` needs
  `to_id`.
- `blocks` — directed. Source must complete before the target can start
  or be validated. Hard successor constraint. `from_id` blocks `to_id`.
  Do not also emit the inverse `requires` unless that inverse is
  independently evidenced as a different claim.
- `enables` — directed. Source makes the target possible or more
  valuable, but the target still has independent product value and
  acceptance without it.
- `related` — undirected. Evidenced thematic or domain connection
  without an ordering constraint. Set `directed: false`.
- `independent` — confirmed absence of a product or mandatory technical
  constraint after checking both sources. Set the node's
  `independence: independent` and list its `unit_id` in
  `independent_units`. Do not emit an edge.

Domain:

- `product` — actor, journey, business rule, outcome, or acceptance
  evidence.
- `technical` — only a mandatory constraint that makes independent
  validation impossible, such as an inseparable security, migration, or
  contract decision already documented in the sources. Layer, phase,
  backend/frontend, DTO, test, or "implement X before Y" convenience
  order is not technical evidence.

Map existing decomposition `depends_on` to `requires` only when the
assessment still supports independent validation failure without the
target. Map `sequences` to `enables` when the later unit still has its
own Product Value; map it to `requires` only when acceptance cannot pass
alone. Do not copy relations that the atomicity checks already rejected
as unnecessary coupling.

## Workflow

### 1. Validate the inputs

Check each input shape, `schema`, `version`, required fields, and source
status. Copy the parent-issue repository, number, URL, Product Capability
Decomposition version and status, Issue Atomicity Assessment version and
status, and combined `unavailable_fields` into
`ProductDependencyGraph.source` without normalizing or inventing values.

If either source `status` is `blocked`, return:

- `status: blocked`
- empty `nodes`, `edges`, `independent_units`, `parallel_groups`,
  `cycles`, and `problematic_cuts`
- `priority_boundary.technical_order_is_priority: false`
- `recommended_next_skill: none`
- `failure.code: blocked_source`

Do not invent nodes about units that were not available.

If the decomposition is not `decomposed` or `partial`, return `blocked`
with `failure.code: unconfirmed_decomposition`.

If the assessment is not `assessed` or `partial`, return `blocked` with
`failure.code: unconfirmed_assessment`.

If repository, number, or URL identities disagree between the
decomposition and the assessment sources, return `blocked` with
`failure.code: identity_mismatch`.

### 2. Account for partial evidence

For `ProductCapabilityDecomposition.status: partial` or
`IssueAtomicityAssessment.status: partial`, inspect every path in
`unavailable_fields`. Continue only when the remaining units and
classifications still support a reliable graph. If an unavailable field
could change a relation kind, a cycle, a parallel group, or a cut
question:

- set `status: partial`
- preserve the missing path
- use `failure.code: incomplete_source`

Do not treat `null` as an empty list. An empty list means the source was
retrieved and contained no entries.

### 3. Inventory candidates as nodes

Create one node per assessment candidate. Copy `unit_id`, `name`, and
`classification` without renaming. Join the matching decomposition unit
for outcome, acceptance, and existing relations. If a candidate has no
matching unit, record a `problematic_cuts` entry of kind `too_large` or
`assumed_dependency` with the missing identity and do not fabricate
outcome text.

Set `independence: constrained` when the node has a hard incoming or
outgoing `blocks` or `requires` edge. Otherwise set `independent`.

Record `too-large` and `over-fragmented` candidates as nodes and as
`problematic_cuts`. Do not place them in `parallel_groups`.

### 4. Classify evidenced relations

For every pair, start from no dependency. Add an edge only when a source
reference supports it. Prefer product evidence. Add a `technical` edge
only when independent validation is impossible.

Reject assumed edges:

- shared parent capability or actor
- shared files, layers, or delivery phases
- "backend before frontend", "tests after implementation", or DTO or
  migration slices of one outcome
- topological convenience
- interview `assumptions` that were not confirmed

If an assumed relation appears in the sources without evidence, record
`problematic_cuts` kind `assumed_dependency` and omit the edge.

Question problematic cuts:

- `cycle` or `mutual_requirement` — the split may be one inseparable
  outcome. Ask whether the units should merge.
- `technical_only_split` — the only distinction is a layer or phase.
  Ask whether the cut is `over-fragmented`.
- `over_fragmented` / `too_large` — copy the assessment classification
  and its `better_cut` as the question. Do not execute the cut.

Detect cycles from directed `blocks` and `requires` edges only.
`enables` and `related` do not form blocking cycles. A cycle is not a
sequence to pick; it is a cut to challenge.

### 5. Identify parallel work without ranking it

Build `parallel_groups` from `atomic-enough` nodes that share no hard
`blocks` or `requires` constraint with one another. Units in the same
group can proceed in parallel. List `independent_units` as every node
whose `independence` is `independent`.

Do not order groups by technical depth, file ownership, or
implementation convenience. Do not select a slice because it has no
incoming hard edge. Product or interview priority remains outside this
Skill.

Set:

```yaml
priority_boundary:
  technical_order_is_priority: false
  guidance: "Graph order is a sequencing constraint only. Product or interview priority remains the selection input; do not rank slices solely by technical order."
```

### 6. Choose status and one follow-up

Set status as follows:

- `graphed` only when every supplied candidate has one node, every
  emitted edge has evidence, cycles and cuts are recorded rather than
  guessed, and `technical_order_is_priority` is `false`.
- `partial` when graphing is possible but a material relation, source
  evidence, or cut question is incomplete.
- `blocked` when a required handoff cannot be used.

Choose exactly one recommendation:

- `prioritize-product-issues` — more than one `atomic-enough` unit
  remains and should be ranked with the user before a slice is drafted.
  This is the usual next step after an assessed refine graph with
  multiple units.
- `rewrite-github-issue` — the selected unit, or the only
  `atomic-enough` unit, is classified and not waiting on a confirmed
  cut. Record its evidenced dependencies in the draft. Do not choose
  that unit because it is first in technical order.
- `assess-issue-atomicity` — a problematic cut needs a confirmed
  reclassification.
- `decompose-product-capabilities` — a cycle, mutual requirement, or
  `too-large` candidate still needs a different split.
- `structure-issue` — the graph should be organized into an
  `IssueAssessment` without a GitHub rewrite.
- `none` — the source is blocked, a cut is pending confirmation, or no
  follow-up is justified.

Do not invoke the recommendation automatically. When more than one
`atomic-enough` unit remains, recommend `prioritize-product-issues`
instead of ranking slices by technical order. Do not prefer a
technically earlier unit.

## Output contract

First give a concise summary in the conversation language, including a
directed mermaid graph of `blocks`, `requires`, and `enables` edges and
undirected `related` links. Then return one English
`ProductDependencyGraph` version-1 handoff using the field names from
[`ProductDependencyGraph`](../../shared/schemas/ProductDependencyGraph.yaml):

```yaml
status: graphed
source:
  repository: octo-org/widgets
  number: 42
  url: https://github.com/octo-org/widgets/issues/42
  product_capability_decomposition_version: 1
  product_capability_decomposition_status: decomposed
  issue_atomicity_assessment_version: 1
  issue_atomicity_assessment_status: assessed
  unavailable_fields: []
nodes:
  - unit_id: unit-invoice-csv-export
    name: Export current-month invoices as CSV
    classification: atomic-enough
    independence: independent
    evidence: "candidates[unit-invoice-csv-export]"
  - unit_id: unit-saved-payment-method
    name: Save a payment method for later invoices
    classification: atomic-enough
    independence: independent
    evidence: "candidates[unit-saved-payment-method]"
edges: []
independent_units:
  - unit-invoice-csv-export
  - unit-saved-payment-method
parallel_groups:
  - id: parallel-billing-self-service
    unit_ids:
      - unit-invoice-csv-export
      - unit-saved-payment-method
    evidence: "No product or mandatory technical constraint between units[unit-invoice-csv-export] and units[unit-saved-payment-method]."
cycles: []
problematic_cuts: []
priority_boundary:
  technical_order_is_priority: false
  guidance: "Graph order is a sequencing constraint only. Product or interview priority remains the selection input; do not rank slices solely by technical order."
recommended_next_skill: prioritize-product-issues
failure: null
```

Use `failure: null` only for `graphed` results.

When a hard product prerequisite is evidenced, emit one directed edge
instead of packing the units:

```yaml
edges:
  - from_id: unit-overdue-reminder
    to_id: unit-issue-invoice
    kind: requires
    domain: product
    directed: true
    evidence: "units[unit-overdue-reminder].independent_acceptance"
    rationale: "Overdue reminders cannot be accepted unless an issued invoice can exist to become overdue."
```

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No `ProductCapabilityDecomposition` or no `IssueAtomicityAssessment` handoff is available. | Ask one concise handoff question or return `blocked` if it cannot be supplied. |
| `invalid_input` | Required fields are missing or have invalid types. | `blocked`; do not graph guessed values. |
| `unsupported_version` | A required handoff is not version 1. | `blocked`; request a compatible handoff. |
| `blocked_source` | A source handoff has `status: blocked`. | `blocked`; preserve known identity and return no fabricated nodes. |
| `incomplete_source` | A partial decomposition or assessment lacks material evidence. | `partial`; identify unavailable fields and uncertainty. |
| `identity_mismatch` | The decomposition and atomicity assessment identify different issues. | `blocked`; do not merge unrelated sources. |
| `unconfirmed_assessment` | The atomicity assessment is not `assessed` or `partial`. | `blocked`; require classified candidates. |
| `unconfirmed_decomposition` | The decomposition is not `decomposed` or `partial`. | `blocked`; require confirmed units. |
| `graph_failure` | An unexpected local failure prevents a reliable graph. | `blocked`; describe the operation without exposing secrets or raw credentials. |

A failure message must not expose tokens, credentials, private keys, `.env`
contents, or unnecessary raw CLI output.
