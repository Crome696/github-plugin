---
name: evaluate-implementation
description: Evaluate how one issue or task could be implemented against repository context, conventions, and affected areas, including feasibility, architectural fit, dependencies, complexity, risks, compatibility, testing implications, and meaningful alternatives. Use automatically when implementation approaches need evidence-based evaluation before planning or implementation; do not implement changes, produce source code, or replace the task-authorized ImplementationPlan.
---

# Evaluate Implementation

Evaluate how an issue or task could be implemented using the repository context, conventions, and identified affected areas. Assess technical feasibility, architectural fit, dependencies, complexity, risks, compatibility, testing implications, and potential approaches. Compare meaningful implementation alternatives with advantages, disadvantages, and trade-offs when applicable. Respect existing architecture and repository conventions. Identify blockers, uncertainties, required investigation, and assumptions without inventing missing information. Return a structured evaluation with recommended approach, alternatives, rationale, risks, dependencies, confidence, and unresolved questions. Do not implement changes.

Return one version-1 [`ImplementationEvaluation`](../../shared/schemas/ImplementationEvaluation.yaml) handoff. This Skill evaluates and compares approaches; it does not create the later task-authorized [`ImplementationPlan`](../../shared/schemas/ImplementationPlan.yaml).

## Boundaries

- Read repository files, read-only Git metadata, and supplied read-only
  handoffs only. Never edit files, Git state, branches, worktrees, remotes,
  GitHub resources, or generated artifacts.
- Do not run installs, builds, tests, formatters, linters, migrations, hooks,
  or other commands that can change the checkout or external state.
- Do not write source code, prescribe implementation steps, create a
  project-specific test plan, choose a workspace, grant authorization, or
  perform external writes. Testing implications may identify likely coverage
  surfaces and risk, but must not become test cases or commands.
- Do not silently load a GitHub issue, invoke another Skill, choose a
  different repository, or infer repository identity from a branch name or
  arbitrary text. If a supporting handoff is missing, inspect only the
  bounded repository evidence available in the current workflow and recommend
  the relevant Skill instead of invoking it.
- Do not invent paths, APIs, dependencies, architecture boundaries, product
  rules, acceptance criteria, compatibility guarantees, or repository
  conventions. Mark interpretations as assumptions or uncertainties.
- Treat observed conventions as evidence of fit, not as requirements. Explicit
  repository instructions have priority; preserve conflicts instead of
  inventing precedence.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive command arguments.
- Keep the structured handoff and newly authored evaluation text in English.
  Keep questions and explanations in the user's conversation language.

## Input

Accept a task focus containing at least one of:

- A task description, issue title and body, or an explicitly supplied request
  summary.
- A version-1 [`LoadedIssue`](../../shared/schemas/LoadedIssue.yaml) snapshot.

The current repository checkout or a version-1
[`RepositoryContext`](../../shared/schemas/RepositoryContext.yaml) is also
required. Accept these optional evidence handoffs:

- A version-1 [`IssueAnalysis`](../../shared/schemas/IssueAnalysis.yaml) for
  requirements, readiness findings, assumptions, and unresolved questions.
- A version-1 [`AffectedAreas`](../../shared/schemas/AffectedAreas.yaml) for
  direct, indirect, and uncertain repository scope.
- A version-1
  [`RepositoryConventions`](../../shared/schemas/RepositoryConventions.yaml)
  for mandatory and observed repository practices.

Validate every supplied handoff before using it. Preserve its repository
identity, source status, version, unavailable fields, conflicts, and evidence.
Do not treat a partial or blocked handoff as complete context. If the task,
repository identity, or material relationship evidence cannot be verified,
return `partial` or `blocked` rather than attributing an approach to an
unverified repository.

## Evidence and evaluation model

Use concise references that let a reviewer locate the evidence:

- `task`, `title`, `body`, `comment[1]`, or another stable issue source
  reference
- `repository:<path>` or `repository:<path>#<symbol>` for repository evidence
- `manifest:<path>`, `config:<path>`, `api:<path>`, or
  `dependency:<path>` when the evidence has that specific role
- A supplied handoff field such as
  `AffectedAreas.areas[0].evidence[0]`

Classify statements as:

- `evidenced` — directly stated in the task, supplied handoff, repository
  instruction, or repository file.
- `inferred` — a reasonable interpretation supported by evidence but not
  explicitly stated.
- `uncertain` — evidence is incomplete, conflicting, unavailable, or not
  strong enough to support a decision.

Use the schema's dimension ratings consistently:

- `feasibility`: `feasible`, `feasible_with_conditions`, `uncertain`, or
  `infeasible`
- `architectural_fit`: `aligned`, `compatible_with_constraints`,
  `misaligned`, or `uncertain`
