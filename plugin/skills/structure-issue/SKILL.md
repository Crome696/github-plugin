---
name: structure-issue
description: Deterministically structure issue information into a standardized IssueAssessment from one complete ProductInterview v2 without asking product-decision questions or inventing requirements. Use automatically after conduct-product-interview; use compose-product-sub-issues for complete atomic sub-issue draft composition.
---

# Structure Issues

Turn a vague issue or feature idea into an evidence-backed, standardized
version-1 `IssueAssessment` handoff for a downstream rewrite or implementation
workflow.
Map the canonical ProductInterview topics and preserve the distinction between
facts, confirmed requirements, assumptions, accepted uncertainties, and
unresolved questions.

## Boundaries

- Match questions and explanations to the user's conversation language.
- Write the final handoff fields in English.
- Read issues and repository context when available, but never edit GitHub,
  repository files, labels, comments, or issue state.
- Do not draft, overwrite, or publish a GitHub issue rewrite. A direct
  text-only rewrite belongs to [rewrite-issue](../rewrite-issue/SKILL.md); a
  request for an interview-driven, approved rewrite belongs to
  `rewrite-github-issue`; publication of an already approved `IssueDraft`
  belongs to `create-github-issue`.
- Do not compose a complete set of sub-issue drafts; that responsibility
  belongs to `compose-product-sub-issues` after atomicity and priority are
  confirmed.
- Never invent behavior, users, constraints, dependencies, risks, or
  acceptance criteria. Separate observed facts, user-confirmed requirements,
  assumptions, and open questions.
- Require one matching `ProductInterview` version 2. This Skill owns no
  product-decision elicitation and must never ask a substitute interview
  question.
- Map `confirmed_decisions` into locked fields. Keep `assumptions`,
  `accepted_uncertainties`, and `open_questions` unconfirmed. A `blocked` or
  `needs_clarification` interview does not make the assessment `ready`.
- When a version-1 `ProductCapabilityMap` is supplied, consume it as optional
  grouping output. Keep one selected capability in scope and treat remaining
  capabilities as explicit non-goals or follow-up. A `blocked` map does not
  make the assessment `ready`.
- When a version-1 `ProductCapabilityDecomposition` is supplied, consume it
  as optional atomic-unit output. Keep one selected unit in scope and treat
  remaining units as explicit non-goals or follow-up. A `blocked`
  decomposition does not make the assessment `ready`.
- When a version-1 `IssueAtomicityAssessment` is supplied, consume it as
  optional atomicity output. Keep one selected `atomic-enough` unit in
  scope. A `too-large` or `over-fragmented` unit does not make the
  assessment `ready` until the `better_cut` is confirmed. A `blocked`
  assessment does not make the assessment `ready`.
- When a version-1 `ProductDependencyGraph` is supplied, consume it as
  optional dependency output. Keep one selected `atomic-enough` unit in
  scope and record its evidenced relations without ranking remaining
  units by technical order. A `blocked` graph does not make the
  assessment `ready`.
- When a version-1 `ProductIssuePrioritization` is supplied, consume it as
  optional ranking output. Keep the confirmed `selected_unit_id`, or one
  explicitly chosen eligible unit, in scope. An unconfirmed
  `recommended_class` does not make the assessment `ready`. A `blocked`
  ranking does not make the assessment `ready`.
- When a `ProductInterview` is missing, incomplete, unsupported, or mismatched,
  return the typed [`ProductInterviewPrerequisite`](../../shared/schemas/ProductInterviewPrerequisite.yaml)
  and do not inspect a ProductAssessment as a replacement interview.
- Apply [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc).
  If the request contains more than one independent product outcome, do not
  lock them as one issue. Record the split, keep one selected outcome in
  scope, and treat the remainder as explicit non-goals or follow-up issues.

## 1. Establish available context

Identify the target from the verified issue identity or the new-request
Normalized Brief supplied by the caller. Require a version-2
`ProductInterview` for that same source. Do not infer identity from the open
workspace or current branch.
When a live issue is known, read it before interpreting the source material:

```text
gh issue view <number> --repo <owner>/<repo> --json title,body,labels,state,comments,url
```

Read only the repository context needed to understand the request. If the
target issue or new-request identity cannot be identified, return a blocked
assessment with a typed `ProductInterviewPrerequisite`; do not ask for
missing product decisions in this Skill.

## 2. Consume the canonical interview

Require a complete `ProductInterview` version 2 and map its confirmed
decisions into the `IssueAssessment` fields below. Never ask questions here.
If the record is `needs_clarification` or `blocked`, return the assessment as
not ready and preserve the typed prerequisite or interview failure.

1. **Problem** — What problem exists, for whom, and what impact or evidence
   demonstrates it?
