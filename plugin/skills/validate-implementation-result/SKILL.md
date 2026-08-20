---
name: validate-implementation-result
description: Consolidates implementation-result evaluation with working-tree inspection, change classification, and scope gates to determine whether commit or draft pull-request preparation is factually ready. Use automatically after an implementation when completion criteria, required validations, or scope alignment must be verified; never modify files, commit, push, or publish a pull request.
---

# Validate Implementation Result

Consolidate the completed implementation's functional result with its
`ImplementationPlan` or `ReviewFixPlan`, `WorkingTreeInspection`, `ChangeClassification`, and
conditional `UnrelatedChangeDetection` evidence. Check scope, acceptance and
completion criteria, planned steps, required validations, unexpected changes,
and explicit deviations. It incorporates the implementation-result evaluation
concerns without requiring a separate `evaluate-implementation-result`
handoff. Return exactly one version-2
[`ValidationResult`](../../shared/schemas/ValidationResult.yaml) handoff with
evidence and diagnostic commit and draft-pull-request readiness. This Skill
does not authorize or perform a Git or GitHub operation.

## Boundaries

- Read supplied version-1 handoffs, bounded repository files, non-secret diff
  evidence, and read-only Git metadata only.
- Never edit files, the index, branches, worktrees, Git administrative state,
  remotes, or GitHub resources.
- Never run `git add`, `rm`, `mv`, `checkout`, `switch`, `reset`, `restore`,
  `clean`, `rebase`, `merge`, `cherry-pick`, `commit`, `push`, `worktree add`,
  `worktree remove`, hooks, formatters, installers, migrations, or other
  change-producing operations.
- Run a required test or validation command only when the supplied
  `ImplementationPlan` explicitly identifies it and bounded evidence confirms
  that it does not mutate the checkout or external state. If that safety
  property cannot be established, record `not_run` with a concrete reason;
  never silently treat it as passed.
- Do not invoke `inspect-working-tree`, `classify-changes`,
  `detect-unrelated-changes`, or another Skill automatically. A recommended
  next Skill is advisory and never grants authorization.
- Do not provide framework, domain, product, source-code implementation, or
  project-specific testing guidance. Consume supplied project-specific
  requirements and validation commands as evidence only.
- Do not infer scope from a branch name, commit message, filename convention,
  or the existence of a changed file. Do not invent completion criteria,
  expected outputs, deviations, or test results.
- Redact secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, and sensitive command output from all evidence.
- Keep the structured handoff and authored report text in English. Questions
  and explanations may follow the user's conversation language.

## Required input

Accept exactly one expected implementation result with these version-1
handoffs:

1. `WorkingTreeInspection`
   (`status: inspected`, or `status: partial` with trusted identity and a
   useful path inventory).
2. `ChangeClassification`
   (`status: classified`, or `status: partial` with trusted identity and a
   useful change list).
3. Either `ImplementationPlan` with its `validation`, scope, acceptance
   criteria, implementation steps, and workspace values, or `ReviewFixPlan`
   with its confirmed review-fix scope, implementation steps, validation, and
   workspace values.

The effective workspace identity is the intersection of the supplied
repository, branch, worktree path, and observed head revision. A missing or
conflicting identity is a blocker; never substitute the current checkout.
Accept these optional inputs when supplied:

- `UnrelatedChangeDetection`, required when classification reports
  `scope_alignment: drift` or `unknown`, or when
  `out_of_scope_or_foreign_paths` or `uncertain_paths` is non-empty.
- `LoadedIssue` for exact issue requirements and acceptance evidence.
- `IssueAnalysis` for evidence-based readiness and requirement evidence.
- `BranchWorkspace` for branch, base, isolation, and primary-checkout
  evidence.

Validate every handoff before using it. Accept only version 1 and preserve
source status, unavailable inputs, conflicts, and evidence. A missing
required handoff returns `status: blocked`,
`failure.code: missing_input`, and the most relevant
`recommended_next_skill`. An unsupported or malformed handoff returns
`blocked` with `unsupported_version` or `invalid_input`.

## Evidence model

Use concise, reproducible references:

- `handoff:ImplementationPlan.validation.required_tests[<index>]` or
  `handoff:ReviewFixPlan.validation.required_tests[<index>]`
- `handoff:ImplementationPlan.validation.required_checks[<index>]` or
  `handoff:ReviewFixPlan.validation.required_checks[<index>]`
- `handoff:ImplementationPlan.validation.success_criteria[<index>]` or
  `handoff:ReviewFixPlan.validation.success_criteria[<index>]`
- `handoff:ImplementationPlan.validation.evidence_requirements[<id>]` or
  `handoff:ReviewFixPlan.validation.evidence_requirements[<id>]`
- `handoff:ImplementationPlan.acceptance_criteria[<index>]`
- `handoff:ImplementationPlan.implementation_steps[<id>]` or
  `handoff:ReviewFixPlan.implementation_steps[<id>]`
- `handoff:ImplementationPlan.in_scope[<path>]` or
  `handoff:ReviewFixPlan.scope.in_scope[<path>]`
- `handoff:ImplementationPlan.out_of_scope[<path>]` or
  `handoff:ReviewFixPlan.scope.out_of_scope[<path>]`
- `handoff:WorkingTreeInspection.entries[<path>]`
- `handoff:WorkingTreeInspection.unexpected_states[<index>]`
- `handoff:ChangeClassification.changes[<path>]`
- `handoff:ChangeClassification.summary[<field>]`
- `handoff:UnrelatedChangeDetection.findings[<path>]`
- `handoff:UnrelatedChangeDetection.summary.<commit_gate|pr_gate>`
- `git:status`, `git:diff:<path>`, or `git:<sanitized-command>`
- `check:<id>` for a check result and its bounded output
- `issue:<field>` or `issue:acceptance_criteria[<index>]` when a
  `LoadedIssue` supplies the evidence

Every blocker, warning, criterion, planned-step result, unexpected change,
and scope conclusion must cite at least one evidence reference. Label
interpretations as assumptions and preserve missing or contradictory evidence
instead of resolving it by inference.

## Validation workflow

### 1. Validate handoffs and identity

- Check schema version and required fields for every supplied handoff.
- Confirm that repository, branch, and worktree path agree across the plan,
  inspection, classification, optional detection, and optional workspace.
- Confirm that the inspected head revision is the revision being evaluated.
- Reject a blocked inspection or classification. A partial source may be
  processed only when its identity and path/change inventory remain trusted;
  preserve its limitations and do not return `passed` from incomplete source
  evidence.
- Reject a plan with `status: draft` or `status: blocked` as a validation
  baseline. Preserve unresolved plan prerequisites or questions as blockers
  when they affect completion.

### 2. Consolidate working-tree and scope evidence

- Inventory every inspected path exactly once, preserving renames as one
  destination path with its `previous_path`.
- Use `ChangeClassification.summary.scope_alignment` as the primary
  classification signal, then reconcile each change with
  `ImplementationPlan.in_scope`, `out_of_scope`, affected areas, and step
  paths.
- Treat `planned` and corroborated `supporting` paths as related only when
  the supplied diff or plan evidence supports that relationship.
- Treat `potentially_foreign`, `uncertain`, conflicting, or missing
  relationships as unresolved; do not convert them into related changes from
  path names alone.
- Carry `WorkingTreeInspection.unexpected_states` into
  `evaluation.unexpected_changes` when they affect trust in the result.

If classification has drift, unknown alignment, foreign paths, or uncertain
paths, consume the supplied `UnrelatedChangeDetection`. Its `block` or
`clarify` commit/PR gate produces a blocker for this validation. If the
conditional detection is missing, return `blocked` with
`recommended_next_skill: detect-unrelated-changes`. Do not treat a clear
detection result as commit or PR authorization; it is evidence for this
consolidation only.

### 3. Evaluate scope and planned steps

Return `evaluation.scope.status` as:

- `aligned` only when every changed path is related or an evidenced necessary
  side effect and no scope gate remains unresolved.
- `drift` when a path contradicts explicit plan or issue scope, or a supplied
  detection identifies a scope violation.