- `complexity`: `low`, `medium`, `high`, or `uncertain`
- `compatibility`: `low_risk`, `manageable`, `high_risk`, or `unknown`
- `testing_implications`: `contained`, `cross_cutting`, `substantial`, or
  `unknown`

Complexity describes the evidenced change surface, coupling, and number of
affected boundaries. It is not a schedule or effort estimate. Compatibility
covers verified API, data, configuration, dependency, and consumer concerns;
do not promise backward compatibility without evidence. Testing implications
describe likely validation surfaces and coupling only; they do not replace
acceptance criteria or a project-specific validation plan.

## Workflow

### 1. Validate the request and evidence

1. Confirm that exactly one task or issue is being evaluated.
2. Validate the schema and version of every supplied handoff.
3. Verify the repository identity from the checkout or `RepositoryContext`.
4. Copy source references and unavailable inputs into `source` without
   normalizing, substituting, or inventing issue identity.
5. Stop with a structured `blocked` result when no usable task or repository
   source exists. Continue with `partial` when a reliable evaluation is
   possible but material context is unavailable.

### 2. Build the evaluation focus

Extract only signals relevant to implementation evaluation:

- requested behavior, current behavior, and desired outcome
- explicit scope, non-goals, constraints, and acceptance conditions
- explicitly named paths, applications, libraries, modules, APIs, data models,
  tests, configuration, documentation, or dependencies
- affected areas and relationships from a supplied `AffectedAreas` handoff
- readiness findings, assumptions, contradictions, and open questions from a
  supplied `IssueAnalysis`

Keep the focus behavioral unless repository evidence maps it to a concrete
area. Do not convert a desired outcome into a framework, file, API, or
architecture choice without evidence.

### 3. Establish the bounded repository evidence base

Use supplied `RepositoryContext`, `RepositoryConventions`, and `AffectedAreas`
as evidence, then inspect the smallest useful set of repository-owned files
when a required relationship is not already established. Prioritize:

1. applicable instructions and project boundaries
2. defining modules, APIs, data models, configuration, and dependency
   declarations for the affected areas
3. verified callers, consumers, providers, extension points, and adapters
4. existing tests, fixtures, snapshots, documentation, and compatibility
   surfaces that reference those areas

Record only paths and relationships that can be located. Do not broaden scope
to every consumer, test, configuration file, or transitive dependency merely
because it exists in the repository.

### 4. Assess feasibility and architectural fit

For the requested behavior, determine:

1. Whether the repository already exposes the capabilities, extension points,
   data, interfaces, or dependencies needed to support it.
2. Whether the likely change aligns with explicit instructions, architecture
   boundaries, code organization, and observed conventions.
3. Which boundaries are coupled or cross-cutting and therefore drive
   complexity.
4. Which API, data, configuration, dependency, consumer, or platform
   compatibility concerns are evidenced.
5. Which testing and validation surfaces are likely to be affected, without
   authoring a test plan.

For every rating, provide a concise rationale, concrete evidence references,
and confidence. If evidence supports only conditions or an investigation
question, use the corresponding uncertain or conditional rating.

### 5. Compare meaningful approaches

Identify approaches only when they are materially different and grounded in
the repository. Compare the same concerns for each approach:

- architectural fit and reuse of existing boundaries
- feasibility and known conditions
- change surface and coupling
- compatibility impact
- dependencies and migration or coordination concerns
- testing implications
- risks and unresolved decisions

Select exactly one `recommended_approach` for an `evaluated` result and explain
why it best fits the evidence and stated constraints. Put other materially
viable approaches in `alternatives` with separate advantages, disadvantages,
trade-offs, suitability, evidence, and confidence. Do not list generic
patterns that the repository cannot support or invent an option merely to
populate the list. Use an empty alternatives list when no meaningful
alternative is evidenced.

### 6. Record dependencies, risks, and uncertainty

Separate the following:

- `dependencies`: repository areas, APIs, data, configuration, packages, or
  external capabilities required by an approach, with their evidence and
  verification status.
- `risks`: plausible adverse outcomes or constraints, with severity, evidence,
  and a mitigation only when a bounded mitigation is supported.
- `blockers`: missing decisions or preconditions that prevent a reliable
  evaluation or implementation recommendation.
- `assumptions`: interpretations being used temporarily, never hidden
  requirements.
- `required_investigation`: evidence that must be checked to reduce a
  material uncertainty; identify the evidence source, not implementation
  steps.
- `unresolved_questions`: user, product, architecture, or compatibility
  decisions whose answer could change the evaluation.

Lower overall `confidence` when a material conclusion depends on inferred,
conflicting, partial, or unavailable evidence. Set `status: partial` when a
useful evaluation remains but a material limitation is unresolved. Set
`status: blocked` when the request or repository cannot support a reliable
evaluation.

### 7. Return the handoff

