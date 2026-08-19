---
name: assess-issue-atomicity
description: Assess each proposed sub-issue candidate from one version-1 ProductCapabilityDecomposition for atomicity across single outcome, scope, independent understandability, testability, domain behaviors, hidden requirements, and unnecessary coupling, then return IssueAtomicityAssessment v1 with a classification and better cut when needed. Use automatically after decomposition or when assessing atomic issue cuts; do not use for decomposition, dependency graphing, prioritization, complete draft composition (compose-product-sub-issues), issue rewriting, sub-issue creation, or publication.
---

# Assess Issue Atomicity

Assess each proposed sub-issue candidate for atomicity. Do not invent a new
split. Classify every unit from the supplied decomposition, justify the
classification, and propose a better cut only when the candidate is not
atomic enough.

Consume one version-1 `ProductCapabilityDecomposition`. Return the version-1
`IssueAtomicityAssessment` handoff. Do not rewrite the issue, decompose
capabilities, draft acceptance criteria, or create GitHub issues.

`issue-agent` mode `refine` uses this assessment after
`decompose-product-capabilities` so `build-product-dependency-graph` can
map evidenced dependencies, `prioritize-product-issues` can rank those
units with the user, and `rewrite-github-issue` drafts only an
`atomic-enough` selected unit. After prioritization,
`compose-product-sub-issues` can compose the complete draft set.

Technical implementation steps are not a sufficient reason for additional
Product Issues.

## Boundaries

- Keep questions and explanations in the user's conversation language.
- Keep the structured handoff and all newly authored report text in English.
  Preserve short exact source excerpts when they are needed as evidence.
- Require a `ProductCapabilityDecomposition` handoff. Do not silently load or
  re-fetch an issue, infer identity from the workspace, or invoke
  `load-github-issue` or `decompose-product-capabilities` automatically.
- Do not edit GitHub, repository files, labels, comments, issue state, or
  pull requests. Do not create, propose as a write, split, or publish
  sub-issues. Assessment is diagnosis only.
- Apply
  [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc)
  as the atomicity raster. Do not treat technical components, layers, APIs,
  UI, tests, migrations, DTOs, or `ImplementationPlan` steps as Product
  Issues.
- Do not invent essential product decisions or treat decomposition gaps as
  confirmed requirements. Do not turn non-goals into candidates.
- Do not re-run decomposition. Record a better cut as a proposal. Use
  `decompose-product-capabilities` when a `too-large` candidate still needs
  splitting.
- Do not turn assessment into a requirements interview. Ask at most one
  concise question only when the required handoff is missing.
- Do not draft replacement issue text, publish anything, or start a follow-up
  Skill. Recommend at most one next Skill.
- Do not compose complete sub-issue drafts here; that belongs to
  `compose-product-sub-issues` after atomicity and product priority are
  confirmed.
- Use `decompose-product-capabilities` to produce the candidate units. Use
  `build-product-dependency-graph` to map evidenced product and mandatory
  technical dependencies among classified candidates. Use
  `prioritize-product-issues` to rank more than one `atomic-enough` unit
  with the user. Use
  `rewrite-github-issue` to draft one selected `atomic-enough` unit. Use
  `structure-issue` to organize an `IssueAssessment`. Use
  `assess-issue-quality` for the six-dimension 1–5 rubric.

## Input contract

The required input is one `ProductCapabilityDecomposition` version 1 handoff:

```yaml
product_capability_decomposition:
  schema: ProductCapabilityDecomposition
  version: 1
  status: decomposed | partial
```

The decomposition must contain the required fields from
[`ProductCapabilityDecomposition`](../../shared/schemas/ProductCapabilityDecomposition.yaml).

Treat `ProductCapabilityDecomposition.status: decomposed` as confirmed units.
A `partial` decomposition may continue only when remaining gaps cannot change
a classification or better cut. Explicit gaps already recorded in that
decomposition remain documented; they do not reopen decomposition here.

If the required handoff is absent, ask the user to provide the
`ProductCapabilityDecomposition`. Do not claim that assessment ran without
it. If a supplied object is malformed or has an unsupported version, return a
`blocked`
[`IssueAtomicityAssessment`](../../shared/schemas/IssueAtomicityAssessment.yaml)
result.

## Checks

Assess every item in `units` as one candidate. Use concise source references
that let a reviewer locate the evidence:

- `units[<id>]`
- `units[<id>].observable_outcome`
- `units[<id>].independent_acceptance`
- `relations[<from_id>-><to_id>]`
- `gaps[<kind>]`

