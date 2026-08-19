---
name: classify-changes
description: Classifies one inspected worktree's changes by purpose, affected component, and relationship to an issue, ImplementationPlan, ReviewFixPlan, or CiFixPlan using diff and plan evidence. Use automatically for scope validation or commit planning; never modify files, the index, or Git state.
---

# Classify Changes

Classify the changes in one expected implementation worktree for scope
validation and later commit planning. Return exactly one version-1
[`ChangeClassification`](../../shared/schemas/ChangeClassification.yaml)
handoff. This Skill is diagnostic only: it does not stage, commit, or
authorize any change.

## Boundaries

- Read supplied handoffs, repository files, bounded non-secret diff evidence,
  and read-only Git metadata only. Never edit files, the index, branches,
  worktrees, Git administrative state, generated artifacts, or GitHub
  resources.
- Do not run `git add`, `rm`, `mv`, `checkout`, `switch`, `reset`, `restore`,
  `clean`, `rebase`, `merge`, `cherry-pick`, `commit`, `worktree add`,
  `worktree remove`, hooks, installs, builds, tests, formatters, linters, or
  other change-producing operations.
- Do not load the entire repository or unrelated dependency trees. Inspect
  only the supplied working-tree inventory and bounded evidence needed to
  classify its paths.
- Do not invent paths, issue requirements, plan steps, component boundaries,
  generated-file status, or authorization. Label path-derived component names
  as fallbacks when stronger repository evidence is unavailable.
- Do not provide source-code implementation, project-specific test strategy,
  domain guidance, or product guidance. Classification describes observed
  changes and scope relationships only.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive diff hunks. Redact evidence before returning
  it.
- Do not invoke another Skill automatically. A recommended next Skill is
  advisory only and never grants commit, staging, or scope approval.
- Keep the structured handoff and authored report text in English. Questions
  and explanations may follow the user's conversation language.

## Input

Accept one expected worktree from these inputs:

- Required version-1
  [`WorkingTreeInspection`](../../shared/schemas/WorkingTreeInspection.yaml).
  Its `repository`, `branch_name`, `worktree_path`, `identity`, `entries`,
  `files`, and `diff` are the authoritative working-tree evidence.
- Optional version-1 `ReviewFixPlan` or
  [`ImplementationPlan`](../../shared/schemas/ImplementationPlan.yaml). For a
  `ReviewFixPlan`, use its `scope.in_scope`, `scope.out_of_scope`,
  `scope.exact_path_allowlist`, and `implementation_steps` as the bounded
  review-fix scope. For an `ImplementationPlan`, use `affected_areas`,
  `in_scope`, `out_of_scope`, and implementation-step `paths` as plan scope
  evidence.
- Optional version-1 `LoadedIssue`, `IssueAnalysis`, and
  [`AffectedAreas`](../../shared/schemas/AffectedAreas.yaml) handoffs, plus a
  bounded task or issue summary when explicitly supplied.

Validate every supplied handoff before using it. Accept only version 1 and
preserve the source versions and references in the output. Do not replace
explicit values with values inferred from a path or branch name.

The inspection must have `status: inspected`, or `status: partial` with a
trusted identity and a useful parsed path inventory. A blocked inspection,
missing inspection, untrusted identity, or unavailable path inventory produces
`status: blocked` with a non-null failure and
`recommended_next_skill: inspect-working-tree`. A partial inspection may
continue with `status: partial` when classification remains useful; preserve
the missing or conflicting evidence in `source.unavailable_inputs` and
`failure`.

An absent optional plan or issue is not a validation error. Record
`plan_relation: no_plan` or `issue_relation: no_issue` and keep
`summary.scope_alignment: unknown` unless another supplied task scope
provides enough evidence. Do not treat every change as foreign merely because
an optional handoff was not supplied.

## Evidence rules

Every change must include a concise rationale and reproducible evidence. Use
references such as:

- `handoff:WorkingTreeInspection.entries[<path>]` for status, rename, and
  untracked evidence.
- `handoff:WorkingTreeInspection.diff.numstat[<path>]` or
  `git:diff:<path>` for changed content, mode, or diff-stat evidence.
- `handoff:ImplementationPlan.affected_areas[<path>]`,
  `handoff:ImplementationPlan.implementation_steps[<id>].paths`, and
  `handoff:ImplementationPlan.in_scope[<path>]` for planned scope.
- `handoff:ImplementationPlan.out_of_scope[<path>]` for an explicit
  non-goal or excluded path.
- `handoff:LoadedIssue`, `handoff:IssueAnalysis`, or
  `handoff:AffectedAreas[<path>]` for issue and affected-area scope.
- `path:<path>` for a bounded path convention, such as a test directory,
  documentation directory, configuration location, or generated-output
  location.
- `input:<field>` for an explicit input or an unavailable optional source.

