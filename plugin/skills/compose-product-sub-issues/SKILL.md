---
name: compose-product-sub-issues
description: Compose complete English GitHub sub-issue drafts from confirmed atomic product units, including parent reference, problem and outcome, scope, behavior, acceptance criteria, dependencies, priority, constraints, and traceability. Use automatically after ProductIssuePrioritization when a user asks to turn confirmed atomic units into independent sub-issue drafts; do not create, publish, or edit GitHub issues.
---

# Compose Product Sub-Issues

Turn confirmed atomic product units into a complete set of independent
GitHub sub-issue drafts. Every draft must stand on its own after publication:
the later `prepare-issue` workflow must be able to analyze it without
reconstructing requirements from the parent issue or sibling drafts.

Consume one version-1 `ProductCapabilityDecomposition` and one version-1
`ProductIssuePrioritization`. Optionally consume matching
`ProductDependencyGraph`, `ProductInterview`, and `LoadedIssue` handoffs.
Return one version-2 `ProductSubIssueDrafts` handoff. Never create, edit, or
publish GitHub issues.

This Skill drafts every eligible unit with a confirmed product class. It does
not reduce the result to `selected_unit_id`; that field identifies one
possible publication choice for the separate one-issue workflow.

## Boundaries

- Match questions and explanations to the user's conversation language.
- Keep the structured handoff, titles, bodies, section text, and all newly
  authored durable artifact text in English.
- Require the decomposition and prioritization handoffs. Do not silently load
  an issue, infer identity from the workspace, or invoke another Skill.
- Verify the parent repository, issue number, and URL across every supplied
  source. Return `identity_mismatch` instead of joining unrelated sources.
- Do not edit GitHub, repository files, labels, comments, issue state, or pull
  requests. Do not call `create-github-issue`, `rewrite-github-issue`, or
  `prepare-issue`.
- Apply [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc)
  and [`github-evidence.mdc`](../../rules/github-evidence.mdc).
- Do not turn technical components, layers, APIs, tests, migrations, or
  `ImplementationPlan` steps into issue scope or acceptance criteria.
- Do not invent actors, outcomes, behaviors, business rules, variants,
  edge-case handling, priorities, dependencies, constraints, or non-goals.
- Do not treat `ProductInterview.assumptions` or `open_questions` as
  requirements. Use only confirmed decisions and source evidence.
- Do not treat a recommended priority as a confirmed priority. A draft
  requires `confirmed_class`.
- Draft one issue per eligible unit. Do not combine sibling units, even when
  they share a capability, actor, dependency, or parent.
- Keep `enables` and `related` relations contextual. Only `blocks` and
  `requires`, or explicitly recorded `hard_predecessors` and
  `hard_successors`, are hard dependencies.
- Do not produce an `IssueDraft` adapter, publication authorization, or any
  other write payload. Record exact `labels.add`, `labels.remove`, and
  `labels.preserve` operations as canonical draft content; recording them does
  not authorize a label write.

## Input contract

The required inputs are:

```yaml
product_capability_decomposition:
  schema: ProductCapabilityDecomposition
  version: 1
  status: decomposed | partial
product_issue_prioritization:
  schema: ProductIssuePrioritization
  version: 1
  status: prioritized | partial
```

Optional inputs are identity-checked before use:

```yaml
product_dependency_graph:
  schema: ProductDependencyGraph
  version: 1
  status: graphed | partial
product_interview:
  schema: ProductInterview
  version: 1
  status: complete | needs_clarification | blocked
loaded_issue:
  schema: LoadedIssue
  version: 1
  status: loaded | partial | blocked
```

The mandatory source handoffs must contain the required fields from
[`ProductCapabilityDecomposition`](../../shared/schemas/ProductCapabilityDecomposition.yaml)
and
[`ProductIssuePrioritization`](../../shared/schemas/ProductIssuePrioritization.yaml).
If a required handoff is absent, malformed, unsupported, or blocked, return a
blocked `ProductSubIssueDrafts` result without fabricated drafts.

## Draft eligibility and evidence

Use the prioritization candidate as the eligibility record:

- Emit a draft only when `classification: atomic-enough`,
  `eligibility: eligible`, and `confirmed_class` is one of `must`, `should`,
  `could`, or `later`.
