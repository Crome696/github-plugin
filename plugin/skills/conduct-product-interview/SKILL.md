---
name: conduct-product-interview
description: Conduct a deep adaptive product interview from one version-1 ProductAssessment, asking step by step about missing or contradictory information on outcome, actors, user journeys, behavior, variants, business rules, edge cases, priorities, dependencies, constraints, and non-goals, then return a version-1 ProductInterview that records confirmed decisions, assumptions, and open questions for later decomposition. Use automatically when a user asks to interview from a product assessment, gather missing product decisions, clarify contradictory product topics, or prepare a ProductInterview for later decomposition; do not use for product-topic extraction (analyze-product-issue), capability mapping (identify-product-capabilities), atomic decomposition (decompose-product-capabilities), atomicity classification (assess-issue-atomicity), dependency graphing (build-product-dependency-graph), product prioritization (prioritize-product-issues), issue rewriting (rewrite-github-issue), IssueAssessment structuring (structure-issue), sub-issue creation, or publication.
---

# Conduct Product Interviews

Conduct a deep adaptive interview based on the Product Assessment. Ask step
by step about missing or contradictory information on Outcome, Actors, User
Journeys, Behavior, Variants, Business Rules, Edge Cases, Priorities,
Dependencies, Constraints, and Non-goals. Prefer few context-related
questions per round instead of large questionnaires. Challenge answers when
they have relevant consequences. Document confirmed decisions, assumptions,
and open questions in a structured form for later decomposition.

Consume exactly one version-1 `ProductAssessment`. Return the version-1
`ProductInterview` handoff. Do not rewrite the issue, create sub-issues, or
publish to GitHub.

`issue-agent` mode `refine` uses this Skill as the interview source of truth
after `analyze-product-issue`. `identify-product-capabilities` consumes the
confirmed record as the Capability Map basis.
`decompose-product-capabilities` consumes that map.
`assess-issue-atomicity` classifies the resulting units.
`build-product-dependency-graph` maps evidenced dependencies.
`prioritize-product-issues` ranks those units with the user. Later
`rewrite-github-issue` and `structure-issue` consume the resulting record.

## Boundaries

- Keep questions and explanations in the user's conversation language.
- Keep the structured handoff and all newly authored report text in English.
  Preserve short exact source excerpts when they are needed as evidence.
- Require a `ProductAssessment` handoff. Do not silently load or re-fetch an
  issue, infer identity from the workspace, or invoke `analyze-product-issue`
  or `load-github-issue` automatically.
- Do not edit GitHub, repository files, labels, comments, issue state, or
  pull requests. Do not create, propose as a write, split, or publish
  sub-issues. A selected outcome may be recorded as a confirmed decision;
  mixed features remain diagnosis only.
- Do not invent essential product decisions or present `inferred` or
  `uncertain` assessment items as confirmed requirements.
- Apply [`product-interview-policy.mdc`](../../rules/product-interview-policy.mdc).
  Skip evidenced answers, challenge contradictions, and end the interview
  only when remaining uncertainties are explicitly accepted or documented as
  open points.
- Apply [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc)
  as a recognition raster for mixed features and atomicity. Do not lock a
  split by inventing outcomes, and do not create GitHub issues.
- Ask at most one or two context-related questions per round. Do not dump a
  questionnaire. Prioritize questions that change scope, atomicity,
  acceptance, or the selected slice.
- Do not draft replacement issue text, publish anything, or start a follow-up
  Skill. Recommend at most one next Skill.
- Use `analyze-product-issue` when the caller still needs a product
  assessment. Use `identify-product-capabilities` to map the confirmed
  interview into a hierarchical Capability Map. Use
  `decompose-product-capabilities` to split that map into atomic units. Use
  `assess-issue-atomicity` to classify those units. Use
  `build-product-dependency-graph` to map evidenced dependencies. Use
  `prioritize-product-issues` to rank more than one `atomic-enough` unit
  with the user. Use
  `rewrite-github-issue` to draft an `IssueDraft` from a completed interview
  or selected slice. Use `structure-issue` to organize an `IssueAssessment`.
  Use `analyze-issue` for implementation-readiness analysis. Use
  `assess-issue-quality` for the six-dimension rubric.