- `unknown` when required relationship evidence is absent or conflicting.

For every implementation step, compare its declared paths and expected
outcome with observable changed paths and supplied check or repository
evidence:

- `completed` only with direct evidence of the expected outcome.
- `partial` when only part of the step is evidenced.
- `missing` when the step has no observed outcome.
- `unexpected` when observed work cannot be reconciled with that step.

Do not claim that a source file implements a behavior without evidence that
the handoff or bounded inspection supports the claim.

### 4. Evaluate acceptance and completion criteria

- Evaluate each `ImplementationPlan.acceptance_criteria` item, preserving
  exact wording in the result.
- Add issue acceptance criteria only when an optional `LoadedIssue` supplies
  them and identify that source.
- Evaluate each
  `ImplementationPlan.validation.success_criteria` item as a completion
  criterion.
- If no acceptance or completion criteria are supplied for a result that
  claims implementation completion, add an `insufficient_context` blocker.
- Use `pass` only with direct evidence, `fail` for contradictory evidence,
  and `unverified` when evidence is missing or inconclusive.
- Any `fail` or `unverified` criterion blocks `passed`.

Do not invent acceptance criteria from the implementation diff. The
`evaluation.acceptance_criteria` and `evaluation.completion_criteria` lists
may be empty only when the result is non-passed and the absence itself is
recorded as evidence.

### 5. Validate required tests and checks

Combine, without deduplicating away provenance:

- `ImplementationPlan.validation.required_tests`
- `ImplementationPlan.validation.required_checks`
- any explicitly supplied check evidence for the same workspace revision

For each required item, add one `checks` entry with `required: true`,
`result`, command, and evidence. Use `pass` only for a successful observed
result. Use `fail` for a failed result, `skipped` for an explicitly skipped
check with a concrete reason, and `not_run` when it was not executed or its
safety could not be verified.

Set `required_checks_passed: true` only when every required entry is `pass`.
A failed, skipped, or not-run required item creates a blocker and prevents
`status: passed`. Preserve optional checks as `required: false`; they may
create warnings but cannot compensate for a required failure.

### 6. Validate explicit evidence requirements

Collect only evidence requirements that are explicitly present in the supplied
issue, approved implementation or review-fix plan, verified repository policy,
or a resolved external validation capability. Preserve each requirement's
exact text, source kind and reference, expected evidence kind, optional
location, and optional required capability. Do not infer a requirement from
framework dependencies, source-file patterns, `index.html`, filenames,
generated-artifact names, or any other path convention.

For every collected requirement:

- Set `status: satisfied` only when the supplied worktree, commit, generated
  artifact, or external validation evidence proves the exact requirement.
- Set `status: missing` when the requirement is explicit but its declared
  evidence is absent. If `location` is present, compare that exact normalized
  repository-relative location; do not substitute a conventional directory or
  file name.
- Set `status: blocked` when the required evidence source or the explicit
  `required_capability` is unavailable. A missing external capability is a
  blocker only when the requirement names it as required.
- Add concrete evidence references for every outcome. A missing or blocked
  requirement adds a blocker naming the requirement, source, expected kind,
  optional location, and missing capability or evidence.

When no explicit requirement is supplied, return
`evidence_requirements: []`. Preserve existing `generated_artifacts` values as
descriptive paths, but never turn them into an implicit UI requirement. Any
missing or blocked requirement prevents `status: passed` and sets both
readiness flags to `false`.

### 7. Reconcile unexpected changes and deviations

- Add unexpected paths from classification, inspection, or detection exactly
  once to `evaluation.unexpected_changes`.
- A path explicitly listed in `ImplementationPlan.out_of_scope` is not
  acceptable merely because it is documented; it remains a blocker unless
  the supplied evidence explicitly changes the approved scope.
- Record a documented deviation only when the input contains explicit,
  reviewable evidence describing the path, reason, and decision. A commit
  message, branch name, or path convention alone is not documentation.
- An undocumented, unresolved, or unaccepted deviation creates a blocker.
- Keep generated artifacts, lockfiles, synchronized manifests, tests, and
  documentation as warnings or necessary side effects only when the supplied
  plan and bounded diff establish that relationship.