- Copy `confirmed_class`; never promote `recommended_class`.
- Preserve candidates with `too-large`, `over-fragmented`, missing units, or
  null `confirmed_class` in `omitted_units` with a reason and evidence.
- Join each eligible candidate to exactly one decomposition unit by `unit_id`.
  A missing or ambiguous match is not a reason to invent a unit.
- A non-null `selected_unit_id` does not limit composition. Compose every
  eligible confirmed unit so the caller receives the complete draft set.

Use concise, auditable source references such as:

- `source`
- `units[<unit_id>]`
- `units[<unit_id>].observable_outcome`
- `units[<unit_id>].independent_acceptance`
- `units[<unit_id>].parent_capability_id`
- `units[<unit_id>].assigned_requirement_ids`
- `candidates[<unit_id>].decision`
- `candidates[<unit_id>].dimensions.dependencies`
- `edges[<from_id>-><to_id>]`
- `confirmed_decisions[<topic>]`
- `title`, `body`, `comment[<number>]`, or `metadata.<field>` from
  `LoadedIssue`

Copy source text when fidelity matters. If a required section is not
supported by the supplied evidence, state that the information is unspecified
instead of filling it with a plausible implementation or product rule. Mark
the overall result `partial` when the missing evidence could affect scope,
behavior, acceptance, dependency, or constraint interpretation.

## Required issue shape

Compose an outcome-focused English title from the unit name and observable
outcome without adding an unconfirmed feature, actor, or technical mechanism.
The body must include all of these sections, with equivalent headings allowed:

1. **Parent reference** — exact parent repository, number, URL, and
   sub-issue relationship.
2. **Problem and outcome** — the evidenced problem or product value and the
   one observable outcome from the unit.
3. **Scope** — what this unit includes and what sibling or unsupported work is
   excluded. Do not turn technical steps into scope.
4. **Behavior** — actor, current behavior when evidenced, desired behavior,
   confirmed rules, supported variants, and evidenced edge cases.
5. **Acceptance criteria** — independent pass/fail conditions. Start from
   `independent_acceptance`; add only criteria clearly assigned to this unit.
   Do not invent a test suite, API assertion, or implementation check.
6. **Dependencies** — hard predecessors, hard successors, and contextual
   `enables` or `related` relations with evidence. State when no hard
   dependency is evidenced.
7. **Priority** — the confirmed MoSCoW class, rationale, and source evidence.
8. **Constraints** — only relevant constraints supported by the parent issue
   or confirmed interview decisions. Do not convert assumptions into
   constraints.
9. **Traceability** — exact parent issue, one parent capability, and the
   original assigned requirement IDs.

The structured `sections` object and rendered `body` must describe the same
content. The body is the portable artifact: it must remain understandable
when the parent issue is not loaded.

## Workflow

### 1. Validate and align sources

Check each supplied envelope, version, required field, and status. Copy the
parent identity, source versions, source statuses, and combined
`unavailable_fields` into `ProductSubIssueDrafts.source` without normalizing
or replacing missing values.

If either required source is blocked, return:

- `status: blocked`
- empty `drafts` and `omitted_units`
- `recommended_next_skill: none`
- `failure.code: blocked_source`

If identities differ, return `blocked` with
`failure.code: identity_mismatch`. If an optional source is partial or
blocked, preserve that status and missing evidence; do not silently treat it
as complete.

### 2. Inventory and classify units

Create one inventory entry for every prioritization candidate. Join its
matching decomposition unit and preserve the unit's name, actor, observable
outcome, product value, stop reason, independent acceptance, parent
capability, and assigned requirement IDs.

Preserve omitted candidates explicitly:

- `too-large` or `over-fragmented` — omit because atomicity is not confirmed.
- `atomic-enough` with null `confirmed_class` — omit because product priority
  is not confirmed, even if a recommendation exists.
- missing or mismatched unit — omit and mark the result partial or blocked
  according to whether a reliable draft set remains possible.

Do not use graph depth, parallel-group order, absence of incoming edges, or
technical sequence to select or rank drafts.

### 3. Compose each independent draft

For each eligible unit:

