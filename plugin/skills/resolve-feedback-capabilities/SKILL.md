---
name: resolve-feedback-capabilities
description: Resolve available external skills and rules needed for explicitly confirmed open pull-request feedback across technology, architecture, testing, security, and documentation. Use automatically before building a feedback resolution plan; report unavailable or missing capabilities as blocking or manual requirements without executing capabilities or duplicating implementation knowledge.
---

# Resolve Feedback Resolution Capabilities

Resolve exactly one version-1
[`FeedbackResolutionCapabilities`](../../shared/schemas/FeedbackResolutionCapabilities.yaml)
handoff for one pull request. This Skill identifies the narrowest available
external capabilities needed by explicitly confirmed open feedback; it does not
implement, authorize, or publish the resulting work.

## Boundaries

- Read supplied handoffs, bounded repository or implementation-context
  evidence, and the current host-session capability inventory only. Never edit
  files, Git state, branches, worktrees, GitHub resources, review threads,
  checks, or external systems.
- Never execute, invoke, install, authenticate, configure, or load a resolved
  Skill, Rule, Agent, Tool, or domain capability.
- Require one pull-request identity, one version-1
  `ClassifiedReviewFeedback` handoff, and an explicit non-empty selection of
  confirmed feedback item IDs.
- Resolve only selected items with `triage_status: open`. Never reactivate,
  reinterpret, or assign implementation capability to `resolved`, `outdated`,
  `addressed`, excluded, uncertain, or unsubstantiated items.
- Do not infer availability from a repository path, technology label, plugin
  file, familiar capability name, or generic framework knowledge. `available`
  requires current host-session evidence.
- Do not duplicate technology, architecture, testing, security, documentation,
  domain, or product implementation knowledge in the GitHub plugin. Select an
  external capability and record its boundary instead.
- Preserve pull-request identity, feedback IDs, evidence, uncertainty, and
  unavailable inputs. Never invent paths, requirements, commands, test results,
  ownership, or dependencies.
- Keep the handoff and authored capability descriptions in English. The Skill
  has no implementation or delivery authorization.

## Inputs and validation

Accept:

- one version-1 `ClassifiedReviewFeedback` handoff with status `classified` or
  `partial`;
- `confirmed_feedback_item_ids`, explicitly selected by the caller;
- optional version-1 `CollectedReviewFeedback`;
- optional prose `ImplementationContext`, treated as evidence only; and
- an explicitly supplied current-session capability inventory.

Validate that:

1. The repository, pull-request number, canonical URL, and head SHA identify one
   target and agree across all supplied handoffs.
2. Every selected ID exists exactly once and has `triage_status: open`.
3. Selected items have valid cause, required action, evidence, and confidence.
4. A capability marked `available` has a `session:` evidence reference that is
   actually exposed by the current host session.
5. Supplied handoff versions are `1`; preserve unavailable fields and conflicts.

Return `blocked` for missing identity, missing selection, malformed required
fields, unsupported versions, duplicate or unknown IDs, or identity conflicts.
Return `partial` when a useful resolution remains but material context,
capability inventory, evidence, or boundaries are unavailable. Do not convert a
partial result into a complete availability claim.

## Capability focus

Derive needs from the selected feedback's `cause`, `required_action`,
`affected_component`, evidence, impact, and classification rationale. Use
implementation context only when it explicitly corroborates the same pull
request and head SHA.

Assess only evidence-backed signals in these areas:

- **Technology** — framework, language, runtime, library, or tool needs named by
  supplied evidence.
- **Architecture** — component boundaries, APIs, dependencies, or integration
  constraints explicitly supported by the feedback or context.
- **Testing** — required test changes or verification outcomes; do not invent
  commands or project-specific test strategy.
- **Security** — concrete security implications or supplied security rules;
  do not provide security expertise that is not available in the session.
- **Documentation** — explicit documentation changes or repository-backed
  documentation requirements.

Map `cause` and `required_action` to a capability need without assuming that
every item requires implementation:

- `code_change` / `change_code` may require an external implementation or
  project-domain capability.
- `test` / `change_test` requires a verified testing capability only when one is
  exposed; otherwise record the missing or manual requirement.
- `documentation` / `change_documentation` requires an exposed documentation
  capability or a manual owner.
- `explanation` / `provide_explanation` is an explanation handoff, not a code
  implementation capability.
- `conflict` / `resolve_conflict` requires an explicit owner or user decision;
  do not represent it as ordinary implementation work.
- `external_dependency` / `address_external_dependency` requires a named
  external owner, service, permission, or dependency capability when evidenced.
- `possibly_unsubstantiated` / `no_action_until_verified` is not eligible for
  normal capability assignment and remains an unresolved question or blocker.

## Availability and gap semantics

Use only these capability types: `skill`, `rule`, `agent`, `tool`, and `domain`.
Keep capability type distinct from feedback execution outcome.

- `available`: the exact capability is exposed by the current session.
- `unavailable`: a specific capability is known but cannot be used in the
  current session.
- `missing`: a capability need is evidenced, but no specific capability was
  identified.

Set `relevance` to `required` or `optional`, independently from `priority`
(`high`, `medium`, `low`). Every entry must state its intended usage and scope
boundary. Record unavailable or missing entries in both `capabilities` and
`missing_capabilities`.

Use `impact: blocking` when the gap prevents a reliable resolution plan or
execution boundary. Use `impact: manual_required` when a human owner, decision,
external system, or unavailable expertise is required but the bounded handoff
can still be recorded. Keep the exact evidence for that classification.

## Workflow

1. Validate one pull-request identity, the version-1 classification, and the
   explicit selected item IDs.
2. Exclude and explain every classification not selected or not eligible.
3. Extract technology, architecture, testing, security, documentation, risk,
   and dependency signals from the selected feedback and supplied context.
4. Inspect only the current session's exposed capability names and boundaries.
   An external technology, testing, security, documentation, or domain
   capability may be recorded by its exact `session:` identity and availability
   evidence. Do not search another plugin, copy its content, or invoke a
   candidate to test availability.
5. Select the narrowest capability for each evidenced need. Group items only
   when their required outcome, causal mechanism, affected area, and
   capability boundary are equivalent.
6. Record available capabilities with session evidence and record every known
   unavailable or unidentified required capability as a gap.
7. Preserve conflicts, uncertain evidence, unsubstantiated feedback, and
   missing context under `blockers` or `unresolved_questions`.
8. Set `resolved` only when all selected actionable needs have reliable
   capability and boundary evidence. Use `partial` for material limitations and
   `blocked` for failed preconditions.
9. Recommend at most one `build-feedback-resolution-plan` next Skill. Never
   invoke it.
10. Return exactly one English version-1
    `FeedbackResolutionCapabilities` handoff.

## Failure modes

- `missing_input`: required classification, identity, selection, or capability
  inventory is absent.
- `invalid_input`: supplied data is malformed or required fields are missing.
- `unsupported_version`: a supplied handoff is not version 1.
- `conflicting_evidence`: identity, scope, evidence, or capability boundaries
  conflict materially.
- `insufficient_context`: a useful but incomplete resolution can still be
  returned.
- `resolution_failure`: valid inputs were accepted but no reliable resolution
  result could be produced.
