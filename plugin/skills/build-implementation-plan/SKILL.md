---
name: build-implementation-plan
description: Builds a task-authorized, implementation-ready plan from one issue or task plus verified repository context, affected areas, implementation evaluation, resolved capabilities, and repository conventions. Use automatically when an evaluated change is ready to be decomposed into ordered implementation steps; do not write code, create workspaces, or execute delivery.
---

# Build Implementation Plan

Create an implementation-ready plan from the issue, repository context, affected areas, implementation evaluation, and resolved capabilities. Break the work into ordered, actionable steps with dependencies, relevant paths, required skills and rules, validation requirements, risks, and expected outcomes. Include testing and documentation work where applicable. Respect repository conventions and the recommended implementation approach. Identify prerequisites, blockers, assumptions, and unresolved questions explicitly. Keep the plan implementation-focused without writing code. Return a structured plan suitable for execution by another AI agent.

Return exactly one version-1 [`ImplementationPlan`](../../shared/schemas/ImplementationPlan.yaml)
handoff. This Skill turns validated implementation evidence into a plan; it does
not implement the change, create the workspace, or invent authorization. It
records an existing task-scoped routine delivery authorization when supplied.

## Boundaries

- Read repository files, read-only Git metadata, supplied handoffs, and the
  current host-session capability inventory only. Never edit source files,
  Git state, branches, worktrees, remotes, GitHub resources, or generated
  artifacts.
- Do not write source code, configuration, tests, migrations, documentation
  content, or commands that mutate the repository. Describe those changes as
  plan steps only.
- Do not create, activate, reuse, or clean up a branch or worktree. Workspace
  values are supplied or proposed planning values; they are not execution.
- Do not invent authorization. Preserve explicit task-scoped, Plan Build, or
  repository-policy authorization evidence when it is supplied. Routine
  `implementation_authorized`, `push_authorized`, and
  `draft_pull_request_authorized` may be true together when that same verified
  delivery authorization covers the task; hard operations remain separate.
- Do not silently load an issue, invoke another Skill, execute a resolved
  capability, select a different repository, or infer repository identity from
  a branch name or arbitrary text.
- Do not invent repository paths, APIs, dependencies, commands, architecture,
  product requirements, compatibility guarantees, acceptance criteria, or
  conventions. Record missing evidence as a prerequisite, blocker, assumption,
  unresolved question, or partial result.
- Treat the recommended approach from `ImplementationEvaluation` as the
  selected approach. Do not reopen alternatives unless conflicting evidence
  makes the recommendation unusable; record that conflict explicitly.
- Apply [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc)
  to the issue, not to plan steps. If the issue is too large, return a
  partial or blocked plan and require a nearly atomic product-issue split.
  Do not use technical implementation steps as a substitute for that split.
- Repository-local skill and rule references must remain inside
  `plugin/`. External technology, testing, security, documentation,
  or domain capabilities may be recorded by their current-session identity
  (`session:skill:<name>` or `session:rule:<name>`), but their content must not
  be copied into this plugin or executed by this Skill.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive command arguments.
- Keep the structured handoff and newly authored plan text in English. Keep
  questions and explanations in the user's conversation language.

## Input

Accept exactly one implementation request containing at least one of:

- A task description or issue title and body.
- A version-1 [`LoadedIssue`](../../shared/schemas/LoadedIssue.yaml) snapshot.
- A version-1 [`IssueAssessment`](../../shared/schemas/IssueAssessment.yaml)
  with the locked requirements and issue identity.

The current repository checkout or a version-1
[`RepositoryContext`](../../shared/schemas/RepositoryContext.yaml) is required.
Use these handoffs when supplied:

- A version-1 [`AffectedAreas`](../../shared/schemas/AffectedAreas.yaml) for
  evidence-based paths and direct, indirect, or uncertain impact.
- A version-1
  [`ImplementationEvaluation`](../../shared/schemas/ImplementationEvaluation.yaml)
  for the selected approach, conditions, dependencies, risks, blockers,
  compatibility, and testing implications.
- A version-1
  [`ContextCapabilities`](../../shared/schemas/ContextCapabilities.yaml) for
  required skills, applicable rules, and missing capability gaps.
