---
name: conduct-product-interview
description: Conduct the sole canonical adaptive product interview for either a normalized new request or a loaded issue with deterministic assessment evidence, then return a version-2 ProductInterview containing confirmed decisions, assumptions, open questions, and explicitly accepted uncertainties. Use automatically when a workflow needs product-decision elicitation; do not use for product-topic extraction, issue structuring, acceptance-criteria derivation, issue rewriting, decomposition, prioritization, sub-issue publication, or GitHub publication.
---

# Conduct Product Interviews

Own the only interactive product-decision conversation in the issue and
product-planning workflows. Accept exactly one tagged input mode:

- `new_request`, carrying the issue-agent's normalized brief; or
- `loaded_issue`, carrying one `LoadedIssue` version 1 and its matching
  deterministic `ProductAssessment` version 1.

Ask step by step about missing or contradictory information on Problem,
Outcome, Actors, User Journeys, Behavior, Variants, Business Rules, Edge
Cases, Priorities, Dependencies, Constraints, and Non-goals. Prefer few
context-related questions per round instead of large questionnaires. Challenge
answers when they have relevant consequences. Document confirmed decisions,
assumptions, open questions, and explicitly accepted uncertainties in one
canonical version-2 handoff.

Return exactly one version-2 `ProductInterview`. Do not rewrite the issue,
define acceptance criteria, create sub-issues, or publish to GitHub.

`structure-issue`, `define-acceptance-criteria`, and `rewrite-github-issue`
are deterministic consumers of this handoff. They must not start another
interview. Product-analysis, capability mapping, decomposition, atomicity,
dependency, and prioritization Skills may enrich the record but do not own
interactive product elicitation.

## Boundaries

- Keep questions and explanations in the user's conversation language.
- Keep the structured handoff and all newly authored report text in English.
  Preserve short exact source excerpts when they are needed as evidence.
- Require exactly one valid v2 input mode. Do not silently load or re-fetch an
  issue, infer identity from the workspace, or invoke another Skill to repair
  a missing input.
- For `new_request`, preserve the normalized brief and do not invent an issue
  number or URL.
- For `loaded_issue`, require a version-1 `LoadedIssue` and a matching
  version-1 `ProductAssessment`; preserve both identities and their source
  status without normalizing away unavailable fields.
- Do not edit GitHub, repository files, labels, comments, issue state, or pull
  requests. Do not create, propose as a write, split, or publish sub-issues.
- Do not invent essential product decisions or present inferred or uncertain
  items as confirmed requirements.
- Apply [`product-interview-policy.mdc`](../../rules/product-interview-policy.mdc).
  Skip evidenced answers, challenge contradictions, and end the interview
  only when remaining uncertainties are explicitly accepted or documented as
  open points.
- Apply [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc)
  as a recognition raster for mixed features and atomicity. Do not lock a
  split by inventing outcomes, and do not create GitHub issues.
- Ask at most one or two context-related questions per round. Prioritize
  questions that change scope, atomicity, acceptance, or the selected slice.
- Do not draft replacement issue text, define criteria, publish anything, or
  start a follow-up Skill. Recommend at most one next Skill.

## Input contract

The primary input is exactly one of these version-2 envelopes:

```yaml
input:
  mode: new_request
  normalized_brief:
    target_repository: octo-org/widgets
    source_request: "User's original request"
    desired_outcome: "Observable desired outcome"
    affected_user_or_problem: "Affected user or problem"
    current_behavior: "Known current behavior"
    target_behavior: "Desired target behavior"
    in_scope: []
    out_of_scope: []
    platforms_and_integrations: []
    technical_constraints: []
    acceptance_criteria: []
    verification_approach: []
    future_context: []
    proposed_label_additions: []
    open_questions: []
  loaded_issue: null
  product_assessment: null
```