1. Use the exact parent source identity in `parent_reference`.
2. Use the unit's `product_value` and any supported parent evidence for the
   problem statement. Use `observable_outcome` as the outcome.
3. Keep only the unit's assigned requirements in scope. Treat sibling units
   as separate drafts or explicit follow-up, not as hidden acceptance.
4. Use the unit actor and outcome for desired behavior. Add current behavior,
   rules, variants, and edge cases only from supplied evidence.
5. Preserve `independent_acceptance` as one or more observable acceptance
   criteria. Split it only when the source already expresses independent
   pass/fail conditions.
6. Copy the candidate's confirmed class, rationale, and evidence into
   `priority`.
7. Build dependencies from the optional graph when present. For the current
   unit, a `requires` edge from the current unit to another unit makes the
   other unit a hard predecessor; a `blocks` edge from another unit to the
   current unit also makes it a hard predecessor. Preserve the reverse cases
   as hard successors. Do not emit an inverse edge.
8. When no graph is supplied, preserve the prioritization candidate's
   `hard_predecessors` and `hard_successors` as such. Do not guess whether
   each came from `blocks` or `requires`.
9. Include `enables` and `related` only as contextual relations and never
   present them as blockers.
10. Copy only confirmed constraints and preserve their source evidence.
11. Copy the exact parent capability and assigned requirement IDs into
    `traceability`.
12. Render the same information into a standalone English Markdown body.

If the unit lacks material acceptance evidence, recommend
`define-acceptance-criteria` and return `partial`; do not manufacture criteria.
If the unit's atomicity or product priority is unconfirmed, do not draft it.

### 4. Compute the canonical set identity

After every eligible draft is complete, compute the `ProductSubIssueDrafts v2`
canonical identity before displaying the set for review. Use canonicalization
version 1 exactly as follows:

- retain only the verified source repository, parent issue number, and parent
  issue URL from `source`;
- retain every eligible draft's `unit_id`, exact title, exact body, exact
  `labels.add`, `labels.remove`, and `labels.preserve` lists, parent reference
  including relationship, hard predecessor and successor records, confirmed
  priority, and traceability;
- sort draft records by `unit_id` ascending, recursively sort object keys,
  preserve authored array order, serialize as compact UTF-8 JSON, and hash
  that representation with SHA-256 as lowercase hexadecimal;
- exclude status, failure details, timestamps, publication mappings, approval
  flags, and diagnostic-only source metadata.

Set `canonical_identity.unit_ids` to the same sorted eligible unit IDs. If any
publishable field changes after composition, recompute the digest and replace
the identity; never retain an old approval identity.

### 5. Select status and one advisory follow-up

Set the result status as follows:

- `composed` — every eligible confirmed unit has one complete draft, omitted
  candidates are explained, source uncertainty does not affect the drafts,
  and `failure` is null.
- `partial` — at least one reliable draft exists, but a source gap, omitted
  confirmed unit, incomplete acceptance set, dependency uncertainty, or
  constraint gap remains. Preserve the gap in `source`, `omitted_units`, or
  `failure`.
- `blocked` — required input is missing, invalid, unsupported, blocked,
  identity-mismatched, or no reliable draft can be composed.

Choose at most one advisory `recommended_next_skill`:

- `prioritize-product-issues` — confirmed classes or selection decisions are
  still missing.
- `assess-issue-atomicity` — a candidate needs a new atomicity assessment.
- `decompose-product-capabilities` — a compound or unresolved unit needs a
  different product cut.
- `define-acceptance-criteria` — an otherwise eligible unit lacks observable
  independent completion conditions.
- `none` — the draft set is composed, or the result is blocked without a
  useful follow-up.

Do not invoke the recommendation. Do not recommend a publication or
implementation workflow from this handoff.

## Output contract

First give a concise summary in the conversation language. Then return one
English version-2 `ProductSubIssueDrafts` handoff using the fields from
[`ProductSubIssueDrafts`](../../shared/schemas/ProductSubIssueDrafts.yaml):