Score each check independently as `pass`, `fail`, or `uncertain`, with one
evidence-backed finding:

- **Single outcome** — exactly one clearly bounded, independently
  understandable outcome. Fail when the unit mixes journeys, audiences, or
  value propositions, or hides multiple outcomes behind "and", "also",
  "including", or a bundled feature list.
- **Scope** — the in-scope work, non-goals, and stopping point fit one
  product increment. Fail when the unit is over-broad, mixes discovery with
  delivery, or leaves no credible review boundary.
- **Independent understandability** — a reader can understand the unit
  without reconstructing intent from a parent issue or a sibling unit.
- **Testability** — acceptance can pass or fail for this one outcome without
  sibling delivery, unless a documented inseparable dependency makes
  independent validation impossible.
- **Number of domain behaviors** — count independently acting domain
  behaviors, actors, or business rules. Record the integer `count`. Pass
  only when the count is `1`. Fail when the count is `0` or greater than
  `1`.
- **Hidden requirements** — fail when additional product requirements are
  implied rather than stated, or bundled behind compound wording.
- **Unnecessary coupling** — fail when the unit is glued to a sibling by
  layer, phase, label, or technical task rather than by a documented
  inseparable dependency.

Technical implementation steps are not a sufficient reason for additional
Product Issues. A candidate whose only remaining distinction is "add a DTO",
"write tests", "prepare a migration", or a backend/frontend/test split of
one outcome fails independent understandability, testability, or unnecessary
coupling and is `over-fragmented`.

## Classification

Assign exactly one classification per candidate:

- `too-large` — more than one independent user- or stakeholder-visible
  outcome, mixed journeys or audiences, hidden compound requirements,
  more than one domain behavior, or completion that cannot be validated as
  one result.
- `over-fragmented` — no distinct product value, understanding or acceptance
  requires a sibling, one inseparable outcome is split into labels, layers,
  or phases, or the slices would have to ship together to be valuable or
  testable. Technical-only splits belong here.
- `atomic-enough` — one independently understandable outcome, acceptance can
  pass or fail without sibling delivery, shipping the slice leaves a
  complete increment, remaining work can wait, and dependencies are
  explicit.

When signals conflict, classify `over-fragmented` when the candidate has no
independent product value or is only a technical slice of one outcome.
Classify `too-large` when the candidate still contains multiple independent
product outcomes. Do not emit both.

Set `better_cut` as follows:

- `too-large` — `kind: split` with a named sibling-candidate proposal.
- `over-fragmented` — `kind: merge` with the sibling or parent outcome that
  restores independent product value.
- `atomic-enough` — `better_cut: null`. Do not propose an alternative cut.

Record the proposal only. Do not rewrite units, merge them, or create GitHub
issues.

## Workflow

### 1. Validate the input

Check the input shape, `schema`, `version`, required fields, and source
status. Copy the parent-issue repository, number, URL, Product Capability
Decomposition version, Product Capability Decomposition status, and
`unavailable_fields` into `IssueAtomicityAssessment.source` without
normalizing or inventing values.

If the source `status` is `blocked`, return:

- `status: blocked`
- empty `candidates`
- `recommended_next_skill: none`
- `failure.code: blocked_source`

Do not invent candidates about units that were not available.

If the decomposition is not `decomposed` or `partial`, return `blocked` with
`failure.code: unconfirmed_decomposition`. Do not assess unconfirmed units.

### 2. Account for partial evidence

For `ProductCapabilityDecomposition.status: partial`, inspect every path in
`unavailable_fields`. Continue only when the remaining units still support a
reliable classification. If an unavailable field could change a check, a
classification, or a better cut:

- set `status: partial`
- preserve the missing path
- use `failure.code: incomplete_source`

Do not treat `null` as an empty list. An empty list means the source was
retrieved and contained no entries.

### 3. Assess every candidate

Apply [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc).
For each unit, run the seven checks, assign one classification, write the
rationale, and set `better_cut`. Copy `unit_id` and `name` from the unit
without renaming it.

Use `relations` as evidence for coupling and independent validation. Do not
fill decomposition `gaps` with invented behavior. A `compound_unit` gap is
evidence that the candidate is `too-large` unless the remaining distinction
is only technical.

Do not create GitHub sub-issues for remaining candidates.

### 4. Choose status and one follow-up

Set status as follows:

- `assessed` only when every supplied unit has one classification, every
  check has a verdict, and remaining uncertainty is documented rather than
  guessed.