2. **Outcome** — What one bounded result should this issue deliver?
3. **Actors** — Which user groups, roles, or systems are affected?
4. **Use cases** — Which journeys must succeed for this outcome?
5. **Behavior** — What observable current behavior exists, and what should
   happen instead?
6. **Business rules** — Which rules, thresholds, or permissions constrain
   the outcome?
7. **Variants** — Which supported alternatives stay in this issue, and which
   do not?
8. **Edge cases** — Which unusual inputs, empty states, or failures must be
   handled here?
9. **Priorities** — What must ship in this issue versus later follow-up?
10. **Dependencies** — Which platforms, integrations, data, or permissions
    must be available?
11. **Constraints** — Which technical, legal, or operational limits apply?
12. **Out-of-scope** — What related work is explicitly excluded?

Map those answers into existing `IssueAssessment` fields: problem, outcome,
actors, and behavior into `desired_outcome`, `affected_user_or_problem`,
`current_behavior`, and `target_behavior`; use cases, business rules, and
variants into `locked_requirements` or `target_behavior`; edge cases into
`acceptance_criteria`, `risks`, or `open_questions`; priorities into
`locked_requirements` or `proposed_labels`; dependencies and constraints
into `platforms_and_integrations` and `technical_constraints`; out-of-scope
into `explicit_non_goals`. Do not add contract fields.

Use only the evidence already present in the canonical interview. Treat
`accepted_uncertainties` as explicitly accepted residual risk, not as locked
requirements. Do not re-extract or reinterpret decisions from the live issue
when doing so would create a second elicitation path.

## 3. Lock and assess the requirements

Before producing the handoff, summarize the result in the conversation
language and separate:

- **Locked requirements** — directly evidenced by the issue/repository or
  explicitly confirmed by the user.
- **Future context** — useful direction that is not part of this issue.
- **Explicit non-goals** — related work that must not be included.
- **Assumptions** — unverified interpretations, each with the evidence needed
  to confirm it.
- **Open questions** — unresolved decisions that could materially change the
  scope or implementation.

Set the assessment status as follows:

- `draft` while requirements are still being collected.
- `needs_clarification` when material questions remain without explicit
  acceptance of the residual open points.
- `ready` only when issue identity, scope, non-goals, dependencies, risks, and
  observable acceptance criteria are sufficiently concrete, remaining
  uncertainties are explicitly accepted or documented as open points under
  [`product-interview-policy.mdc`](../../rules/product-interview-policy.mdc),
  and the locked scope is nearly atomic under
  [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc).
- `blocked` when a required source or precondition is unavailable, including a
  missing, incomplete, unsupported, or identity-mismatched ProductInterview.

Set `implementation_ready` to `true` only for `ready`. A non-empty material
`open_questions` list always makes `implementation_ready` `false`.

## 4. Return the standardized handoff

First give the user a concise summary in the conversation language. Then
provide the following English handoff using the field names from
`plugin/shared/schemas/IssueAssessment.yaml`:

```yaml
status: ready
prerequisite: null
issue:
  repository: owner/repository
  number: 123
  url: https://github.com/owner/repository/issues/123
  current_title: "Current issue title"
  current_body: "Current issue body"
  current_labels: []
  current_state: open
desired_outcome: "Outcome that resolves the problem"
affected_user_or_problem: "Affected users and the problem they experience"
current_behavior: "Observable current behavior"
target_behavior: "Observable desired behavior"
locked_requirements:
  - "Requirement confirmed by the user or source evidence"
future_context: []
explicit_non_goals:
  - "Related work excluded from this issue"
assumptions:
  - "Unverified assumption and how it can be confirmed"
open_questions: []
platforms_and_integrations:
  - "Required platform, integration, data, or permission"
technical_constraints:
  - "Known technical constraint"
risks:
  - "Risk, impact, and mitigation or verification"
acceptance_criteria:
  - "Given ..., when ..., then ..."
verification_approach:
  - "Check or test that demonstrates the acceptance criterion"
proposed_labels:
  add: []
  remove: []
  preserve: []
implementation_ready: true
publication_authorization:
  exact_draft_approved: false
  publication_authorized: false
  evidence: null
```

`risks` is an additive handoff field requested by this skill; do not change the
versioned shared schema to add it. Mirror any material risk that blocks
readiness in `assumptions` or `open_questions`. Keep label operations empty
unless the user explicitly requests label planning; this skill never applies
label changes.

When the ProductInterview prerequisite is missing or unusable, preserve the
same structure, set `status: blocked`, set `implementation_ready: false`,
return the exact prerequisite object, and describe the missing evidence in
`open_questions`. Do not replace unknown repository facts with placeholders
that look real or ask a second interview.
