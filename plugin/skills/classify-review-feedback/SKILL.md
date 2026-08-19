---
name: classify-review-feedback
description: Classify open pull-request review feedback by cause, severity, affected component, and required action using observable evidence. Use automatically when collected review feedback needs follow-up triage; never modify GitHub, local files, or discussion threads.
---

# Classify Pull-Request Review Feedback

Classify exactly one supplied version-1 `CollectedReviewFeedback` handoff into
read-only follow-up triage. This skill classifies the work required to address
feedback; it does not decide whether the feedback is a valid review finding.
It must not modify code, tests, documentation, Git state, GitHub, or discussion
threads.

## Boundaries

- Read only the supplied handoff and bounded corroborating evidence.
- Preserve the exact pull-request identity, source item IDs, source status, and
  original feedback text.
- Classify only open feedback items. Do not silently reclassify resolved,
  outdated, or explicitly addressed items as open.
- Never reply to, resolve, close, dismiss, edit, or reopen a thread.
- Never publish a comment, review, change request, approval, or merge decision.
- Never create or authorize a code change, test change, documentation change,
  explanation, conflict resolution, or dependency update.
- Do not infer requirements, component ownership, severity, or validity from
  wording, author, repetition, timestamps, or review state alone.
- Keep hypotheses and missing context separate from confirmed observations.
- Do not expose secrets, credentials, private keys, `.env` values, personal
  data, or unnecessary raw logs.
- Keep the handoff and authored artifact text in English; conversational
  explanations may follow the user's language.

## Input validation

Require one version-1 `CollectedReviewFeedback` handoff with status
`collected` or `partial`. Validate:

1. The repository, pull-request number, URL, and head SHA are internally
   consistent and are not contradicted by supplied corroborating evidence.
2. Every group and item has its required identity, status, summary, evidence,
   and confidence fields.
3. Each open item has a reproducible source reference and enough observed
   information to classify, or is retained as uncertain with a clarification
   action.
4. Source status and unavailable fields are preserved. A `partial` source is a
   limitation, not proof that missing information is harmless.
5. No feedback item is duplicated or merged during classification.

Return `blocked` for missing, malformed, unsupported, or conflicting identity
or source data. Return `partial` when open items can be classified but source
limitations make one or more classifications provisional. Do not manufacture
replacement values.

## Cause categories

Assign exactly one primary cause to each open feedback item:

- `code_change`: The requested correction changes production or library source
  behavior, logic, API use, configuration code, or implementation structure.
- `test`: The requested work adds, changes, repairs, or executes verification
  for behavior already covered by the implementation.
- `documentation`: The requested work corrects or adds a public contract,
  usage instruction, configuration guide, migration note, or operational
  documentation.
- `explanation`: The feedback asks for rationale, clarification, evidence, or
  a response; no repository change is established by the available text.
- `conflict`: The feedback conflicts with another requirement, accepted
  behavior, explicit issue scope, repository instruction, or another active
  request.
- `external_dependency`: The requested resolution requires a library, service,
  permission, environment, upstream change, or other control outside the
  pull request.
- `possibly_unsubstantiated`: The feedback states a concern or preference but
  provides no verified defect, requirement, impact, or actionable correction.

Choose the cause from the observed requested resolution and evidence, not from
the reviewer's label. If a single item asks for multiple independent kinds of
work, preserve it as one source item but mark the primary cause and explain the
secondary work in the rationale; do not split or rewrite the source feedback.

## Severity

Assign the smallest severity supported by observed impact:

- `blocker`: Acceptance, safe integration, or required verification cannot
  proceed until the issue is resolved or the conflict is decided.
- `major`: A material defect, compatibility problem, security risk, or missing
  required verification affects changed behavior.
- `minor`: A non-blocking but actionable defect, test gap, documentation error,
  or maintainability risk.
- `suggestion`: An evidence-backed improvement with no demonstrated behavioral
  impact.
- `unclassified`: Evidence is insufficient to justify a severity; clarification
  is required.

