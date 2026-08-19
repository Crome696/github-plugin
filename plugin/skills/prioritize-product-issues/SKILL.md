---
name: prioritize-product-issues
description: Prioritize classified product sub-issue candidates with the user using Product Value, user impact, urgency, risk, learning value, and dependencies; recommend MoSCoW classes, record confirmed decisions and sequence divergences, and return a version-1 ProductIssuePrioritization. Use automatically after a ProductDependencyGraph or when prioritizing atomic slices; do not use for decomposition, atomicity, dependency graphing, complete draft composition (compose-product-sub-issues), issue rewriting, sub-issue creation, or publication.
---

# Prioritize Product Issues

Prioritize sub-issue candidates together with the user using Product Value,
user impact, urgency, risk, learning value, and dependencies. The AI may
recommend priorities, but must not autonomously set essential product
prioritization. Support at least `must`, `should`, `could`, and `later`.
Consider the Dependency Graph and mark cases where product priority and
required implementation order diverge. Document rationales and explicit user
decisions.

Consume one version-1 `ProductDependencyGraph`. Return the version-1
`ProductIssuePrioritization` handoff. Do not rewrite the issue, regraph
dependencies, reclassify atomicity, or create GitHub issues.

`issue-agent` mode `refine` uses this prioritization after
`build-product-dependency-graph` so `rewrite-github-issue` drafts one
selected `atomic-enough` unit from a confirmed product class rather than
from technical graph order. Use `compose-product-sub-issues` when the caller
needs complete drafts for all confirmed atomic units; that Skill does not
publish them.

## Boundaries

- Keep questions and explanations in the user's conversation language.
- Keep the structured handoff and all newly authored report text in English.
  Preserve short exact source excerpts when they are needed as evidence.
- Require a `ProductDependencyGraph` handoff. Do not silently load or
  re-fetch an issue, infer identity from the workspace, or invoke
  `load-github-issue` or `build-product-dependency-graph` automatically.
- A supplied version-1 `ProductCapabilityDecomposition` is optional outcome
  and acceptance evidence. A supplied version-1 `ProductInterview` is
  optional confirmed-priority evidence. Do not treat interview `assumptions`
  or `open_questions` as confirmed classes. Do not invent missing optional
  handoffs.
- Do not edit GitHub, repository files, labels, comments, issue state, or
  pull requests. Do not create, propose as a write, split, or publish
  sub-issues. Prioritization is diagnosis and a recorded user decision only.
- Apply
  [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc),
  [`product-interview-policy.mdc`](../../rules/product-interview-policy.mdc),
  and [`github-evidence.mdc`](../../rules/github-evidence.mdc). Do not derive
  product priority from graph order, topological sort, or technical
  sequence.
- Do not invent essential product decisions. A recommendation is not a
  confirmation. Set `confirmed_class` only after an explicit user decision
  or an already confirmed interview priority that names that unit.
- Do not treat `enables` or `related` as hard ordering constraints. Hard
  predecessors and successors come only from directed `blocks` and
  `requires` edges.
- Ask at most one or two critical questions per round. Skip evidenced or
  already confirmed priorities. Challenge contradictions, including a `must`
  that cannot ship before a lower-class hard predecessor.
- Do not draft replacement issue text, publish anything, or start a follow-up
  Skill. Recommend at most one next Skill.
- Use `compose-product-sub-issues` for the complete set of standalone drafts.
  Use `rewrite-github-issue` only for the one selected slice handled by
  `issue-agent`.
- Use `build-product-dependency-graph` when the graph is incomplete or a
  cycle or cut is still open. Use `assess-issue-atomicity` or
  `decompose-product-capabilities` when an ineligible cut still needs a
  confirmed split or merge. Use `rewrite-github-issue` to draft one selected
  confirmed `atomic-enough` unit. Use `structure-issue` to organize an
  `IssueAssessment`.

## Input contract

The required input is one `ProductDependencyGraph` version 1 handoff:

```yaml
product_dependency_graph:
  schema: ProductDependencyGraph
  version: 1
  status: graphed | partial
```

The graph must contain the required fields from
[`ProductDependencyGraph`](../../shared/schemas/ProductDependencyGraph.yaml).

