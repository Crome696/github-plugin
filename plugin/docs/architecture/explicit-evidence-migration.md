# Explicit Evidence Migration

Version `0.3.112` replaces implicit UI screenshot enforcement with an explicit
evidence contract. The GitHub plugin coordinates and validates evidence; it
does not capture screenshots or implement a project-specific UI validator.

## Contract changes

Before this migration, `ValidationResult v1` could be treated as complete even
when a consumer inferred UI evidence from framework dependencies, UI-looking
filenames, `index.html`, generated artifact names, or a fixed screenshot
directory. That inference was not a declared requirement and made the result
depend on repository heuristics.

The new contract is:

- `ImplementationPlan.validation.evidence_requirements` and
  `PullRequestFixPlan.validation.evidence_requirements` are additive inputs.
- `ValidationResult v2.evidence_requirements` is mandatory, including when it
  is an empty list.
- Every normalized entry preserves its `id`, exact requirement text, source
  kind and reference, expected evidence kind, location or `null`, and optional
  required capability. It adds `satisfied`, `missing`, or `blocked` status and
  concrete evidence references.
- A missing or blocked explicit requirement prevents `status: passed` and both
  readiness flags. An unavailable external capability blocks only when the
  requirement names that capability as required.
- `generated_artifacts` keeps its existing repository-relative path format and
  remains accepted for compatibility. It is descriptive only and never creates
  a screenshot requirement.

The related local gate versions are `PreCommitGate v3` and
`PrePrCreateGate v2`. Old or mixed snapshots fail closed; all producers and
consumers must be refreshed together.

## Migration procedure

1. Add only requirements explicitly present in the issue, approved plan,
   verified repository policy, or resolved external capability evidence.
2. Use `expected_kind: ui_screenshot` for a declared UI screenshot requirement
   and provide its exact repository-relative `location`, or `null` when the
   requirement has no fixed location.
3. Record the concrete evidence references and set the outcome status. Use an
   empty list when the task has no explicit evidence requirement, including for
   non-UI work or work that happens to contain screenshot-like paths.
4. Regenerate the current `ValidationResult`, `PreCommitGate`, and
   `PrePrCreateGate` snapshots. Do not merge fields from old and new versions.
5. Re-run the applicable contract, hook, runtime, scenario, and host-projection
   validation through the available external testing capability before
   committing or publishing a pull request.

Screenshot capture remains the responsibility of an authorized external
capability or the project that owns the UI. There is no repository-local
screenshot-capture skill, fallback skill, or fixed
repository screenshot-manifest convention in this plugin.

## Pull-request fix-plan migration

`PullRequestFixPlan v1` is now the common evidence input for review, feedback,
and CI-fix delivery. Its `source_kind` discriminator is carried into every
validation mapping, and its head-bound scope, workspace, authorization,
required checks, and evidence requirements must refer to the same current
head. Review findings, review feedback, and required-check failures remain
tagged source variants; locations, IDs, resolution groups, wait/rerun
references, failure evidence, and reassessment requirements are never
flattened or discarded.

`ReviewFixPlan v1`, `CiFixPlan v1`, and `FeedbackResolutionPlan v1` remain
legacy inputs only. A lossless, fail-closed adapter must prove all common and
source-specific fields, exact repository/PR/base/head identity, scope
boundaries, evidence freshness, and authorization state. Missing fields,
mixed heads, source-kind conflicts, stale evidence, or non-representable
authorization block conversion. The adapter never creates new commit, push,
thread, review, Ready-for-Review, rebase, merge, deletion, cleanup, or
default-branch authorization. `FeedbackLifecyclePlan v1` remains separate as
the feedback lifecycle/effect authority.

## Rollback

Rollback means reverting the complete `0.3.112` release as one compatible
plugin change and restoring the matching pre-migration contracts, fixtures,
hooks, and projections. A rollback must not restore framework heuristics,
filename/path inference, the fixed screenshot directory, or a reference to a
nonexistent capture skill. Existing `generated_artifacts` paths can remain in
the data, but they must not be interpreted as evidence requirements by either
release.