## Input contract

The primary input is one `ProductAssessment` version 1 handoff:

```yaml
product_assessment:
  schema: ProductAssessment
  version: 1
  status: analyzed | partial | blocked
```

The handoff must contain the required fields from
[`ProductAssessment`](../../shared/schemas/ProductAssessment.yaml).

If no handoff is present, ask the user to provide the product assessment or
the loaded issue identity for a separate `analyze-product-issue` step. Do not
claim that the interview ran without the assessment. If the supplied object
is malformed or has an unsupported version, return a `blocked`
[`ProductInterview`](../../shared/schemas/ProductInterview.yaml) result.

## Evidence and coverage

Map `ProductAssessment.topics.use_cases` to the interview topic
`user_journeys`. Cover these topics systematically, but only ask about gaps:

1. Problem
2. Outcome
3. Actors
4. User journeys
5. Behavior
6. Variants
7. Business rules
8. Edge cases
9. Priorities
10. Dependencies
11. Constraints
12. Non-goals

Skip a topic when its answer is already `evidenced` in the assessment, the
issue, the repository, or a prior user confirmation. Start from
`interview_focus`, `unclear_decisions`, `open_questions`, `mixed_features`,
and `implicit_requirements`.

Classify each coverage topic as:

- `skipped_evidenced` — the assessment already marked the topic `evidenced`.
- `confirmed` — the user confirmed it, or it was assessment-evidenced and
  needs no further question.
- `challenged` — an answer had relevant consequences and was questioned.
- `open` — still missing, contradictory, or unaccepted.

Record inventory items with:

- `origin: assessment_evidenced` — copied from an `evidenced` assessment item.
- `origin: user_confirmed` — explicitly confirmed in this interview.
- `origin: assumed` — still an interpretation; never put these in
  `confirmed_decisions`.

## Workflow

### 1. Validate the assessment

Check the input shape, `schema`, `version`, required fields, and source
status. Copy the source repository, number, URL, ProductAssessment version,
ProductAssessment status, and `unavailable_fields` into
`ProductInterview.source` without normalizing or inventing values.

If `ProductAssessment.status` is `blocked`, return:

- `status: blocked`
- coverage topics set to `open`
- empty `confirmed_decisions`, `assumptions`, and `open_questions`
- `recommended_next_skill: none`
- `failure.code: blocked_source`

Do not invent product decisions about issue content that was not assessed.

### 2. Account for partial evidence

For `ProductAssessment.status: partial`, inspect every path in
`unavailable_fields`. Continue only when the remaining assessment supports a
reliable interview. If an unavailable field could change a material topic:

- keep that topic `open`
- preserve the missing path
- use `failure.code: incomplete_source` until the gap is accepted or resolved

Do not treat `null` as an empty list. An empty list means the source was
retrieved and contained no entries.

### 3. Seed the interview record

Copy `evidenced` assessment items into `confirmed_decisions` with
`origin: assessment_evidenced` and mark those topics `skipped_evidenced`.
Put `inferred` items into `assumptions` with `origin: assumed`. Put
`uncertain` items, `unclear_decisions`, and assessment `open_questions` into
`open_questions`. Do not confirm mixed features as one compound outcome.

### 4. Interview for missing or contradictory decisions

Apply [`product-interview-policy.mdc`](../../rules/product-interview-policy.mdc).
Ask step by step about missing or contradictory information. Prefer few
context-related questions per round instead of large questionnaires.

