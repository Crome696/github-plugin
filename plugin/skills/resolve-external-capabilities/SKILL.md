---
name: resolve-external-capabilities
description: Apply the shared pure capability-firewall policy to normalized context or feedback requirements and a current host-session inventory without executing, installing, or mutating any capability.
disable-model-invocation: true
---

# Resolve External Capabilities

Apply one deterministic policy to normalized capability requirements from the
context and feedback wrappers. Return exactly one version-1
[ExternalCapabilityResolution](../../shared/schemas/ExternalCapabilityResolution.yaml)
handoff. This is an internal core: it does not load the issue, inspect
repository architecture, classify feedback, or derive domain requirements.
The wrapper owns those source-specific operations.

## Contract boundary

The input contains:

- one verified repository target;
- one wrapper-selected target kind, either context or feedback;
- normalized requirements with type, relevance, priority, intended outcome,
  scope boundary, evidence, and source references; and
- one current host-session capability inventory.

The inventory must expose, for every candidate, an exact stable identity such
as session:skill:name, a capability type, a bounded description, an observed
timestamp, an optional expiry, and inventory-source evidence. A repository
path, technology label, familiar capability name, or prior inventory is not
session evidence.

The core may read supplied values and compare them. It must never install,
load, authenticate, configure, invoke, execute, probe, or otherwise mutate a
capability. It must not write files, Git state, GitHub resources, or generated
artifacts. It must not use network access to improve the inventory.

## Deterministic resolution policy

1. Validate the wrapper, repository target, input versions, requirement IDs,
   requirement types, and inventory shape. Preserve unavailable inputs.
2. Reject unsupported versions, duplicate requirement IDs, malformed
   identities, and target identity conflicts with a structured failure.
3. Match candidates by exact capability type and the explicitly described
   scope. Do not match by generic fallback, technology coincidence, or model
   confidence.
4. Apply narrowest-applicable selection. A single strict narrowest candidate is
   eligible; two candidates at the same narrowest specificity are ambiguous.
5. A candidate is available only when its identity is exact, the inventory
   evidence is current, the expiry has not passed, the candidate type and scope
   agree with the requirement, and the result carries non-null
   session_provenance. Preserve the identity in both capability and evidence.
6. A known candidate that is stale, expired, unsupported, unauthorized, or not
   usable in the current session is unavailable. Use stale_session failure
   evidence when stale evidence is the reason.
7. A requirement with no identified candidate is missing.
8. A conflicting identity, source, type, or repository/target binding is
   ambiguous and must not be reduced to available.
9. Record every non-available result in gaps. Use blocking for required
   requirements; use warning for optional missing or unavailable needs; use
   manual_required when an owner or decision is needed to resolve ambiguity.
10. Return resolved only when all required requirements are available and no
    blocking gap or unresolved identity remains. Return partial when the
    result is useful but only optional gaps or non-blocking evidence limits
    remain. Return blocked for invalid input, unsupported versions, identity
    conflicts, or a required non-available requirement.

The core preserves the order supplied by the wrapper. It does not deduplicate
requirements by display name; duplicate IDs are invalid, while distinct
requirements may intentionally point to the same exact session identity.

## Output rules

Populate the canonical contract fields exactly:

- requirements is the normalized wrapper input;
- resolutions contains one result for every requirement;
- gaps contains every unavailable, missing, or ambiguous result;
- unresolved_questions preserves unresolved identity, owner, or scope
  decisions;
- policy always records resolution_pure: true and all execution,
  installation, authentication, configuration, and network flags as false;
- recommended_next_skill is build-implementation-plan for context,
  build-feedback-resolution-plan for feedback, or none when blocked; and
- failure is null only for a complete resolved result.

The output must keep available, unavailable, missing, and ambiguous distinct.
Do not emit a legacy ContextCapabilities or
FeedbackResolutionCapabilities object from this core.

## Compatibility boundary

The existing ContextCapabilities v1 and FeedbackResolutionCapabilities v1
schemas are transition projections only. A wrapper may request a projection
after the canonical result exists, but only a lossless mapping is allowed.
Canonical ambiguous, stale-session, unsupported-version, identity-conflict,
or otherwise unrepresentable evidence returns a blocked adapter result. No
adapter may turn missing, unavailable, or missing provenance into available.

## Scenario matrix

External contract and host fixtures must exercise the same matrix for Cursor,
Codex, and Claude inventories:

| Scenario | Expected resolution |
| --- | --- |
| equivalent requirements and inventory | equivalent ordered results |
| one current exact candidate | available with session provenance |
| known but unusable or unavailable candidate | unavailable |
| no identified candidate | missing |
| equal narrowest candidates | ambiguous |
| expired or stale session evidence | unavailable with stale-session evidence |
| unsupported requirement or inventory version | blocked with unsupported-version failure |
| conflicting identity, type, or repository binding | ambiguous or blocked with identity-conflict evidence |
| required missing capability | blocked with a blocking gap |
| optional missing capability | partial with an explicit warning |
| any attempted install, auth, config, network, or execution | forbidden; no side effect |

The repository deliberately does not contain a local test runner or fixture
workspace. External validation must execute these scenarios against this
contract and report the exact host inventory and evidence used. Absence of that
external evidence is not a pass.