```yaml
input:
  mode: loaded_issue
  normalized_brief: null
  loaded_issue:
    schema: LoadedIssue
    version: 1
    status: loaded
    issue:
      repository: octo-org/widgets
      number: 42
      url: https://github.com/octo-org/widgets/issues/42
  product_assessment:
    schema: ProductAssessment
    version: 1
    status: analyzed
    source:
      repository: octo-org/widgets
      number: 42
      url: https://github.com/octo-org/widgets/issues/42
```

The complete input must contain the required fields from
[`ProductInterview`](../../shared/schemas/ProductInterview.yaml),
[`LoadedIssue`](../../shared/schemas/LoadedIssue.yaml),
[`ProductAssessment`](../../shared/schemas/ProductAssessment.yaml), or the
normalized brief contract defined by the issue-agent.

If no valid input is present, return a blocked v2 `ProductInterview` with
`failure.code: missing_input`. If the supplied object is malformed, uses an
unsupported version, or contains mismatched source identities, return a
blocked v2 result without asking a substitute interview question.

## Evidence and coverage

For a loaded issue, map `ProductAssessment.topics.use_cases` to
`user_journeys`. For a new request, map the normalized brief fields to the
same canonical topics. Cover these topics systematically, but only ask about
gaps:

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

Skip a topic when its answer is already evidenced in the input, repository,
or a prior user confirmation. Start from the loaded assessment's
`interview_focus`, `unclear_decisions`, `open_questions`, `mixed_features`,
and `implicit_requirements`, or from the normalized brief's open questions
and missing fields.

Classify each coverage topic as:

- `skipped_evidenced` — the input already establishes the topic;
- `confirmed` — the user confirmed it or direct evidence is sufficient;
- `challenged` — an answer had relevant consequences and was questioned;
- `open` — still missing, contradictory, or unaccepted.

Record inventory items with:

- `origin: assessment_evidenced` for direct loaded-issue assessment evidence;
- `origin: user_confirmed` for an explicit answer in this interview;
- `origin: assumed` for an interpretation that remains unconfirmed; use this
  only in `assumptions`, never in `confirmed_decisions`;
- `origin: user_accepted` only in `accepted_uncertainties` for an explicit
  residual-risk acceptance.

Only `user_confirmed` and `assessment_evidenced` items may enter
`confirmed_decisions`. Assumptions, open questions, and accepted uncertainties
never become confirmed requirements.

## Workflow

### 1. Validate the tagged input

Check the input mode, schema and version fields, required fields, and source
identity. For `new_request`, require `normalized_brief` and set the loaded
source fields to null or `not_applicable`. For `loaded_issue`, require both
source handoffs and verify repository, issue number, and URL equality.

Copy the source identity, input mode, LoadedIssue version, ProductAssessment
version/status, and every unavailable path into `ProductInterview.source`
without inventing replacements.

If a loaded ProductAssessment is `blocked`, return `status: blocked`, open
coverage, empty decision inventories, `recommended_next_skill: none`, and
`failure.code: blocked_source`.

### 2. Account for partial evidence

For a partial loaded assessment or incomplete new-request brief, inspect every
unavailable or missing path. Continue only when the remaining evidence supports
a reliable interview. If a missing path could change a material topic:

- keep that topic `open`;
- preserve the missing path;
- use `failure.code: incomplete_source` until the gap is resolved or explicitly
  accepted in `accepted_uncertainties`.

Do not treat `null` as an empty list. An empty list means the source was
retrieved and contained no entries.

### 3. Seed the canonical record

Copy evidenced items into `confirmed_decisions` with
`origin: assessment_evidenced` and mark those topics `skipped_evidenced`.
For new requests, copy only directly supplied brief facts as evidence.
Put inferred items into `assumptions` with `origin: assumed`. Put uncertain
items, unclear decisions, and source open questions into `open_questions`.
Do not confirm mixed features as one compound outcome.

### 4. Interview for decisions

Apply [`product-interview-policy.mdc`](../../rules/product-interview-policy.mdc).
Ask the one or two questions that remove the most uncertainty for scope,
atomicity, acceptance, actors, behavior, variants, or out-of-scope work.
Challenge contradictions rather than smoothing them into one interpretation.