- A version-1
  [`RepositoryConventions`](../../shared/schemas/RepositoryConventions.yaml)
  for mandatory and observed practices.
- A version-1 [`IssueAnalysis`](../../shared/schemas/IssueAnalysis.yaml) for
  readiness findings, assumptions, contradictions, and unresolved questions.
- A version-1 [`BranchWorkspace`](../../shared/schemas/BranchWorkspace.yaml)
  for an already resolved implementation workspace.
- A task-scoped delivery authorization record from the current request,
  previous workflow handoff, completed Plan Build, or applicable repository
  policy. It must identify the same repository and issue/task.

`AffectedAreas`, `ImplementationEvaluation`, and `ContextCapabilities` are
required for a complete `draft` plan. If one is unavailable but a bounded plan
can still be described, return `partial`, preserve the unavailable input in
`source.unavailable_inputs`, and recommend the relevant predecessor Skill. If a
missing or invalid input prevents reliable scope, approach, capability, or
validation decisions, return `blocked`.

Validate every supplied handoff before using it. Accept only version 1, preserve
repository identity, source status, unavailable fields, conflicts, and evidence,
and never silently substitute the current workspace for a missing handoff.

## Planning model

Build one plan for one request. Keep the following distinctions explicit:

- **Requirements** are directly stated or locked by the issue or assessment.
- **Approach** is the selected `recommended_approach` from the evaluation.
- **Affected areas** are repository paths supported by `AffectedAreas` or
  bounded repository evidence.
- **Prerequisites** are conditions or inputs that must be available before a
  step can begin.
- **Blockers** prevent implementation from proceeding until the stated
  resolution is completed.
- **Assumptions** are temporary interpretations and never become hidden
  requirements.
- **Unresolved questions** are decisions whose answers may change scope,
  behavior, compatibility, validation, or ordering.
- **Risks** are plausible adverse outcomes with a bounded mitigation when one is
  supported by evidence.

Prefer mandatory repository instructions over observed conventions. Preserve
conflicts instead of inventing precedence. A plan is implementation-focused, not
source-code-complete: each step describes the change boundary, dependencies,
relevant paths, and expected outcome another agent must achieve.

## Evidence model

Use concise references that let a reviewer locate the basis for each plan item:

- `task`, `title`, `body`, `comment[1]`, or another stable issue reference.
- `repository:<path>` or `repository:<path>#<symbol>` for repository evidence.
- `manifest:<path>`, `config:<path>`, `api:<path>`, or
  `dependency:<path>` when evidence has that role.
- A supplied handoff field such as
  `AffectedAreas.areas[0].evidence[0]`.
- A current-session capability reference such as
  `session:skill:<name>` or `session:rule:<name>` only when exposed by the
  current session.

Do not add unsupported evidence fields to the contract. Preserve the source
references and use them in prerequisite, blocker, risk, and capability
descriptions where the schema provides an evidence field.

## Workflow

### 1. Validate the request and source evidence

1. Confirm that exactly one task or issue is in scope.
2. Validate the schema and version of every supplied handoff.
3. Verify repository identity from the checkout or `RepositoryContext`.
4. Confirm that the issue number and title can populate the required `issue`
   field. Do not invent issue identity.
5. Copy source handoff versions, references, and unavailable inputs into
   `source`.
6. Return `blocked` for missing or invalid request, repository, or required
   evidence. Return `partial` when a useful plan remains but a material input
   is unavailable.

### 2. Consolidate the implementation objective

Extract the objective, current behavior, desired behavior, in-scope work,
out-of-scope work, and acceptance criteria from the issue or assessment.
Reconcile them with `IssueAnalysis` and `ImplementationEvaluation` without
silently resolving contradictions. Carry evaluation conditions, issue
assumptions, and material open questions into the corresponding plan fields.

### 3. Map the affected areas

1. Start with direct areas and paths from `AffectedAreas`.
2. Include indirect areas only when a downstream relationship is evidenced.
3. Keep uncertain areas marked as prerequisites, risks, or unresolved questions
   instead of presenting them as confirmed implementation scope.