Optional identity-checked inputs:

```yaml
product_capability_decomposition:
  schema: ProductCapabilityDecomposition
  version: 1
  status: decomposed | partial
product_interview:
  schema: ProductInterview
  version: 1
  status: complete
```

Treat `ProductDependencyGraph.status: graphed` as confirmed nodes and
edges. A `partial` graph may continue only when remaining gaps cannot
change a candidate, a hard constraint, or a sequence divergence. Explicit
gaps already recorded remain documented; they do not reopen graphing here.

If the required handoff is absent, ask the user to provide the
`ProductDependencyGraph`. Do not claim that prioritization ran without it.
If a supplied object is malformed or has an unsupported version, return a
`blocked`
[`ProductIssuePrioritization`](../../shared/schemas/ProductIssuePrioritization.yaml)
result.

## Classes and dimensions

Eligible classes:

- `must` — this run cannot deliver the parent outcome without the slice,
  or the user confirmed it as the current product commitment.
- `should` — independently valuable and expected soon, but the parent
  outcome can still ship a thinner increment without it.
- `could` — useful Product Value that can wait without blocking the
  current increment.
- `later` — deferred follow-up, future context, or explicitly out of the
  current increment.

Rank only `atomic-enough` nodes as eligible. Record `too-large` and
`over-fragmented` nodes as `ineligible` with `recommended_class: null` and
`confirmed_class: null`. Do not dress an ineligible cut as a MoSCoW slice.

Score each dimension as `high`, `medium`, `low`, or `unknown`:

- `product_value` — independently understandable outcome and acceptance.
- `user_impact` — who feels the change and how strongly.
- `urgency` — time sensitivity already evidenced or confirmed.
- `risk` — product or delivery risk of delaying or shipping the slice.
- `learning_value` — how much the slice reduces material product
  uncertainty.
- `dependencies` — not a high/medium/low score. Record `independent` or
  `constrained` plus hard predecessors and successors from `blocks` and
  `requires` only.

Use concise source references:

- `nodes[<id>]`
- `edges[<from_id>-><to_id>]`
- `independent_units`
- `parallel_groups[<id>]`
- `units[<id>].observable_outcome`
- `units[<id>].independent_acceptance`
- `confirmed_decisions`
- `coverage.priorities`

## Workflow

### 1. Validate the inputs

Check each input shape, `schema`, `version`, required fields, and source
status. Copy the parent-issue repository, number, URL, Product Dependency
Graph version and status, optional decomposition and interview versions and
statuses, and combined `unavailable_fields` into
`ProductIssuePrioritization.source` without normalizing or inventing values.

If the graph `status` is `blocked`, return:

- `status: blocked`
- empty `candidates` and `sequence_divergences`
- `selected_unit_id: null`
- `recommended_next_skill: none`
- `failure.code: blocked_source`

Do not invent candidates about units that were not available.

If the graph is not `graphed` or `partial`, return `blocked` with
`failure.code: unconfirmed_graph`.

If a supplied optional handoff identifies a different repository, number, or
URL, return `blocked` with `failure.code: identity_mismatch`.

### 2. Account for partial evidence

For `ProductDependencyGraph.status: partial`, inspect every path in
`unavailable_fields`. Continue only when remaining nodes and hard edges
still support a reliable ranking. If an unavailable field could change a
class, a hard predecessor, or a divergence:

- set `status: partial`
- preserve the missing path
- use `failure.code: incomplete_source`

Do not treat `null` as an empty list. An empty list means the source was
retrieved and contained no entries.

### 3. Inventory candidates

Create one candidate per graph node. Copy `unit_id`, `name`, and
`classification` without renaming. Join the matching decomposition unit
for outcome and acceptance when that optional handoff is present. If a
node has no matching unit, keep the graph name and do not fabricate
outcome text.

Set `eligibility: eligible` only for `atomic-enough`. Set
`eligibility: ineligible` for `too-large` and `over-fragmented`.

Copy hard predecessors and successors from directed `blocks` and
`requires` edges. Copy node `independence` into
`dimensions.dependencies.independence`. Do not treat `enables` or
`related` as hard constraints.

### 4. Recommend, then confirm with the user

