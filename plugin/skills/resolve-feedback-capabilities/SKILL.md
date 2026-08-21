---
name: resolve-feedback-capabilities
description: Derive capability requirements for explicitly confirmed open pull-request feedback, then delegate one shared pure resolution policy to the current host-session inventory without executing capabilities.
---

# Resolve Feedback Capabilities

Derive requirements only for explicitly selected feedback items and pass them
to the shared
[resolve-external-capabilities](../resolve-external-capabilities/SKILL.md) core.
Return one version-1
[ExternalCapabilityResolution](../../shared/schemas/ExternalCapabilityResolution.yaml)
with target.kind set to feedback and source.wrapper set to
resolve-feedback-capabilities.

This wrapper owns only feedback selection validation, requirement derivation,
and source-specific mapping. It does not decide availability, narrowest
selection, ambiguity, provenance, priority, missing impact, or stale-session
semantics. Those decisions belong to the shared core.

## Boundaries

- Read one pull-request identity, one version-1 ClassifiedReviewFeedback
  handoff, the explicitly confirmed open feedback IDs, optional implementation
  context, and the current host-session capability inventory.
- Resolve only selected IDs whose triage_status is open. Never reactivate,
  reinterpret, or assign work to resolved, outdated, addressed, uncertain,
  excluded, or unsubstantiated items.
- Never edit files, Git state, branches, worktrees, GitHub resources, review
  threads, checks, generated artifacts, or external systems.
- Never install, load, authenticate, configure, execute, or copy an external
  Skill, Rule, Agent, Tool, or domain capability.
- Do not infer availability from a repository path, technology label, plugin
  file, familiar name, or generic framework knowledge.
- Preserve pull-request identity, head SHA, feedback IDs, evidence,
  uncertainty, unavailable inputs, and scope boundaries.
- Keep the canonical handoff and authored capability descriptions in English.

## Inputs and validation

Require one pull request, one ClassifiedReviewFeedback v1 with status
classified or partial, a non-empty explicit selection of confirmed feedback
IDs, and an explicitly supplied current-session capability inventory. Accept
optional CollectedReviewFeedback v1 and prose ImplementationContext as
evidence only.

Validate that the repository, pull-request number, canonical URL, and head SHA
agree across inputs; every selected ID exists exactly once and is open; and
each selected item contains a cause, required action, affected component,
evidence, impact, and confidence. Return blocked for missing identity,
selection, malformed fields, unsupported versions, duplicate or unknown IDs,
or identity conflicts. Return partial when a useful requirement set remains
but material capability or evidence is unavailable.

## Requirement derivation

Derive one or more normalized requirements from each selected feedback item.
Use the narrowest evidenced need:

- technology or project behavior requires a matching implementation or domain
  capability only when that capability is exposed;
- architecture feedback requires the narrowest architecture boundary named by
  the evidence;
- test or verification feedback records the required outcome without
  inventing a test framework or command;
- security feedback records the supplied rule or security boundary without
  copying security implementation knowledge; and
- documentation feedback records the exact documentation outcome and leaves
  authoring to the external capability when one is available.

Every requirement contains a stable unique ID, type, required or optional
relevance, priority, required outcome, intended usage, scope boundary,
evidence, source references, and confidence. Preserve the selected feedback
IDs in source references and in the requirement evidence. Do not merge
distinct causal mechanisms merely because they affect the same file.

## Shared-core handoff

Pass the following normalized input to resolve-external-capabilities:

- target kind feedback;
- verified repository and pull-request identity, with issue set to null;
- ordered requirements derived only from the selected open feedback;
- input versions and exact feedback, pull-request, and implementation-context
  references; and
- the complete current host-session inventory, including observed and expiry
  evidence.

The core returns available, unavailable, missing, or ambiguous for every
requirement. A required non-available result is blocking. Optional gaps remain
explicit warnings or manual requirements. An available result must preserve a
current session identity and non-null session provenance.

Recommend build-feedback-resolution-plan only when the canonical result is
resolved or has a bounded partial result that the planning Skill can safely
consume. Never invoke the follow-up from this wrapper.

## Legacy transition adapter

FeedbackResolutionCapabilities v1 remains available only as a compatibility
projection for callers that have not migrated. The projection must preserve
pull-request identity, head SHA, selected feedback IDs, source references,
availability evidence, priority, and blocking or manual impact.

The adapter is lossless and fail-closed:

- available is emitted only when the canonical result is available and has
  current session provenance;
- unavailable and missing remain distinct in the legacy availability field;
- ambiguous, stale-session, unsupported-version, identity-conflict, or any
  other state not representable by FeedbackResolutionCapabilities returns a
  blocked adapter result; and
- the adapter never emits an available capability from missing evidence.

The canonical ExternalCapabilityResolution is the source of truth. This
wrapper must not construct a competing FeedbackResolutionCapabilities result
first.

## Output requirements

Return exactly one ExternalCapabilityResolution v1. Preserve requirement
order, selected feedback IDs, pull-request identity, head SHA, and all source
references. Set policy.resolution_pure to true and every execution,
installation, authentication, configuration, and network flag to false. Set
failure to null only when the canonical result is resolved.

The result must contain no implementation code, no copied external
capability knowledge, no installation or authentication instructions, and no
authorization to run a capability or mutate a pull request.

## Failure modes

- missing_input: pull-request identity, feedback selection, classification,
  or required source evidence is absent;
- invalid_input: supplied evidence is malformed or requirement derivation
  cannot be made deterministic;
- unsupported_version: a supplied handoff or inventory is not supported;
- identity_conflict: repository, pull-request, head, or feedback identities
  disagree;
- insufficient_context: a useful but incomplete result remains; and
- resolution_failure: the shared core could not produce a reliable result.

The shared core owns stale_session, availability, ambiguity, and missing
semantics. Do not reimplement those cases in this wrapper.