### 8. Produce status and diagnostic readiness

Use these status rules:

- `blocked`: required input, identity, schema, source, or conditional scope
  evidence is unavailable or unusable.
- `failed`: validation ran with a trusted baseline, but a criterion, required
  check, or scope condition failed.
- `partial`: useful evidence exists, but a partial source or missing
  non-critical evidence prevents a complete conclusion.
- `passed`: all required inputs are trusted; scope is aligned; every
  completion and acceptance criterion passes; every required check passes;
  and no blocker or unresolved scope gate remains.

Set both readiness flags to `true` only when their corresponding
`UnrelatedChangeDetection` gate is `pass` (when detection is applicable) and
the consolidated status is `passed`. Otherwise set them to `false` and list
the exact reasons. These flags remain diagnostic: they do not invent
task-scoped authorization, but a validated `ImplementationPlan.authorization`
record may carry routine delivery authorization through commit and draft-PR
preparation without another conversational gate.

When `readiness.commit_preparation_allowed` is `true`, set
`recommended_next_skill: compose-commit-message`. This is an advisory
handoff only; it must not invoke the Skill or grant staging, commit, push, or
pull-request authorization. Set `recommended_next_skill: null` when commit
preparation is not allowed or the validation result is blocked or failed.

Use `failure: null` when no processing failure occurred. For a blocked or
partial processing result, preserve a structured failure with one of:
`missing_input`, `invalid_input`, `unsupported_version`,
`insufficient_context`, `conflicting_evidence`, `scope_unresolved`,
`validation_failure`, or `analysis_failure`.

## Output contract

Return exactly one English version-2 `ValidationResult` object:

```yaml
schema: ValidationResult
version: 2
status: failed
workspace:
  path: /workspace/.cromesdk-worktrees/repository/agent-example-task
  branch: agent/example-task
  head_sha: abc123
source:
  implementation_plan_version: 1
  working_tree_inspection_version: 1
  change_classification_version: 1
  unrelated_change_detection_version: 1
  loaded_issue_version: null
  issue_analysis_version: null
  branch_workspace_version: 1
  references:
    - handoff:ImplementationPlan
    - handoff:WorkingTreeInspection
    - handoff:ChangeClassification
    - handoff:UnrelatedChangeDetection
  unavailable_inputs: []
checks:
  - id: required-unit-check
    command: "repository-supplied command"
    category: unit
    result: pass
    required: true
    evidence: "check:required-unit-check"
    exit_code: 0
    duration_ms: 1200
    failure_summary: null
required_checks_passed: true
evaluation:
  scope:
    status: aligned
    evidence:
      - handoff:ChangeClassification.summary.scope_alignment
      - handoff:UnrelatedChangeDetection.summary.commit_gate
  acceptance_criteria:
    - criterion: "The supplied acceptance criterion"
      status: pass
      evidence:
        - handoff:ImplementationPlan.acceptance_criteria[0]
        - check:required-unit-check
  completion_criteria:
    - criterion: "All required validations pass"
      status: pass
      evidence:
        - check:required-unit-check
  planned_steps:
    - id: implement-feature
      status: completed
      evidence:
        - handoff:ImplementationPlan.implementation_steps[implement-feature]
        - handoff:ChangeClassification.changes[src/feature.ts]
  unexpected_changes: []
  documented_deviations: []
blockers:
  - id: missing-completion-evidence
    description: "The implementation result does not provide evidence for one required completion condition."
    evidence:
      - handoff:ImplementationPlan.validation.success_criteria[0]
warnings: []
readiness:
  commit_preparation_allowed: false
  draft_pr_preparation_allowed: false
  reasons:
    - "Commit and draft pull-request preparation remain blocked by the unmet completion condition."
skipped_checks: []
changed_files_reviewed:
  - src/feature.ts
generated_artifacts: []
evidence_requirements: []
validated_at: null
recommended_next_skill: null
failure: null
```

The example intentionally shows a failed result with a blocker and false
readiness. Never report `passed` or either readiness flag as true when scope,
required checks, completion criteria, or evidence remain unresolved.