Recommend a MoSCoW class and dimension scores from evidenced product
topics. Record `decision.source: recommended` until the user confirms.
Do not copy graph depth, parallel-group membership, or "no incoming hard
edge" into `confirmed_class`.

Reuse a confirmed interview priority only when it clearly names this unit
or its outcome. Parent-level interview priority that does not distinguish
siblings stays a recommendation, not a confirmation.

Show the recommendation in the conversation language: class, short
rationale, hard constraints, and any divergence. Ask the user to confirm
or override. Set `confirmed_class` and `decision.source: user` only after
that explicit decision, or `decision.source: interview` when an already
confirmed interview priority applies. Keep `confirmed_class: null` while
the user has not decided.

Ineligible candidates stay classless. Point the user at the better cut
instead of asking for a MoSCoW class.

### 5. Flag sequence divergences

Create a `sequence_divergences` entry when an eligible unit's product
class is higher than a hard predecessor's class, including a confirmed
`must` that `requires` a `should`, `could`, or `later` predecessor, or a
predecessor that still `blocks` it.

Do not silently raise the predecessor or lower the successor to make the
graph look consistent. Ask the user to choose:

- `implement_predecessor_first` — publish the lower-class prerequisite in
  this run
- `delay_must` — keep the higher class and delay that slice
- `split_revisit` — send the cut back to atomicity or decomposition

Leave `user_decision: null` until that choice exists. `enables` and
`related` never create a divergence.

### 6. Choose status, selected slice, and one follow-up

Set status as follows:

- `prioritized` only when every supplied node has one candidate, every
  eligible candidate has a `confirmed_class`, ineligible candidates stay
  classless, and every sequence divergence has a `user_decision`.
- `partial` when ranking is possible but a confirmation, source field, or
  divergence decision is incomplete.
- `blocked` when a required handoff cannot be used.

Set `selected_unit_id` only after the user explicitly chooses which
eligible slice to publish in this run. A confirmed `must` is not an
automatic selection when more than one `must` remains or a divergence is
unresolved. Keep `selected_unit_id: null` until that choice exists.
`issue-agent` still publishes exactly one selected issue per run.

Choose exactly one recommendation:

- `compose-product-sub-issues` — the ranking is `prioritized` and the caller
  needs complete standalone drafts for all eligible confirmed units.
- `rewrite-github-issue` — `selected_unit_id` names an eligible unit with
  a confirmed class, no open divergence blocks that slice, and the caller
  explicitly wants the one-slice `issue-agent` rewrite.
- `build-product-dependency-graph` — a cycle, cut, or incomplete hard
  edge still needs graphing.
- `assess-issue-atomicity` — an ineligible candidate needs a confirmed
  reclassification.
- `decompose-product-capabilities` — a `too-large` candidate or
  `split_revisit` decision still needs a different cut.
- `structure-issue` — the ranking should be organized into an
  `IssueAssessment` without a GitHub rewrite.
- `none` — the source is blocked, confirmations are pending, more than
  one eligible unit remains without a selected slice, or no follow-up is
  justified.

Do not invoke the recommendation automatically. Do not prefer a
technically earlier unit.

## Output contract

First give a concise summary in the conversation language, including the
recommended versus confirmed classes and any sequence divergence. Then
return one English `ProductIssuePrioritization` version-1 handoff using
the field names from
[`ProductIssuePrioritization`](../../shared/schemas/ProductIssuePrioritization.yaml):