Ask the one or two questions that change scope, atomicity, acceptance, or
the selected slice. Challenge an answer when it has relevant consequences
for actors, behavior, variants, acceptance, or out-of-scope work. Challenge
the same ambiguity once, then treat it as an unresolved open point that
requires explicit acceptance. Do not flatten contradictions into one
invented interpretation.

When mixed features remain, ask which one outcome this issue should lock.
Record the selected outcome as a confirmed decision and the remainder as
non-goals or open follow-up. Do not create GitHub sub-issues.

Repeat rounds until remaining uncertainties are explicitly accepted or
documented as open points. Do not end the interview because a round budget
expired while material product topics remain uncovered or invented.

### 5. Document the structured result

Before returning the handoff, summarize in the conversation language:

- Confirmed decisions
- Assumptions that still need confirmation
- Open questions, including any the user explicitly accepted as residual risk

Set status as follows:

- `needs_clarification` when a material topic remains `open` or `challenged`
  without explicit acceptance of the residual open points.
- `complete` only when every coverage topic is `confirmed` or
  `skipped_evidenced`, or remaining open points are explicitly accepted.
- `blocked` when the required assessment cannot be used.

Choose exactly one recommendation:

- `identify-product-capabilities` — map the confirmed interview and parent
  issue into a hierarchical Capability Map. This is the usual next step
  after a complete refine interview.
- `rewrite-github-issue` — draft the selected slice as an issue rewrite
  when a Capability Map is unnecessary or already available.
- `structure-issue` — organize the record into an `IssueAssessment` without
  a GitHub rewrite.
- `none` — the source is blocked, or no follow-up is justified.

Do not invoke the recommendation automatically.

## Output contract

First give a concise summary in the conversation language. Then return one
English `ProductInterview` version-1 handoff using the field names from
[`ProductInterview`](../../shared/schemas/ProductInterview.yaml):

```yaml
status: complete
source:
  repository: octo-org/widgets
  number: 42
  url: https://github.com/octo-org/widgets/issues/42
  product_assessment_version: 1
  product_assessment_status: analyzed
  unavailable_fields: []
coverage:
  problem: skipped_evidenced
  outcome: confirmed
  actors: confirmed
  user_journeys: open
  behavior: confirmed
  variants: challenged
  business_rules: skipped_evidenced
  edge_cases: open
  priorities: confirmed
  dependencies: skipped_evidenced
  constraints: skipped_evidenced
  non_goals: confirmed
confirmed_decisions:
  - topic: outcome
    text: "A billing user can download the current month's invoices as CSV."
    evidence: "user confirmed CSV after the assessment listed export without a format."
    origin: user_confirmed
assumptions:
  - topic: variants
    text: "PDF export can wait for a follow-up issue."
    evidence: "User said CSV first; PDF was not confirmed."
    origin: assumed
open_questions:
  - topic: edge_cases
    text: "What should happen when the current month has no invoices?"
    evidence: "Neither the assessment nor the user specified the empty-month behavior."
    origin: assumed
recommended_next_skill: identify-product-capabilities
failure: null
```

Use `failure: null` only for `complete` results.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No `ProductAssessment` handoff is available. | Ask one concise handoff question or return `blocked` if it cannot be supplied. |
| `invalid_input` | Required fields are missing or have invalid types. | `blocked`; do not interview from guessed values. |
| `unsupported_version` | The assessment is not `ProductAssessment` version 1. | `blocked`; request a compatible handoff. |
| `blocked_source` | The source assessment has `status: blocked`. | `blocked`; preserve known identity and return no fabricated decisions. |
| `incomplete_source` | A partial assessment lacks material evidence. | `needs_clarification`; identify unavailable fields and uncertainty. |
| `interview_failure` | A material topic remains unaccepted, or an unexpected local failure prevents a reliable record. | `needs_clarification` or `blocked`; describe the gap without exposing secrets or raw credentials. |

A failure message must not expose tokens, credentials, private keys, `.env`
contents, or unnecessary raw CLI output.