When mixed features remain, ask which one outcome this workflow should lock.
Record the selected outcome as a confirmed decision and the remainder as
non-goals or open follow-up. Do not create GitHub sub-issues.

Repeat rounds until remaining uncertainties are resolved, explicitly accepted,
or documented as open points. An explicit residual-risk acceptance belongs in
`accepted_uncertainties` and never in `confirmed_decisions`.

### 5. Document the result

Before returning the handoff, summarize in the conversation language:

- confirmed decisions;
- assumptions that remain unconfirmed;
- open questions;
- explicitly accepted uncertainties;
- the recommended deterministic next Skill, if any.

Set status as follows:

- `needs_clarification` when a material topic remains `open` or `challenged`
  without explicit acceptance;
- `complete` when all topics are confirmed or skipped-evidenced, or all
  remaining gaps are explicitly represented in `accepted_uncertainties`;
- `blocked` when the canonical input cannot be used.

Choose exactly one recommendation:

- `identify-product-capabilities` for a complete loaded-issue planning flow;
- `rewrite-github-issue` for a selected loaded-issue slice;
- `structure-issue` for organizing a new request or issue assessment;
- `define-acceptance-criteria` when criteria derivation is the next direct
  deterministic step;
- `none` when the source is blocked or no follow-up is justified.

Do not invoke the recommendation automatically.

## Output contract

First give a concise summary in the conversation language. Then return one
English `ProductInterview` version-2 handoff:

```yaml
schema: ProductInterview
version: 2
status: complete
input:
  mode: new_request
  normalized_brief:
    target_repository: octo-org/widgets
    source_request: "User's original request"
    desired_outcome: "A confirmed outcome"
    affected_user_or_problem: "The affected user or problem"
    current_behavior: "Current behavior"
    target_behavior: "Target behavior"
    in_scope: []
    out_of_scope: []
    platforms_and_integrations: []
    technical_constraints: []
    acceptance_criteria: []
    verification_approach: []
    future_context: []
    proposed_label_additions: []
    open_questions: []
  loaded_issue: null
  product_assessment: null
source:
  input_mode: new_request
  repository: octo-org/widgets
  number: null
  url: null
  loaded_issue_version: null
  product_assessment_version: null
  product_assessment_status: not_applicable
  unavailable_fields: []
coverage:
  problem: confirmed
  outcome: confirmed
  actors: confirmed
  user_journeys: skipped_evidenced
  behavior: confirmed
  variants: skipped_evidenced
  business_rules: skipped_evidenced
  edge_cases: skipped_evidenced
  priorities: confirmed
  dependencies: skipped_evidenced
  constraints: skipped_evidenced
  non_goals: confirmed
confirmed_decisions:
  - topic: outcome
    text: "A confirmed outcome"
    evidence: "The user supplied this outcome in the normalized request."
    origin: user_confirmed
assumptions: []
open_questions: []
accepted_uncertainties: []
recommended_next_skill: structure-issue
failure: null
```

Use `failure: null` only for `complete` results.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | Neither a valid new-request brief nor a loaded-issue pair is available. | `blocked`; preserve known identity and do not start a substitute loop. |
| `invalid_input` | Required fields are missing or have invalid types. | `blocked`; do not interview from guessed values. |
| `unsupported_version` | An input handoff is not the supported version. | `blocked`; request a compatible input. |
| `identity_mismatch` | LoadedIssue and ProductAssessment do not identify the same source. | `blocked`; preserve the mismatch evidence. |
| `blocked_source` | A source assessment or loaded issue is blocked. | `blocked`; return no fabricated decisions. |
| `incomplete_source` | A material source field is unavailable. | `needs_clarification`; identify the missing path. |
| `prerequisite_required` | A downstream canonical handoff cannot be produced safely. | `blocked`; identify the required v2 input. |
| `interview_failure` | A material topic remains unaccepted or an unexpected failure prevents a reliable record. | `needs_clarification` or `blocked`; describe the gap without exposing secrets. |

A failure message must not expose tokens, credentials, private keys, `.env`
contents, or unnecessary raw CLI output.