```yaml
status: prioritized
source:
  repository: octo-org/widgets
  number: 42
  url: https://github.com/octo-org/widgets/issues/42
  product_dependency_graph_version: 1
  product_dependency_graph_status: graphed
  product_capability_decomposition_version: 1
  product_capability_decomposition_status: decomposed
  product_interview_version: 1
  product_interview_status: complete
  unavailable_fields: []
candidates:
  - unit_id: unit-invoice-csv-export
    name: Export current-month invoices as CSV
    classification: atomic-enough
    eligibility: eligible
    recommended_class: should
    confirmed_class: must
    dimensions:
      product_value:
        score: high
        rationale: "Billing users get an independently acceptable current-month CSV export."
        evidence: "units[unit-invoice-csv-export].observable_outcome"
      user_impact:
        score: high
        rationale: "Finance operators currently copy invoice rows by hand."
        evidence: "nodes[unit-invoice-csv-export]"
      urgency:
        score: high
        rationale: "Month-end close is the confirmed current commitment."
        evidence: "confirmed_decisions"
      risk:
        score: medium
        rationale: "Delaying export leaves a manual close process in place."
        evidence: "units[unit-invoice-csv-export].independent_acceptance"
      learning_value:
        score: low
        rationale: "The export outcome is already understood; remaining work is delivery."
        evidence: "units[unit-invoice-csv-export].independent_acceptance"
      dependencies:
        independence: independent
        hard_predecessors: []
        hard_successors: []
        rationale: "No hard blocks or requires edge constrains this unit."
        evidence: "independent_units"
    rationale: "Independent month-end export is the confirmed current product commitment."
    decision:
      source: user
      summary: "User confirmed must because finance needs the month-end CSV export now."
    evidence: "nodes[unit-invoice-csv-export]"
  - unit_id: unit-saved-payment-method
    name: Save a payment method for later invoices
    classification: atomic-enough
    eligibility: eligible
    recommended_class: could
    confirmed_class: later
    dimensions:
      product_value:
        score: medium
        rationale: "Saving a payment method is independently valuable and acceptable."
        evidence: "units[unit-saved-payment-method].observable_outcome"
      user_impact:
        score: medium
        rationale: "Repeat billers benefit, but first-month close does not require it."
        evidence: "nodes[unit-saved-payment-method]"
      urgency:
        score: low
        rationale: "No evidenced deadline for stored payment methods."
        evidence: "coverage.priorities"
      risk:
        score: low
        rationale: "Deferring stored methods does not block CSV export acceptance."
        evidence: "parallel_groups[parallel-billing-self-service]"
      learning_value:
        score: medium
        rationale: "Payment-method consent and reuse rules are still lightly specified."
        evidence: "units[unit-saved-payment-method].independent_acceptance"
      dependencies:
        independence: independent
        hard_predecessors: []
        hard_successors: []
        rationale: "The graph records no hard constraint with CSV export."
        evidence: "independent_units"
    rationale: "Useful self-service follow-up that can wait behind month-end export."
    decision:
      source: user
      summary: "User confirmed later; stored payment methods are follow-up, not this increment."
    evidence: "nodes[unit-saved-payment-method]"
sequence_divergences: []
selected_unit_id: unit-invoice-csv-export
recommended_next_skill: compose-product-sub-issues
failure: null
```

Use `failure: null` only for `prioritized` results.

When a hard product prerequisite has a lower class than its successor,
record the divergence instead of reordering classes:

```yaml
sequence_divergences:
  - unit_id: unit-overdue-reminder
    product_class: must
    predecessor_id: unit-issue-invoice
    predecessor_class: should
    relation: requires
    evidence: "edges[unit-overdue-reminder->unit-issue-invoice]"
    implication: "The must reminder cannot be accepted before the should invoice exists."
    user_decision: implement_predecessor_first
```

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No `ProductDependencyGraph` handoff is available. | Ask one concise handoff question or return `blocked` if it cannot be supplied. |
| `invalid_input` | Required fields are missing or have invalid types. | `blocked`; do not rank guessed values. |
| `unsupported_version` | A required or supplied optional handoff is not version 1. | `blocked`; request a compatible handoff. |
| `blocked_source` | The graph has `status: blocked`. | `blocked`; preserve known identity and return no fabricated candidates. |
| `incomplete_source` | A partial graph lacks material nodes or hard edges. | `partial`; identify unavailable fields and uncertainty. |
| `identity_mismatch` | An optional decomposition or interview identifies a different issue. | `blocked`; do not merge unrelated sources. |
| `unconfirmed_graph` | The graph is not `graphed` or `partial`. | `blocked`; require classified graph nodes. |
| `prioritization_failure` | An unexpected local failure prevents a reliable ranking. | `blocked`; describe the operation without exposing secrets or raw credentials. |

A failure message must not expose tokens, credentials, private keys, `.env`
contents, or unnecessary raw CLI output.
