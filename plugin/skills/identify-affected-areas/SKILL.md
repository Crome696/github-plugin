---
name: identify-affected-areas
description: Maps an issue or task to evidence-based affected repository applications, libraries, modules, files, APIs, tests, configuration, documentation, data models, and dependencies, including direct, indirect, and uncertain downstream impact. Use automatically when a task needs repository scope discovery before planning or implementation; do not use for solution design, source-code implementation, project-specific test strategy, or GitHub writes.
---

# Identify Affected Areas

Analyze an issue or task against the repository context to identify components likely affected by the requested change. Determine relevant applications, libraries, modules, files, APIs, tests, configuration, documentation, data models, and dependencies. Trace important relationships and potential downstream impact where evidence exists. Distinguish direct changes from indirect or uncertain impact and avoid inventing affected areas. Return a structured result containing area, relevant paths, impact type, rationale, dependencies, confidence, and recommended investigation points. Do not design or implement the solution.

## Boundaries

- Read repository files and supplied read-only handoffs only. Never edit files,
  Git state, branches, worktrees, remotes, GitHub resources, or generated
  artifacts.
- Do not run installs, builds, tests, formatters, linters, migrations, hooks,
  or other commands that can change the checkout or external state.
- Do not design the requested solution, choose an architecture, prescribe
  implementation steps, write source code, or create a project-specific test
  strategy. Investigation points may identify evidence to verify, but must not
  prescribe how the change should be built.
- Do not silently load a GitHub issue, invoke another Skill, choose a
  different repository, or infer repository identity from a branch name or
  arbitrary text.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive command arguments.
- Keep this workflow within repository-scope discovery. Inventory a framework,
  API, dependency, test, configuration file, or document only when the issue
  or repository evidence supports its relevance.
- Keep the structured handoff and newly authored report text in English. Keep
  questions and explanations in the user's conversation language.

## Input

Accept a task focus containing:

- A task description, issue title and body, or an explicitly supplied request
  summary.
- An optional version-1 [`LoadedIssue`](../../shared/schemas/LoadedIssue.yaml)
  snapshot.
- An optional version-1
  [`IssueAnalysis`](../../shared/schemas/IssueAnalysis.yaml) handoff.
- An optional version-1
  [`RepositoryContext`](../../shared/schemas/RepositoryContext.yaml) handoff.
- The current repository checkout as a read-only evidence source.

At least one task or issue source and a verifiable repository checkout or
`RepositoryContext` are required. Use a supplied `RepositoryContext` as the
primary repository inventory. When it is not supplied, inspect only the
bounded checkout evidence needed for this mapping; do not invoke
`inspect-repository` automatically. If the repository identity or target
checkout cannot be verified, return `blocked` or `partial` rather than
attributing paths to an unverified repository.

Validate supplied handoffs before using them. Accept only the versions named
above and preserve their identity, status, unavailable fields, and evidence.
An `IssueAnalysis` describes issue evidence; it does not by itself prove that
an implementation path is affected.

## Evidence and impact model

Use concise references that let a reviewer locate the evidence:

- `title`, `body`, `comment[1]`, or another stable issue source reference
- `repository:<path>` for repository files
- `repository:<path>#<symbol>` for a named export, handler, model, or test
- `manifest:<path>`, `config:<path>`, `api:<path>`, or `dependency:<path>`
  when the repository evidence is specifically a manifest, configuration,
  API contract, or dependency declaration
- A supplied handoff field such as `RepositoryContext.relevant_paths[0]`

Classify each returned area as follows:

- `direct` — the issue or task explicitly names the area, or repository
  evidence shows a strong, specific relationship to the requested change.
- `indirect` — the area is a verified consumer, provider, test, configuration,
  documentation surface, data model, or dependency of a directly affected
  area, and the relationship is traced in repository evidence.
- `uncertain` — the area or relationship is plausible but material evidence is
  missing, conflicting, or not verified. Do not use uncertainty to justify a
  speculative path list.

Use `confidence` to describe evidence quality:

- `high` — the issue and repository evidence agree and identify the area or
  relationship directly.
- `medium` — the mapping is supported by repository relationships but the
  issue scope or downstream effect is incomplete.
- `low` — the result records a bounded possibility or unresolved relationship
  that requires investigation.

`relevant_paths` are repository-relative paths. Do not invent a path from a
framework convention, filename guess, issue label, or generic project
structure. A conceptual area may have an empty path list when no
path-level mapping is evidenced. Dependencies must name only areas or paths
whose relationship is supported by the area's evidence.

## Workflow

### 1. Validate the request and source evidence

1. Confirm that the request contains a task or issue source.
2. Validate each supplied handoff's schema and version.
3. Preserve source references, issue identity, and unavailable fields.
4. Separate explicit requirements from inferred scope. Do not treat labels,
   issue metadata, or a generic term such as "backend" as a path.