Return exactly one version-1
[`ImplementationEvaluation`](../../shared/schemas/ImplementationEvaluation.yaml)
object. Recommend at most one next Skill and never invoke it automatically.
Use `failure: null` only for `evaluated`; include structured failure evidence
for `partial` and `blocked`.

## Output contract

Use this English version-1 shape. The example is illustrative and must be
replaced with evidence from the actual request and repository:

```yaml
schema: ImplementationEvaluation
version: 1
status: evaluated
source:
  task_or_issue: "Add an export filter to the reporting workflow."
  issue:
    repository: null
    number: null
    title: null
    url: null
  loaded_issue_version: null
  issue_analysis_version: null
  affected_areas_version: 1
  repository_context_version: 1
  repository_conventions_version: 1
  references:
    - task
    - repository:src/reporting/export.ts
  unavailable_inputs: []
focus:
  summary: "Evaluate approaches for filtering the reporting export workflow."
  paths_of_interest:
    - "src/reporting/export.ts"
  constraints:
    - "Preserve existing export formats."
  non_goals:
    - "Redesign unrelated reporting workflows."
assessment:
  feasibility:
    rating: feasible_with_conditions
    rationale: "The existing export boundary supports the requested behavior, but format-specific behavior must be verified."
    evidence:
      - "repository:src/reporting/export.ts#exportReport"
    confidence: medium
  architectural_fit:
    rating: aligned
    rationale: "The request maps to an existing export module rather than requiring a new application boundary."
    evidence:
      - "repository:src/reporting/export.ts"
    confidence: high
  complexity:
    rating: medium
    rationale: "The change is localized but may affect multiple export consumers."
    evidence:
      - "repository:tests/reporting/export.test.ts"
    confidence: medium
  compatibility:
    rating: manageable
    rationale: "The existing output contract can remain unchanged if filtering is applied before formatting."
    evidence:
      - "repository:src/reporting/export.ts#exportReport"
    confidence: low
  testing_implications:
    rating: cross_cutting
    rationale: "Existing export behavior and format coverage are relevant validation surfaces."
    evidence:
      - "repository:tests/reporting/export.test.ts"
    confidence: medium
recommended_approach:
  name: "Reuse the existing export boundary"
  summary: "Evaluate the filter within the current export workflow and preserve its output boundary."
  rationale:
    - "It aligns with the verified module boundary."
    - "It limits compatibility impact compared with introducing a separate export path."
  advantages:
    - "Reuses existing architecture."
  disadvantages:
    - "Shared behavior may affect more than one format."
  trade_offs:
    - "Lower structural change in exchange for careful format coverage."
  conditions:
    - "Verify which formats share the export implementation."
alternatives:
  - name: "Introduce a separate filtering layer"
    summary: "Evaluate a distinct layer before the existing export boundary."
    advantages:
      - "Could isolate filtering from formatting."
    disadvantages:
      - "Adds another boundary to maintain."
    trade_offs:
      - "Potential isolation in exchange for additional coupling and coordination."
    suitability: viable_with_conditions
    evidence:
      - "repository:src/reporting/export.ts#exportReport"
    confidence: low
dependencies:
  - dependency: "Reporting export module"
    relationship: "Provides the current export boundary."
    status: verified
    evidence:
      - "repository:src/reporting/export.ts#exportReport"
    confidence: high
risks:
  - severity: medium
    description: "A format that does not share the observed export path could be missed."
    evidence:
      - "repository:tests/reporting/export.test.ts"
    mitigation: "Verify all supported formats before implementation."
    confidence: medium
blockers: []
assumptions:
  - assumption: "The requested filter applies before output formatting."
    evidence:
      - "task"
    confidence: low
required_investigation:
  - question: "Which supported formats share the current export boundary?"
    reason: "The answer changes compatibility and testing implications."
    evidence_to_check:
      - "repository:src/reporting/export.ts"
      - "repository:tests/reporting/export.test.ts"
    blocking: true
unresolved_questions:
  - question: "Should filtering affect every supported export format?"
    impact: "The answer may change the recommended approach and affected scope."
    blocking: true
confidence: medium
recommended_next_skill: none
failure: null
```

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No task, issue, or usable repository source was supplied. | `blocked` |
| `invalid_input` | A supplied task or handoff cannot be parsed or validated. | `blocked` |
| `unsupported_version` | A supplied handoff has an unsupported schema version. | `blocked` |
| `insufficient_context` | The request is assessable, but repository identity, affected paths, conventions, or relationship evidence is materially unavailable. | `partial` |
| `conflicting_evidence` | Issue, handoff, instruction, or repository evidence conflicts and the conflict could change the evaluation. | `partial` |
| `analysis_failure` | A read-only evaluation fails after valid inputs were accepted. | `partial` or `blocked`, according to whether reliable findings remain |
