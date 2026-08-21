---
name: resolve-context-capabilities
description: Derive implementation-context capability requirements from verified issue and repository evidence, then delegate one shared pure resolution policy to the current host-session inventory without executing capabilities.
---

# Resolve Context Capabilities

Derive the external capability requirements for one verified implementation
context and pass them to the shared
[resolve-external-capabilities](../resolve-external-capabilities/SKILL.md) core.
Return one version-1
[ExternalCapabilityResolution](../../shared/schemas/ExternalCapabilityResolution.yaml)
with target.kind set to context and source.wrapper set to
resolve-context-capabilities.

This wrapper owns only context-specific requirement derivation and source
mapping. It does not decide availability, narrowest-candidate selection,
ambiguity, provenance, priority, missing-capability impact, or stale-session
semantics. Those decisions belong to the shared core.

## Boundaries

- Read one verified task or LoadedIssue, RepositoryContext, and supplied
  affected-area, convention, evaluation, and planning evidence.
- Read the current host-session capability inventory only as input to the
  shared core. Do not invoke a candidate to test availability.
- Never edit files, Git state, branches, worktrees, remotes, GitHub resources,
  generated artifacts, or external systems.
- Never install, load, authenticate, configure, execute, or copy an external
  Skill, Rule, Agent, Tool, or domain capability.
- Do not infer availability from a repository path, technology name, plugin
  file, documentation mention, or previous task.
- Preserve repository identity, issue identity, source references,
  unavailable inputs, conflicts, and uncertainty.
- Keep the canonical handoff and authored capability descriptions in English.

## Inputs

Require exactly one implementation context containing a task description,
issue title and body, or version-1 LoadedIssue. Require the current checkout
or a version-1 RepositoryContext. Accept, when supplied, version-1
AffectedAreas, ImplementationEvaluation, RepositoryConventions,
IssueAnalysis, and an explicit current-session capability inventory.

Validate every supplied handoff before using it. Accept only the supported
versions and return blocked for missing repository or task identity,
unsupported versions, duplicate source identity, or malformed evidence.
Return partial when a useful requirement set remains but material context or
inventory evidence is unavailable.

## Requirement derivation

Extract only capability needs supported by the task and repository evidence:

1. Implementation, testing, security, architecture, documentation, and
   domain signals named by the issue, evaluation, affected areas, or rules.
2. The narrowest repository-local Skill, Rule, Agent, Tool, or domain boundary
   that the later workflow may need. Repository-local paths are evidence and
   are not proof that an external capability is available.
3. Required versus optional relevance and high, medium, or low priority.
4. A concrete required outcome, intended usage, scope boundary, evidence list,
   source references, and confidence for every requirement.

Requirement IDs are stable within the result and must be unique. The wrapper
may group equivalent evidence only when the intended outcome, type, priority,
and scope boundary are the same. It must not resolve candidates or replace a
missing capability with a generic fallback.

For this repository, the wrapper must preserve the boundary that external
implementation, testing, security, architecture, and documentation knowledge
remains outside the GitHub plugin. It may reference the exact host-session
identity supplied by the inventory, but it must not copy that capability's
instructions into the result.

## Shared-core handoff

Pass the following normalized input to resolve-external-capabilities:

- target kind context;
- verified repository and issue identity, with pull_request set to null;
- ordered requirements derived from the validated evidence;
- input versions and wrapper source references; and
- the complete current host-session inventory, including observed and expiry
  evidence.

The core returns available, unavailable, missing, or ambiguous for every
requirement. A required non-available result is blocking. Optional gaps remain
explicit warnings or manual requirements. An available result must preserve a
current session identity and non-null session provenance.

Recommend build-implementation-plan only when the canonical result is
resolved or has a bounded partial result that the planning Skill can safely
consume. Never invoke the follow-up from this wrapper.

## Legacy transition adapter

ContextCapabilities v1 remains available only as a compatibility projection
for callers that have not migrated. The projection must preserve the exact
source references, availability evidence, required or optional relevance,
priority, and missing impact from the canonical result.

The adapter is lossless and fail-closed:

- available is emitted only when the canonical result is available and has
  current session provenance;
- unavailable and missing remain distinct in the legacy availability field;
- ambiguous, stale-session, unsupported-version, identity-conflict, or any
  other state not representable by ContextCapabilities returns a blocked
  adapter result; and
- the adapter never emits an available capability from missing evidence.

The canonical ExternalCapabilityResolution is the source of truth. This
wrapper must not construct a competing ContextCapabilities result first.

## Output requirements

Return exactly one ExternalCapabilityResolution v1. Preserve requirement
order and all source references. Set policy.resolution_pure to true and every
execution, installation, authentication, configuration, and network flag to
false. Set failure to null only when the canonical result is resolved.

The result must contain no implementation code, no copied external
capability knowledge, no installation or authentication instructions, and no
authorization to run a capability or continue delivery.

## Failure modes

- missing_input: task, repository, or required source evidence is absent;
- invalid_input: supplied evidence is malformed or requirement derivation
  cannot be made deterministic;
- unsupported_version: a supplied handoff or inventory is not supported;
- identity_conflict: repository, issue, or source identities disagree;
- insufficient_context: a useful but incomplete result remains; and
- resolution_failure: the shared core could not produce a reliable result.

The shared core owns stale_session, availability, ambiguity, and missing
semantics. Do not reimplement those cases in this wrapper.