4. Reduce the result to `{path, reason}` entries in the plan and never invent a
   path to fill a list.

### 4. Adopt the recommended approach

Use exactly one `recommended_approach` from `ImplementationEvaluation` as the
plan's implementation direction. Convert its supported conditions into
prerequisites or ordered investigation steps. Convert evaluation dependencies
into step dependencies or prerequisites. Carry forward blockers and
unresolved questions that can change implementation. Do not turn an alternative
approach into an implementation step.

### 5. Resolve capabilities and rules

Read `ContextCapabilities` and include only capabilities that have an evidenced
role in the plan:

1. Map available, required repository-local Skill capabilities to
   `plugin/`-relative paths in `capabilities.required_skills`.
2. Map applicable repository-local rules to `plugin/`-relative paths in
   `capabilities.applicable_rules`.
3. Map exposed external Skill or Rule capabilities to their exact
   `session:skill:<name>` or `session:rule:<name>` identity. Preserve the
   capability's external scope boundary and availability evidence; do not
   substitute a checkout path or copy its content.
4. Do not place agents, tools, or domain descriptions into the path/reference
   fields.
5. Record missing or unavailable required capabilities as blockers when they
   prevent reliable execution, or as risks/prerequisites when they weaken the
   plan.
6. Never invoke, install, authenticate, or broaden a resolved external
   capability from this planning Skill.

### 6. Order actionable implementation steps

Create a stable sequence with unique IDs such as `step-01`, `step-02`, and
`step-03`. For every step:

- State one actionable change boundary without writing code.
- List only earlier step IDs in `dependencies`.
- List evidenced repository-relative `paths` when known.
- State the observable `expected_outcome`.
- Add implementation, test, fixture, configuration, migration, and
  documentation work as separate steps when the request or repository evidence
  makes them applicable.
- Make validation and documentation dependencies explicit rather than hiding
  them in a final generic step.

Do not create a step for an unresolved decision unless the step is explicitly
an investigation or approval prerequisite and its outcome is observable.

### 7. Define validation requirements

Derive `validation.required_tests`, `validation.required_checks`, and
`validation.success_criteria` from acceptance criteria, repository commands,
testing conventions, affected test surfaces, and evaluation testing
implications. Preserve exact verified commands where available. If a command
or check is not evidenced, describe the required validation without fabricating
an executable command. Include documentation checks when documentation changes
are in scope.

### 8. Describe the workspace without changing it

Use the supplied `BranchWorkspace` values when available. Otherwise use
verified repository branch information and repository conventions to propose
`base_branch`, `branch_name`, and `worktree_path`. Mark missing workspace
evidence as a prerequisite or blocker. Never create the branch or worktree.
Set `fallback_authorized` only when explicit authorization evidence exists.

### 9. Record readiness, risks, and authorization

1. Keep prerequisites, blockers, assumptions, and unresolved questions in their
   dedicated fields even when they also affect risk or ordering.
2. Use `status: draft` for a complete plan that is ready for explicit review,
   `partial` for a useful plan with material limitations, and `blocked` when a
   missing prerequisite prevents reliable planning.
3. If a verified task-scoped routine delivery authorization is supplied for the
   same repository and issue/task, set `implementation_authorized`,
   `push_authorized`, and `draft_pull_request_authorized` to `true`, record its
   `source`, `task_scope`, and evidence, and keep hard operations separate.
   Otherwise set the routine flags to `false` and report the missing
   authorization. Never infer authorization from `status: draft`, issue
   readiness, or an unrelated request to create a plan.
4. Set `failure: null` for successful or partial handoffs without an execution
   failure; include structured failure evidence for blocked results.
5. Recommend at most one predecessor Skill when more evidence is needed and
   never invoke it automatically.

### 10. Return the handoff

Return exactly one English version-1 `ImplementationPlan` object. Do not return
source code, a second approach, an unstructured checklist, or an authorization
request as a substitute for the handoff.

## Output contract

Use this English version-1 shape. Replace the illustrative values with evidence
from the actual request and supplied handoffs:

```yaml
schema: ImplementationPlan
version: 1
status: draft
source:
  task_or_issue: "Add an export filter to the reporting workflow."
  issue:
    repository: example/repository
    number: 42
    title: "Add an export filter"
    url: "https://github.com/example/repository/issues/42"
  loaded_issue_version: 1
  issue_analysis_version: 1
  issue_assessment_version: null
  affected_areas_version: 1
  implementation_evaluation_version: 1
  context_capabilities_version: 1
  repository_context_version: 1
  repository_conventions_version: 1
  branch_workspace_version: null
  references:
    - title
    - repository:src/reporting/export.ts#exportReport
  unavailable_inputs: []
issue:
  repository: example/repository
  number: 42
  title: "Add an export filter"
  url: "https://github.com/example/repository/issues/42"
objective: "Allow callers to filter records before the existing export formatters run."
current_behavior: "The export workflow formats every record supplied by the caller."
desired_behavior: "The workflow applies the requested filter while preserving existing formats."
assumptions:
  - "Filtering applies before format-specific serialization."
prerequisites:
  - description: "Confirm which supported formats share the existing export boundary."
    status: verified
    evidence:
      - repository:src/reporting/export.ts#exportReport
blockers: []
unresolved_questions:
  - question: "Should filtering affect every supported export format?"
    impact: "The answer may change affected areas and validation coverage."
    blocking: true
affected_areas:
  - path: src/reporting/export.ts
    reason: "Contains the verified export boundary selected by the evaluation."
  - path: tests/reporting/export.test.ts
    reason: "Covers the existing export behavior and required regression validation."
in_scope:
  - "Apply the approved filter at the existing export boundary."
out_of_scope:
  - "Redesign unrelated reporting workflows."
acceptance_criteria:
  - "A matching record is included in every supported format."
  - "A non-matching record is excluded without changing existing serialization."
implementation_steps:
  - id: step-01
    description: "Update the existing export boundary to apply the approved filter before formatting."
    dependencies: []
    paths:
      - src/reporting/export.ts
    expected_outcome: "The export boundary produces the filtered record set for existing formatters."
  - id: step-02
    description: "Add regression coverage for matching, non-matching, and format-preservation behavior."
    dependencies:
      - step-01
    paths:
      - tests/reporting/export.test.ts
    expected_outcome: "The acceptance criteria are independently verified by the repository test suite."
  - id: step-03
    description: "Update the export documentation to describe the filter and its supported formats."
    dependencies:
      - step-01
    paths:
      - docs/reporting/export.md
    expected_outcome: "Users can discover the filter contract and format coverage."
validation:
  required_tests:
    - "Run the existing reporting export test suite."
  required_checks:
    - "Run the repository's verified formatter, linter, and type-check commands for the affected project."
  success_criteria:
    - "All acceptance criteria pass."
    - "No existing export format regression is reported."
capabilities:
  required_skills:
    - plugin/skills/inspect-repository/SKILL.md
  applicable_rules:
    - plugin/rules/interactive-approval.mdc
workspace:
  base_branch: main
  branch_name: feat/issue-42-export-filter
  worktree_path: ../cromesdk-plugin-issue-42
  fallback_authorized: false
authorization:
  implementation_authorized: true
  push_authorized: true
  draft_pull_request_authorized: true
  source: task_intent
  task_scope: "example/repository issue 42"
  evidence: "The current task authorization covers routine implementation and delivery for issue 42."
recommended_next_skill: none
risks:
  - severity: medium
    description: "A supported format outside the shared export boundary could be missed."
    mitigation: "Verify all supported format callers before implementation."
failure: null
```

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No single task or issue, repository context, or usable required handoff is supplied. | `blocked` |
| `invalid_input` | A supplied task or handoff cannot be parsed or validated. | `blocked` |
| `unsupported_version` | A supplied handoff has an unsupported schema version. | `blocked` |
| `insufficient_context` | A useful plan remains, but affected paths, conventions, workspace, capabilities, or validation evidence is materially unavailable. | `partial` |
| `conflicting_evidence` | Issue, handoff, instruction, or repository evidence conflicts in a way that may change the plan. | `partial` or `blocked` |
| `analysis_failure` | Plan construction fails after valid inputs were accepted. | `partial` or `blocked`, according to whether reliable findings remain |
