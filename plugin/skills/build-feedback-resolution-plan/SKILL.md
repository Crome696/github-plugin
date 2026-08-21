---
name: build-feedback-resolution-plan
description: Build one host-neutral version-1 PullRequestFixPlan with source_kind feedback from explicitly confirmed open pull-request feedback and supplied implementation context, preserving resolution groups and external handoffs without authorizing changes.
---

# Build Feedback Resolution Plan

Create exactly one version-1 `PullRequestFixPlan` with
`source_kind: feedback` for external implementation capabilities. This Skill
plans confirmed follow-up work; it never implements, authorizes, publishes,
or executes that work.

`FeedbackLifecyclePlan v1` remains the lifecycle and effect authority. This
plan is a bounded fix-plan handoff inside that lifecycle; it is not a second
lifecycle and does not replace lifecycle transitions or effect records.

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
  capabilities and outcomes as `review_feedback.external_handoffs` only.
- Do not infer authorization from confirmation, review state, an existing
  issue plan, or this plan's status. This handoff is non-authorizing.
- Keep authored handoff content in English. Conversational explanations may
  follow the user's language.

## Inputs and validation

Accept:

- one version-1 `ClassifiedReviewFeedback` handoff;
- `confirmed_feedback_item_ids`, explicitly selected by the caller; and
- supplied prose `ImplementationContext`.

Accept an optional version-1
`ExternalCapabilityResolution` handoff. When supplied, it must identify the
same repository, pull request, base, head SHA, and confirmed feedback IDs.
Preserve capability assignments, boundaries, availability, blockers, and
manual requirements. Do not resolve capabilities again or treat availability
as execution authorization.

`FeedbackResolutionCapabilities v1` is accepted only as a validated,
lossless, fail-closed transition adapter. An ambiguous, stale-session,
unsupported-version, or identity-conflict state remains blocked rather than
downgraded.

Return `blocked` when identity, version, selected IDs, source kind, or
required classification fields are missing, malformed, or conflicting. Return
`partial` when a bounded plan remains useful but context, paths, corrections,
dependencies, or validations are materially unavailable. Uncertain items,
`needs_discussion: true`, unclassified severity, conflicts, external
dependencies, and unsubstantiated feedback remain blockers, unresolved
questions, or external handoffs; they do not become ordinary mandatory work.

## Common plan and evidence model

The result uses the common `PullRequestFixPlan v1` contract with:

- `source_kind: feedback`;
- `candidate_kind: review_feedback` for every selected group;
- `review_feedback.feedback_item_ids` and `resolution_group_ids` preserved;
- `affected_areas`, `dependencies`, `non_goals`, validation, and
  `external_handoffs` preserved without flattening; and
- `authorization.implementation_authorized`, `commit_authorized`, and
  `push_authorized` set only from supplied evidence, normally false for this
  read-only planning handoff.

The selected feedback is the complete planning scope. The original
implementation context may narrow that scope, but cannot expand it. Record
explicit `in_scope`, `out_of_scope`, `exact_path_allowlist`, a scope guard,
and the source head SHA. Every step references at least one selected feedback
item and uses only paths supported by feedback, verified diff/repository
evidence, or explicit context.

## Workflow

1. Validate exact pull-request, base, head, source, and input versions.
2. Verify every selected ID exists exactly once and is `open`; record excluded
   IDs and reasons without changing the source.
3. Compare selected items by problem core, causal mechanism, location, and
   correction. Create ordered resolution groups without merging distinct
   mechanisms.
4. For each group, preserve the bounded correction, affected paths,
   dependencies, validations, risks, non-goals, and external handoff.
5. Use `ImplementationContext` only to constrain ordering and corroborate
   evidence; record contradictions as blockers or unresolved questions.
6. Derive validations only from supplied acceptance, repository, check, test,
   or context evidence. Do not fabricate executable commands.
7. Set `confirmed` only when every selected actionable item has a reliable
   bounded plan and no blocker remains; use `partial` or `blocked` otherwise.
8. Return exactly one English common plan. It is a planning handoff, not
   source code, execution authorization, or a lifecycle state machine.

## Adapter and safety rules

A legacy `FeedbackResolutionPlan v1` may enter only through the explicit
`FeedbackResolutionPlan -> PullRequestFixPlan` adapter with
`source_kind: feedback`. All IDs, resolution groups, affected areas,
dependencies, non-goals, external handoffs, source/head evidence, scope
limits, and non-authorizing state must be present and losslessly traceable.
Missing fields, stale evidence, mixed heads, a source-kind conflict, or a
non-representable state produces `blocked`; conversion never creates commit,
push, thread, review, Ready-for-Review, rebase, merge, deletion, cleanup, or
default-branch authorization.

Before returning, validate the common schema, tagged variant mapping, exact
identity, selected IDs, lossless source evidence, mandatory/excluded/clarify
invariants, scope guard, capability provenance, non-authorizing state, and
explicit limitations. Recommend the next capability only as an advisory
handoff.