When an `ImplementationPlan` or `ReviewFixPlan` or `CiFixPlan` is available, a planned or
foreign conclusion must cite the relevant plan path or out-of-scope evidence
and the changed-path or diff evidence. When no plan is available, say so
explicitly and lower confidence when scope cannot be established. A path
convention alone can support a purpose classification, but it cannot prove
issue or plan scope.

## Classification workflow

### 1. Validate and normalize the source

1. Resolve one `WorkingTreeInspection` without substituting the current
   checkout for the expected worktree.
2. Confirm version, repository identity, branch identity, and absolute
   `worktree_path`. Preserve the inspection's identity evidence.
3. Validate optional handoffs and record unavailable or unsupported inputs.
4. If identity, branch association, or path inventory is not trustworthy,
   return a blocked result. Do not classify unverified paths as safe scope.

Normalize repository-relative paths for comparison while preserving the
original path in the output. On Windows, compare normalized paths
case-insensitively. Keep rename records as one change whose `path` is the
destination and whose `previous_path` is the source.

### 2. Build the canonical change list

Use `WorkingTreeInspection.entries` as the primary source and reconcile it
with `files`. De-duplicate paths without dropping staged, unstaged, untracked,
deleted, unmerged, or renamed evidence. Use exactly these `change_kind`
values:

- `added` for newly tracked additions.
- `modified` for tracked content or mode changes that are not deletes.
- `deleted` for tracked paths marked deleted.
- `renamed` for a rename, with both source and destination preserved.
- `untracked` for paths not tracked by Git.

Do not create a synthetic path for a plan step, issue reference, or inferred
component. If the inspection is clean, return an empty canonical list and a
valid classified result when all identity and diff checks passed.

### 3. Collect bounded diff evidence

Start with the inspection's diff statistics. Read a path-specific diff only
when statistics and path metadata do not establish the classification. Keep
the read bounded to the relevant path and hunk; do not dump the whole patch.
For untracked files, use safe path metadata or a bounded non-secret read only
when necessary.

Do not inspect or return sensitive contents. If diff evidence is unavailable,
truncated, binary, or redacted, record that limitation and use `medium` or
`low` confidence as appropriate. Never claim that a change is aligned solely
because a path exists.

### 4. Determine the affected component

Choose the strongest available component evidence in this order:

1. An exact relevant path in `AffectedAreas` with its named area.
2. An exact or prefix path in `ImplementationPlan.affected_areas` or an
   implementation step's `paths`.
3. A bounded repository path group or package/module directory.
4. The nearest meaningful repository-relative path group.

Use a short component label, such as `billing API`, `test suite`, `GitHub
plugin documentation`, or `shared schema contract`. Do not claim an
application or architecture boundary that the evidence does not establish.
When the label is path-derived, cite `path:<path>` and lower confidence if
there is no corroborating handoff.

### 5. Classify the purpose

Purpose describes what the changed path appears to do. Apply direct generated
and path/diff evidence before scope relationships:

1. `generated`: generated lockfiles, build outputs, or generated schemas only
   when the path or diff provides evidence that a tool produced them.
2. `test`: test directories, test files, fixtures, or test-only diffs.
3. `documentation`: README files, documentation directories, examples, or
   prose/contract documentation.
4. `configuration`: manifests, CI definitions, tool configuration, or
   environment examples that contain no secrets.
5. `planned_implementation`: source or plugin artifacts whose diff and
   supplied task, issue, or plan identify them as implementation work.
6. `potentially_foreign`: a change with explicit out-of-scope evidence,
   an unrelated plan/issue relationship, or a diff/path relationship that
   cannot be connected to the supplied work. Explain the uncertainty; this
   label does not prove unauthorized ownership.

Use the first category supported by direct evidence when categories overlap.
For example, a planned test remains `test`, and a planned generated lockfile
remains `generated`; the plan relationship is recorded separately. Absence of
an optional plan alone is not evidence that a documentation, test, or
configuration path is foreign. If no purpose can be supported and scope
evidence is unavailable, use `potentially_foreign` with low confidence and
explicitly state that the classification is unresolved.

### 6. Relate the change to the ImplementationPlan

Set `plan_relation` independently from `purpose`:

- `planned` when the path exactly matches or is contained by an
  `ImplementationPlan.affected_areas` path, a `ReviewFixPlan.scope.in_scope`
  or `scope.exact_path_allowlist` entry, an in-scope path, or an
  implementation-step `paths` entry.
- `supporting` when the path is not listed but the diff and plan evidence
  show that it supports a listed implementation step, such as a focused test
  or required documentation.
- `unrelated` when the path matches an explicit `out_of_scope` or
  `ReviewFixPlan.scope.out_of_scope` path, or the diff contradicts the plan's
  boundaries.
- `uncertain` when a plan exists but path or diff evidence is ambiguous.
- `no_plan` when no validated `ImplementationPlan` or `ReviewFixPlan` or `CiFixPlan` was
  supplied.