```yaml
schema: ProductSubIssueDrafts
version: 2
status: composed
source:
  repository: octo-org/widgets
  number: 42
  url: https://github.com/octo-org/widgets/issues/42
  loaded_issue_version: 1
  loaded_issue_status: loaded
  product_capability_decomposition_version: 1
  product_capability_decomposition_status: decomposed
  product_issue_prioritization_version: 1
  product_issue_prioritization_status: prioritized
  product_dependency_graph_version: 1
  product_dependency_graph_status: graphed
  product_interview_version: 1
  product_interview_status: complete
  unavailable_fields: []
canonical_identity:
  schema: ProductSubIssueDrafts
  version: 2
  canonicalization_version: 1
  algorithm: sha256
  digest: <64 lowercase hexadecimal characters>
  unit_ids: [unit-invoice-csv-export]
drafts:
  - unit_id: unit-invoice-csv-export
    title: Export current-month invoices as CSV
    body: |
      ## Parent reference
      This issue is a sub-issue of octo-org/widgets#42.

      ## Problem and outcome
      Billing users manually collect invoice rows at month end. A billing user
      can download the current month's invoices as a CSV.

      ## Scope
      - Export the current month's invoices.
      - Saved payment methods remain a separate unit.

      ## Behavior
      A billing user can request the export and receives the confirmed outcome.

      ## Acceptance criteria
      - The independent acceptance condition from the decomposition passes.

      ## Dependencies
      No hard dependency is evidenced.

      ## Priority
      Must, based on the confirmed product prioritization.

      ## Constraints
      No additional constraint is evidenced.

      ## Traceability
      Parent capability: cap-billing-self-service.
      Requirements: req-csv-export.
    labels:
      add: []
      remove: []
      preserve: []
    sections:
      parent_reference:
        repository: octo-org/widgets
        number: 42
        url: https://github.com/octo-org/widgets/issues/42
        relationship: sub_issue_of
      problem_outcome:
        problem: Billing users manually collect invoice rows at month end.
        outcome: A billing user can download the current month's invoices as a CSV.
      scope:
        in_scope:
          - Export the current month's invoices.
        out_of_scope:
          - Saved payment methods.
      behavior:
        actor: billing user
        current_behavior: Billing users manually collect invoice rows at month end.
        desired_behavior: A billing user can request and download the current month's invoices as a CSV.
        business_rules: []
        variants: []
        edge_cases: []
      acceptance_criteria:
        - The independent acceptance condition from the decomposition.
      dependencies:
        independence: independent
        hard_predecessors: []
        hard_successors: []
        contextual_relations: []
        evidence: independent_units
      priority:
        class: must
        rationale: The confirmed current product commitment requires this outcome.
        evidence: candidates[unit-invoice-csv-export].decision
      constraints: []
      traceability:
        parent_issue:
          repository: octo-org/widgets
          number: 42
          url: https://github.com/octo-org/widgets/issues/42
        parent_capability:
          id: cap-billing-self-service
          name: Billing self-service
        requirement_ids:
          - req-csv-export
        evidence:
          - units[unit-invoice-csv-export]
omitted_units: []
recommended_next_skill: none
failure: null
```

Use `failure: null` only for `composed` results. Do not claim a complete
result when a required draft, identity, acceptance condition, dependency, or
constraint is unavailable.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | A required decomposition or prioritization handoff is absent. | Ask for the missing handoff or return `blocked`; compose no guessed drafts. |
| `invalid_input` | Required fields, source identities, or types are malformed. | `blocked`; preserve the validation problem. |
| `unsupported_version` | A required source is unsupported, or a supplied draft set is not ProductSubIssueDrafts version 2. | `blocked`; request a compatible handoff. |
| `blocked_source` | A required source is blocked or cannot establish parent identity. | `blocked`; preserve known identity and emit no fabricated drafts. |
| `incomplete_source` | A partial source lacks evidence that could change a draft. | `partial`; preserve unavailable paths and affected units. |
| `identity_mismatch` | Supplied sources identify different repositories, issues, or URLs. | `blocked`; do not merge unrelated product evidence. |
| `unconfirmed_ranking` | No eligible unit has a confirmed product class, or a required class/selection decision remains open. | `blocked` when no draft is possible; otherwise `partial`. |
| `composition_failure` | An unexpected local failure prevents reliable composition. | `blocked`; describe the operation without exposing secrets or raw CLI output. |

A failure message must not expose tokens, credentials, private keys, `.env`
contents, personal data, or unnecessary raw command output.