Do not escalate because feedback says “must”, “critical”, or “blocking”.
`possibly_unsubstantiated` feedback normally uses `unclassified` or
`suggestion`; use a higher severity only when separate evidence demonstrates
impact. A conflict is a blocker only when the conflicting requirement prevents
safe acceptance or verification.

## Affected component

Identify the smallest evidenced component and use a stable descriptive value,
such as a changed file, module, API, test suite, documentation section,
configuration area, CI check, dependency, or pull-request scope. Use
`pull-request/<number>` for feedback without a file location. If the component
cannot be verified, use `unknown` and require clarification. Do not infer
ownership from a path or assign a component absent from the supplied evidence.

## Required actions

Assign one primary action:

- `change_code`
- `change_test`
- `change_documentation`
- `provide_explanation`
- `resolve_conflict`
- `address_external_dependency`
- `request_clarification`
- `no_action_until_verified`

Use `request_clarification` when location, requirement, impact, expected
correction, or validity is materially uncertain. Use `no_action_until_verified`
for possibly unsubstantiated feedback that has no actionable evidence yet.
An action is a triage recommendation only; it does not authorize execution.

## Evidence and rationale

Every item classification must include:

- `evidence`: reproducible references and the observed feedback or behavior;
- `impact`: the concrete consequence established by the evidence, or
  `not established`;
- `classification_rationale`: why the cause, severity, component, and action
  follow from the evidence;
- `confidence`: `high`, `medium`, or `low`;
- `needs_discussion`: `true` when evidence, location, impact, severity,
  component, or action is uncertain;
- `discussion_reason`: the missing decision or evidence and how to resolve it
  when `needs_discussion` is true.

Useful references include:

- `handoff:CollectedReviewFeedback.groups[G-001].items[F-001]`
- `discussion:<thread-id>`
- `diff:<path>:<line-range>`
- `check:<name>`
- `issue:<reference>`
- `uncertainty:<id>`

Do not convert an uncertainty into a confirmed defect. Do not suppress an
uncertain item; retain it and make the uncertainty explicit.

## Workflow

1. Validate the single input handoff and exact pull-request identity.
2. Inventory all groups and preserve every item in source order.
3. Exclude resolved, outdated, and explicitly addressed items from open triage,
   while reporting their counts and preserved IDs.
4. For each open item, determine the requested correction, observed cause,
   smallest affected component, impact, severity, required action, confidence,
   and discussion status.
5. Compare feedback with supplied issue, diff, check, and discussion evidence
   only to resolve explicit relationships. Keep conflicts and external
   dependencies separate from code changes.
6. Verify that every open item has exactly one cause, severity, component,
   action, non-empty rationale, and evidence; verify no source text or item was
   changed, removed, split, or merged.
7. Return one English structured classification handoff and a concise
   conversational summary. The result is advisory and read-only.

## Output shape

Return exactly one version-1 `ClassifiedReviewFeedback` handoff with:

- `status`: `classified`, `partial`, or `blocked`;
- exact `pull_request` identity;
- `source` status, counts, unavailable fields, and evidence;
- `classifications`: one preserved entry per source item, including
  `triage_status` (`open`, `resolved`, `outdated`, or `addressed`), cause,
  severity, affected component, required action, evidence, impact, rationale,
  confidence, and discussion fields;
- `summary`: total, open, resolved, outdated, addressed, and uncertain counts;
- `unavailable_fields`;
- `failure`, null only when the output is `classified` or a valid `partial`;
- `recommended_next_skill`, advisory only.

For a blocked input, preserve known identity and source failure evidence and
recommend the producer or clarification needed. Never claim that an item was
classified when its required evidence was unavailable.

## Distinction from related skills

`classify-review-findings` normalizes existing review findings by review
domain and impact severity after deduplication. This skill triages collected
feedback by work cause, affected component, and follow-up action, including
requests for explanation, conflicts, external dependencies, and potentially
unsupported feedback. It does not replace finding detection, deduplication, or
review composition.