Use exact path or documented prefix relationships only. Do not treat a common
filename, branch name, or generic component label as plan evidence.

### 7. Relate the change to the issue

Set `issue_relation` independently:

- `in_scope` when the issue, analysis, affected-area map, or supplied task
  explicitly covers the path, component, behavior, or required validation.
- `out_of_scope` when an issue non-goal, exclusion, or contradiction explicitly
  excludes the path or behavior.
- `uncertain` when an issue exists but does not establish the path relationship.
- `no_issue` when no validated issue or task scope was supplied.

Do not infer an issue number, title, requirement, or acceptance criterion from
a branch name or commit message. Preserve uncertainty instead.

### 8. Assign confidence

Use `high` only for direct path and diff evidence corroborated by a plan,
issue, or affected-area handoff. Use `medium` for a strong path/diff
convention with partial corroboration. Use `low` for path-only,
conflicting, redacted, or unresolved evidence. The rationale must explain why
the chosen confidence is appropriate.

### 9. Build the scope summary

Populate `summary.by_purpose` with every classified path and de-duplicated
path lists. Populate:

- `in_scope_paths` with paths whose issue relation is `in_scope`, or whose
  plan relation is `planned`/`supporting` with corroborating plan or task
  scope.
- `out_of_scope_or_foreign_paths` with explicit out-of-scope, unrelated, or
  `potentially_foreign` paths.
- `uncertain_paths` with low-confidence, ambiguous, or incomplete-evidence
  paths.

Set `scope_alignment` to:

- `aligned` only when scope evidence is available, complete, and every path is
  supported without a foreign or explicit out-of-scope classification.
- `drift` when any explicit out-of-scope, unrelated, or potentially foreign
  path is present.
- `unknown` when no plan/issue scope is supplied or relevant evidence is
  incomplete.

Use `status: partial` when the inventory is useful but diff, handoff, or scope
evidence is incomplete. Use `status: classified` only when all conclusions
needed for the summary are supported. Set `failure: null` only for a
classified result. Set `recommended_next_skill` to
`detect-unrelated-changes` when `scope_alignment: drift`, when
`out_of_scope_or_foreign_paths` or `uncertain_paths` is non-empty, or when a
change has an unrelated, out-of-scope, or uncertain issue/plan relationship.
This recommendation is advisory only. Preserve `inspect-working-tree` as the
recommended next Skill when the required inspection is missing or blocked;
otherwise use `null` when no scope concern remains.

## Output contract

Return exactly one English version-1 `ChangeClassification` object:

```yaml
schema: ChangeClassification
version: 1
status: classified
repository: owner/repository
branch_name: agent/example-task
worktree_path: /workspace/.cromesdk-worktrees/repository/agent-example-task
source:
  task_or_issue: "Issue #123: add the feature"
  working_tree_inspection_version: 1
  implementation_plan_version: 1
  loaded_issue_version: null
  issue_analysis_version: null
  affected_areas_version: 1
  references:
    - "handoff:WorkingTreeInspection"
    - "handoff:ImplementationPlan"
  unavailable_inputs: []
changes:
  - path: src/feature.ts
    previous_path: null
    change_kind: modified
    purpose: planned_implementation
    component: feature module
    plan_relation: planned
    issue_relation: in_scope
    confidence: high
    rationale: "The changed source path is listed by the implementation step and its diff implements the scoped feature."
    evidence:
      - "handoff:WorkingTreeInspection.entries[src/feature.ts]"
      - "git:diff:src/feature.ts"
      - "handoff:ImplementationPlan.implementation_steps[implement-feature].paths[src/feature.ts]"
  - path: tests/feature.test.ts
    previous_path: null
    change_kind: added
    purpose: test
    component: feature test suite
    plan_relation: supporting
    issue_relation: in_scope
    confidence: high
    rationale: "The test covers the planned feature and is identified by the path and diff."
    evidence:
      - "handoff:WorkingTreeInspection.entries[tests/feature.test.ts]"
      - "git:diff:tests/feature.test.ts"
      - "handoff:AffectedAreas[tests/feature.test.ts]"
summary:
  by_purpose:
    planned_implementation:
      - src/feature.ts
    test:
      - tests/feature.test.ts
    documentation: []
    configuration: []
    generated: []
    potentially_foreign: []
  in_scope_paths:
    - src/feature.ts
    - tests/feature.test.ts
  out_of_scope_or_foreign_paths: []
  uncertain_paths: []
  scope_alignment: aligned
evidence:
  - "git:diff --shortstat HEAD reported 2 changed files"
  - "handoff:ImplementationPlan.implementation_steps covered both paths"
recommended_next_skill: null
failure: null
```

For a blocked or partial result, preserve every reliable identity and path
value, leave unverifiable classifications empty or explicitly uncertain, set
the corresponding status, and include a non-null failure with sanitized
evidence. Never present a blocked or partial result as commit authorization.