- `partial` when assessment is possible but a material check, source
  evidence, or better cut is incomplete.
- `blocked` when a required handoff cannot be used.

Choose exactly one recommendation:

- `build-product-dependency-graph` — more than one classified candidate
  exists and should be graphed before a slice is drafted. This is the
  usual next step after an assessed or partial refine assessment with
  multiple units.
- `rewrite-github-issue` — the selected unit, or the only unit, is
  `atomic-enough`.
- `decompose-product-capabilities` — at least one candidate is `too-large`.
- `structure-issue` — the classified units should be organized into an
  `IssueAssessment` without a GitHub rewrite.
- `none` — the source is blocked, candidates are mixed or
  `over-fragmented` pending a confirmed merge, or no follow-up is
  justified.

Do not invoke the recommendation automatically. When more than one
classified candidate exists, recommend `build-product-dependency-graph`
before asking which atomic slice to publish.

## Output contract

First give a concise summary in the conversation language. Then return one
English `IssueAtomicityAssessment` version-1 handoff using the field names
from
[`IssueAtomicityAssessment`](../../shared/schemas/IssueAtomicityAssessment.yaml):

```yaml
status: assessed
source:
  repository: octo-org/widgets
  number: 42
  url: https://github.com/octo-org/widgets/issues/42
  product_capability_decomposition_version: 1
  product_capability_decomposition_status: decomposed
  unavailable_fields: []
candidates:
  - unit_id: unit-invoice-csv-export
    name: Export current-month invoices as CSV
    classification: atomic-enough
    checks:
      single_outcome:
        verdict: pass
        finding: "One billing-user CSV export outcome; units[unit-invoice-csv-export].observable_outcome"
      scope:
        verdict: pass
        finding: "In-scope work is this month's invoice download; saved payment methods stay out."
      independent_understandability:
        verdict: pass
        finding: "A reader can understand CSV export without the payment-method sibling."
      testability:
        verdict: pass
        finding: "Download succeeds or fails without saved payment methods."
      domain_behavior_count:
        count: 1
        verdict: pass
        finding: "One domain behavior: export this month's invoices as CSV."
      hidden_requirements:
        verdict: pass
        finding: "No bundled and/also/including requirements beyond empty-month CSV."
      unnecessary_coupling:
        verdict: pass
        finding: "No layer or phase coupling to saved payment methods."
    rationale: "One independently understandable export outcome with acceptance that can pass or fail alone."
    better_cut: null
    evidence: "units[unit-invoice-csv-export]"
  - unit_id: unit-saved-payment-method
    name: Save a payment method for later invoices
    classification: atomic-enough
    checks:
      single_outcome:
        verdict: pass
        finding: "One billing-user saved-payment-method outcome."
      scope:
        verdict: pass
        finding: "Saving and reusing one payment method is the stopping point."
      independent_understandability:
        verdict: pass
        finding: "The outcome is understandable without CSV export."
      testability:
        verdict: pass
        finding: "Saving one method succeeds even if CSV export is not delivered."
      domain_behavior_count:
        count: 1
        verdict: pass
        finding: "One domain behavior: store and reuse one payment method."
      hidden_requirements:
        verdict: pass
        finding: "No hidden tax, dunning, or export requirements."
      unnecessary_coupling:
        verdict: pass
        finding: "No backend/frontend split of the same outcome."
    rationale: "One independently valuable payment-method increment with its own acceptance."
    better_cut: null
    evidence: "units[unit-saved-payment-method]"
recommended_next_skill: build-product-dependency-graph
failure: null
```

Use `failure: null` only for `assessed` results.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No `ProductCapabilityDecomposition` handoff is available. | Ask one concise handoff question or return `blocked` if it cannot be supplied. |
| `invalid_input` | Required fields are missing or have invalid types. | `blocked`; do not assess guessed values. |
| `unsupported_version` | The required handoff is not version 1. | `blocked`; request a compatible handoff. |
| `blocked_source` | The source handoff has `status: blocked`. | `blocked`; preserve known identity and return no fabricated candidates. |
| `incomplete_source` | A partial decomposition lacks material evidence. | `partial`; identify unavailable fields and uncertainty. |
| `unconfirmed_decomposition` | The decomposition is not `decomposed` or `partial`. | `blocked`; require confirmed units. |
| `assessment_failure` | An unexpected local failure prevents a reliable assessment. | `blocked`; describe the operation without exposing secrets or raw credentials. |

A failure message must not expose tokens, credentials, private keys, `.env`
contents, or unnecessary raw CLI output.