If a required source is missing or malformed, stop the mapping and return a
structured `blocked` result. If the mapping is possible but material context
is unavailable, return `partial` and list the limitation in
`source.unavailable_inputs` and `failure`.

### 2. Build the task focus

Extract only signals relevant to repository scope:

- requested behavior or change
- explicitly named applications, libraries, modules, files, APIs, tests,
  configuration, documentation, data models, or dependencies
- user-facing or system-facing surfaces named by the request
- explicit non-goals, constraints, and acceptance conditions

Record the normalized focus in `focus.summary` and retain explicitly named
paths in `focus.paths_of_interest`. Do not convert a desired behavior into a
specific component without repository evidence.

### 3. Establish bounded repository context

Read the applicable instructions and the relevant repository inventory before
following code relationships. Use existing `RepositoryContext.relevant_paths`
and findings as evidence when supplied. Otherwise inspect the smallest useful
set of repository-owned files, such as:

- project and package manifests
- source and test entry points
- API routes, clients, contracts, and adapters
- data-model definitions and migrations
- configuration used by the focused area
- documentation that names the focused behavior

Exclude generated output, caches, vendor directories, and unrelated projects
unless the task explicitly targets them. Record only verified paths and
relationships.

### 4. Trace relationships and downstream impact

For each explicit or strongly evidenced focus item, trace only relationships
that can be located in the repository:

1. Find the defining module, application, file, API, model, or configuration.
2. Check verified imports, exports, callers, consumers, providers, route
   registrations, schemas, or dependency declarations.
3. Check tests, fixtures, snapshots, documentation, and configuration that
   directly reference the area.
4. Record a downstream area as `indirect` only when the relationship is
   evidenced. Record it as `uncertain` when the relationship cannot be
   confirmed.
5. Keep dependency names and evidence specific enough for a later reviewer to
   verify them without turning the result into implementation guidance.

Do not infer that every consumer, test, configuration file, documentation page,
or transitive dependency is affected. Do not broaden a package or application
scope merely because it exists in the same repository.

### 5. Classify, deduplicate, and report

Create one area entry for each distinct repository concern. Include the
category, relevant paths, impact type, rationale, evidence, dependencies,
confidence, and recommended investigation points. Distinguish a direct
requested area from its indirect supporting or downstream areas. Omit
unsupported candidates instead of filling the result with generic scope.

Recommended investigation points must identify a missing relationship,
unverified path, source of evidence, or explicit question. They must not be
implementation steps, architecture proposals, test plans, or product
decisions.

Return one version-1 [`AffectedAreas`](../../shared/schemas/AffectedAreas.yaml)
handoff. Recommend at most one next Skill and do not invoke it automatically.

## Output contract

Use this English version-1 shape:

```yaml
schema: AffectedAreas
version: 1
status: identified
source:
  task_or_issue: "Add an export filter to the reporting workflow."
  issue:
    repository: null
    number: null
    title: null
    url: null
  loaded_issue_version: null
  issue_analysis_version: null
  repository_context_version: 1
  references:
    - "task"
    - "repository:src/reporting/export.ts"
  unavailable_inputs: []
focus:
  summary: "The request changes filtering in the reporting export workflow."
  paths_of_interest: []
areas:
  - area: "Reporting export module"
    category: module
    relevant_paths:
      - "src/reporting/export.ts"
    impact_type: direct
    rationale: "The module implements the requested export behavior."
    evidence:
      - "repository:src/reporting/export.ts#exportReport"
      - "task"
    dependencies:
      - "Reporting export tests"
    confidence: high
    recommended_investigation_points:
      - "Verify which export formats share this implementation."
  - area: "Reporting export tests"
    category: test
    relevant_paths:
      - "tests/reporting/export.test.ts"
    impact_type: indirect
    rationale: "The test suite exercises the directly affected export function."
    evidence:
      - "repository:tests/reporting/export.test.ts"
      - "repository:src/reporting/export.ts#exportReport"
    dependencies:
      - "Reporting export module"
    confidence: medium
    recommended_investigation_points:
      - "Verify whether filtering behavior is covered for every supported format."
recommended_next_skill: none
failure: null
```

Return `failure: null` only for `identified`. For `partial` or `blocked`,
include the failure code, operation, retryability, and the exact missing or
unreliable evidence.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No task, issue, or usable request focus was supplied. | `blocked` |
| `invalid_input` | A supplied task or handoff cannot be parsed or validated. | `blocked` |
| `unsupported_version` | A supplied `LoadedIssue`, `IssueAnalysis`, or `RepositoryContext` has an unsupported version. | `blocked` |
| `insufficient_context` | The request is assessable, but repository identity, relevant paths, or relationship evidence is materially unavailable. | `partial` |
| `analysis_failure` | A read-only mapping operation fails after valid inputs were accepted. | `partial` or `blocked`, according to whether any reliable areas remain |
