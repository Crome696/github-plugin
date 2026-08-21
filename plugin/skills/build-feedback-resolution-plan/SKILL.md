---
name: build-feedback-resolution-plan
description: Build a read-only, evidence-backed resolution plan from explicitly confirmed open pull-request feedback and supplied ImplementationContext. Group related problems, define bounded corrections, affected areas, dependencies, validations, risks, and external implementation handoffs without executing changes or expanding scope.
---

# Build Feedback Resolution Plan

Create exactly one version-1
[`FeedbackResolutionPlan`](../../shared/schemas/FeedbackResolutionPlan.yaml)
handoff for external implementation capabilities. This Skill plans confirmed
follow-up work; it never implements, authorizes, or publishes that work.

## Boundaries

- Read supplied handoffs, repository evidence, and the provided prose
  `ImplementationContext` only. Never edit files, Git state, GitHub resources,
  review threads, checks, or external systems.
- Require one pull-request identity, one version-1
  `ClassifiedReviewFeedback`-compatible input, and an explicit non-empty
  selection of confirmed feedback item IDs.
- Plan only selected items whose `triage_status` is `open`. Never reactivate,
  reinterpret, or plan changes for `resolved`, `outdated`, or `addressed`
  items.
- Preserve source text, IDs, locations, references, evidence, status, and
  uncertainty. Do not invent paths, ownership, architecture, requirements,
  commands, dependencies, or test results.
- Group items only when their problem core, causal mechanism, affected area,
  and expected correction are equivalent. Keep different causes separate.
- Do not execute or invoke external implementation capabilities. Name required
  capabilities and outcomes as handoffs only.
- Do not infer authorization from confirmation, review state, an existing issue
  plan, or this plan's status. This handoff does not authorize implementation.
- Keep authored handoff content in English. Conversational explanations may
  follow the user's language.

## Inputs and validation

Accept:

- one version-1 `ClassifiedReviewFeedback` handoff as described by
  `classify-review-feedback`;
- `confirmed_feedback_item_ids`, explicitly selected by the caller; and
- supplied prose `ImplementationContext`.

Accept an optional version-1
[`ExternalCapabilityResolution`](../../shared/schemas/ExternalCapabilityResolution.yaml)
handoff. When supplied, it must identify the same pull request, head SHA, and
confirmed feedback item IDs. Preserve its capability assignments, boundaries,
availability, blockers, and manual requirements in the resulting plan. Do not
resolve capabilities again or treat a capability's availability as execution
authorization.

FeedbackResolutionCapabilities v1 is accepted only as a validated, lossless
transition adapter. An ambiguous, stale-session, unsupported-version, or
identity-conflict state must remain blocked rather than being downgraded.

`ImplementationContext` is not a schema in this repository. Treat it as
evidence only where it explicitly identifies the same pull request and head
SHA, scope boundaries, repository or architecture facts, available
validation evidence, dependencies, or external capability requirements.
Preserve its source reference and do not normalize unsupported statements into
requirements.

Return `blocked` when identity, version, selected IDs, or required
classification fields are missing, malformed, or conflicting. Return
`partial` when a bounded plan remains useful but context, paths, corrections,
dependencies, or validations are materially unavailable. Uncertain items,
`needs_discussion: true`, `unclassified` severity, conflicts, external
dependencies, and possibly unsubstantiated feedback must not become ordinary
implementation steps; retain them as blockers, unresolved questions, or
external handoffs. A supplied ExternalCapabilityResolution handoff with a
blocking gap must remain a
blocker; a manual requirement must remain explicit in the plan.

## Scope and evidence model

The selected feedback is the complete planning scope. The original
implementation context may narrow that scope, but cannot expand it. Record
explicit `in_scope` and `out_of_scope` boundaries. A step must reference at
least one selected feedback item and use only paths supported by feedback,
verified diff/repository evidence, or explicit `ImplementationContext`.

Every group and step must preserve reproducible evidence, a concrete expected
correction, confidence, and the smallest affected area available. Separate
hypotheses and missing evidence under `unresolved_questions`; never promote
them to confirmed defects or implementation work.

## Workflow

1. Validate the exact pull-request identity and the input's version and status.
2. Verify that every selected ID exists exactly once and is `open`; record
   excluded IDs and exclusion reasons without changing the source.
3. Compare selected items by problem core, causal mechanism, location, and
   correction. Create ordered resolution groups without merging distinct
   mechanisms.
4. For each group, define the bounded action, expected outcome, affected paths,
   dependencies, validation expectations, risks, non-goals, and external
   implementation handoff.
5. Use `ImplementationContext` to constrain ordering and corroborate evidence.
   Record contradictions as blockers or unresolved questions.
6. Derive validations only from supplied acceptance, repository, check, test,
   or context evidence. Describe unknown validation needs without fabricating
   executable commands.
7. Set `planned` only when every selected actionable item has a reliable
   bounded plan. Use `partial` for material limitations and `blocked` when
   reliable scope or identity cannot be established.
8. Return exactly one English `FeedbackResolutionPlan`. The result is a
   planning handoff, not source code, a checklist without traceability, or
   execution authorization.

## Output requirements

The handoff must contain the contract's exact pull-request identity, source and
context provenance, selected and excluded IDs, scope guard, ordered
`resolution_groups`, external handoffs, blockers, unresolved questions,
validation, risks, metadata, and structured failure. `recommended_next_capability`
is advisory and must not claim that a capability was executed.

## Failure modes

- `missing_input`: required handoff, selection, identity, or context is absent.
- `invalid_input`: supplied data cannot be parsed or required fields are absent.
- `unsupported_version`: a supplied contract is not version 1.
- `conflicting_evidence`: identity, scope, correction, or context evidence
  conflicts materially.
- `insufficient_context`: a useful but incomplete plan can still be returned.
- `planning_failure`: valid inputs were accepted but no reliable plan could be
  produced.
