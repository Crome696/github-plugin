# External capability resolution

The GitHub plugin coordinates collaboration and delivery. It does not contain
the technology, architecture, testing, security, documentation, or domain
knowledge needed to implement an application change. External capabilities
remain host-session identities: their implementation knowledge is not copied
into this plugin and they are never silently invented.

This boundary is normative in
[github-scope-contract.mdc](../../rules/github-scope-contract.mdc) and
[AGENTS.md](../../../AGENTS.md).

## One capability firewall

~~~mermaid
flowchart LR
  repository[Verified repository and task evidence]
  context[Context wrapper]
  feedback[Feedback wrapper]
  core[ExternalCapabilityResolution v1 pure core]
  result[Canonical resolution]
  implementation[External implementation capability]
  delivery[GitHub delivery skills]

  repository --> context
  repository --> feedback
  context --> core
  feedback --> core
  core --> result
  result --> implementation
  implementation --> delivery
  delivery -.->|validate evidence only| implementation
~~~

There is one policy implementation. The core receives normalized requirements
and a current host-session capability inventory and returns
ExternalCapabilityResolution v1. The two public resolver skills are thin
wrappers:

- resolve-context-capabilities derives requirements from one issue or
  implementation context and maps repository, issue, evaluation, affected-area,
  and convention references;
- resolve-feedback-capabilities validates one explicit selection of open
  feedback and maps pull-request, head, feedback-item, and implementation
  context references.

Wrappers do not decide availability, narrowest selection, priority, provenance,
ambiguity, stale-session behavior, or missing-gap impact. The shared core owns
those semantics so equivalent requirements and inventories yield equivalent
results across both entry points.

## Canonical contract

The source of truth is
[ExternalCapabilityResolution.yaml](../../shared/schemas/ExternalCapabilityResolution.yaml).
It is a version-1 read-only contract with:

- one verified context or feedback target;
- normalized, ordered requirements with type, relevance, priority, intended
  outcome, scope boundary, evidence, and source references;
- one resolution for every requirement;
- distinct available, unavailable, missing, and ambiguous statuses;
- exact session identity, current observation, and provenance for available
  results;
- explicit stale-session, unsupported-version, and identity-conflict evidence;
- blocking required gaps, warning optional gaps, and manual requirements;
- unresolved questions and structured failure evidence; and
- a policy record proving that resolution is pure and cannot execute or mutate.

The core preserves the order supplied by the wrapper. It matches candidates by
exact type and evidenced scope, chooses only one strict narrowest candidate,
and returns ambiguous when equally narrow candidates or conflicting identities
remain. A repository path, technology label, package name, generic capability
description, or prior task inventory is not host-session evidence.

An available result requires all of the following:

1. one exact session identity;
2. a candidate type and scope matching the requirement;
3. current, non-expired host-session inventory evidence; and
4. non-null session provenance preserved in the result.

Missing evidence is never promoted to available. A known but unusable
candidate is unavailable. No identified candidate is missing. Equal narrowest
candidates or conflicting identities are ambiguous. Required non-available
requirements block the result; optional non-available requirements remain
visible as warnings or manual requirements.

## Compatibility migration

ContextCapabilities v1 and FeedbackResolutionCapabilities v1 remain in the
repository only as transition projections for consumers that have not yet
migrated. They are not competing policy contracts.

An adapter may project a canonical result only when the mapping is lossless.
It must preserve source identity, feedback or issue scope, relevance, priority,
availability evidence, provenance, and gap impact. Canonical ambiguous,
stale-session, unsupported-version, identity-conflict, or otherwise
unrepresentable states return a blocked adapter result. Missing, unavailable,
or provenance-free evidence never becomes available during projection.

New producers and consumers must use ExternalCapabilityResolution v1. Legacy
consumers must declare their adapter boundary and must be removed only after
the downstream consumer has migrated and equivalent semantics are verified.
Rollback restores the wrapper, core, and consumer contract together; it never
restores only one resolver's policy.

## Workflow boundaries

### Planning

The preparation flow verifies the issue, repository, affected areas,
conventions, and implementation evaluation. The context wrapper then derives
requirements and delegates to the core. build-implementation-plan consumes the
canonical result and treats unavailable, missing, ambiguous, stale, and
identity-conflicting requirements as explicit blockers or risks.

The core does not create a worktree, write a plan, authorize implementation, or
invoke the resolved external capability.

### Feedback

The feedback flow loads one pull request and classifies its feedback. The
caller explicitly selects open item IDs. The feedback wrapper derives only
requirements for those IDs and delegates to the same core. The feedback
planning and lifecycle skills preserve the exact pull-request head, selected
IDs, availability evidence, and blocking or manual gaps.

Feedback authorization does not authorize review publication, thread replies,
thread resolution, rebase, merge, or cleanup.

### Delivery and CI

Delivery and CI workflows consume the canonical result only after their own
scope and authorization gates. External implementation and validation remain
host-session capabilities. The GitHub plugin validates returned evidence and
owns GitHub collaboration effects; it does not repair source code or invent
test or domain behavior.

## Cross-host scenario matrix

External contract and fixture validation must run the same matrix against
equivalent Cursor, Codex, and Claude inventories:

| Scenario | Required evidence and result |
| --- | --- |
| Equivalent requirements and inventories | Equivalent ordered canonical resolutions |
| One exact current candidate | available with exact session identity and provenance |
| Known but unusable candidate | unavailable, never available |
| No identified candidate | missing |
| Two equally narrow candidates | ambiguous with candidates preserved |
| Expired or stale session | unavailable with stale-session evidence |
| Unsupported requirement or inventory version | blocked with unsupported-version failure |
| Conflicting identity, type, or repository binding | ambiguous or blocked with identity-conflict evidence |
| Required missing or unavailable capability | blocked with a blocking gap |
| Optional missing or unavailable capability | partial with an explicit warning |
| Attempted install, authentication, configuration, network access, or execution | forbidden; no side effect |

The standalone repository intentionally has no local package metadata, test
runner, or fixture workspace. External validation must report the exact
contract version, host inventory, scenario inputs, outputs, and side-effect
observations. Missing external evidence is not a passing result.

## Required invariants

1. Exactly one shared core owns capability-firewall semantics.
2. Wrappers only derive requirements and map source references.
3. Current host-session evidence is required for availability.
4. Available, unavailable, missing, and ambiguous remain distinct.
5. Required gaps block and optional gaps remain explicit.
6. No install, load, authentication, configuration, network, execution, file,
   Git, or GitHub mutation occurs during resolution.
7. Repository-local references remain under plugin; external capability
   identities remain attributable to the host session.
