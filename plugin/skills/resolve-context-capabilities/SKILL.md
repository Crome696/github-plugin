---
name: resolve-context-capabilities
description: Resolves relevant skills, rules, agents, tools, and domain capabilities for one issue or evaluated implementation using verified repository context, affected areas, technologies, architecture, risks, and planned work. Use automatically before implementation planning when the applicable capability set needs to be identified; does not execute capabilities, duplicate responsibilities, or invent unavailable capabilities.
---

# Resolve Context Capabilities

Determine which available external skills, rules, agents, tools, and domain capabilities are relevant to an issue and its evaluated implementation. Use repository context, affected areas, technologies, architecture, risks, and planned work to identify applicable capabilities without duplicating their responsibilities. Distinguish required from optional capabilities and explain why each applies. Detect missing capabilities that may block or weaken implementation. Return a structured result containing capability, type, relevance, priority, rationale, intended usage, and availability. Do not execute the resolved capabilities or invent unavailable ones.

Return one version-1 [`ContextCapabilities`](../../shared/schemas/ContextCapabilities.yaml) handoff. This Skill resolves applicability and availability evidence; it does not execute a resolved capability or replace the task-authorized [`ImplementationPlan`](../../shared/schemas/ImplementationPlan.yaml).

## Boundaries

- Read repository files, read-only Git metadata, supplied handoffs, and the
  current host-session capability inventory only. Never edit files, Git state,
  branches, worktrees, remotes, GitHub resources, or generated artifacts.
- Do not run installs, builds, tests, formatters, linters, migrations, hooks,
  or other commands that can change the checkout or external state.
- Do not execute, invoke, install, authenticate, or configure a resolved Skill,
  Rule, Agent, Tool, or domain capability. This Skill only records intended
  usage.
- Do not silently load a GitHub issue, invoke another Skill, choose a different
  repository, or infer repository identity from a branch name or arbitrary
  text.
- Do not treat a repository path, technology name, generic framework pattern,
  plugin directory, or documentation mention as proof that a capability is
  available in the current host session.
- Do not duplicate another capability's responsibility. Select the narrowest
  applicable capability and state its boundary; do not list a broad capability
  merely because it could also touch the same work.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive command arguments.
- Keep the structured handoff and newly authored capability descriptions in
  English. Keep questions and explanations in the user's conversation
  language.

## Input

Accept exactly one implementation context containing at least one of:

- A task description, issue title and body, or explicitly supplied request
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
  [`ImplementationEvaluation`](../../shared/schemas/ImplementationEvaluation.yaml)
  for evaluated feasibility, architecture, dependencies, risks, testing
  implications, and meaningful approaches.
- A version-1
  [`RepositoryConventions`](../../shared/schemas/RepositoryConventions.yaml)
  for mandatory and observed repository practices.

Planned work may be supplied as an explicit implementation brief or as
evidence in the task and `ImplementationEvaluation`. Do not create or require
an `ImplementationPlan` as an input; this handoff informs that later plan.

When the request, repository context, affected areas, implementation
evaluation, and capability inventory are complete enough for planning,
recommend `build-implementation-plan` as the next Skill. Recommend it in the
handoff only; never invoke it automatically.

Validate every supplied handoff before using it. Accept only the versions named
above and preserve repository identity, source status, unavailable fields,
conflicts, and evidence. If the task, repository identity, or material
implementation context cannot be verified, return `partial` or `blocked`
instead of attributing capabilities to an unverified context.

## Capability and availability model

The capability inventory is limited to evidence available in the current host
session:

- **Skill** — a loaded or explicitly supplied workflow for a bounded task.
- **Rule** — an active or explicitly supplied instruction that governs the
  context.
- **Agent** — a loaded or explicitly supplied orchestrator with a bounded
  workflow.
- **Tool** — a tool exposed and usable by the current host session, including
  an explicitly available MCP tool. Do not call it to verify availability.
- **Domain** — an explicitly supplied project or technology capability whose
  knowledge is available in the current session. A technology listed in
  `RepositoryContext` establishes a need signal, not domain expertise.

Use the following availability values:

- `available` — the capability is verified in the current host-session
  inventory and may be referenced for intended future use.
- `unavailable` — a specific capability is identified, but the current host
  session cannot use it because it is not exposed, loaded, authorized, or
  otherwise usable. Record the evidence; do not attempt to make it usable.
- `missing` — the context requires or would benefit from a capability, but no
  specific capability was identified.

Availability is separate from relevance and priority. A required capability
can be unavailable, and an optional capability can be available. Record
unavailable or missing capabilities in both `capabilities` and
`missing_capabilities`, with `impact: blocking` when implementation cannot be
reliably planned or performed without it and `impact: weakening` when quality,
coverage, or confidence may suffer but work could continue.

## Evidence model

Use concise references that let a reviewer locate the basis for each result:

- `task`, `title`, `body`, `comment[1]`, or another stable issue source
  reference.
- `repository:<path>` or `repository:<path>#<symbol>` for repository evidence.
- `manifest:<path>`, `config:<path>`, `api:<path>`, or
  `dependency:<path>` when the evidence has that specific role.
- A supplied handoff field such as `AffectedAreas.areas[0].evidence[0]`.
- A current-session capability reference such as
  `session:skill:<name>`, `session:rule:<name>`,
  `session:agent:<name>`, `session:tool:<name>`, or
  `session:domain:<name>` only when that capability is actually exposed by
  the current session.

Classify capability claims as:

- **evidenced** — directly listed by the current session, supplied handoff,
  repository instruction, or repository file.
- **inferred** — a reasonable need derived from evidenced technologies,
  architecture, affected areas, risks, or planned work.
- **uncertain** — the need, responsibility, or availability is incomplete,
  conflicting, or not strong enough to classify as available.

Use `confidence` to describe evidence quality, not implementation effort:

- `high` — the context and capability inventory directly agree.
- `medium` — the need or boundary is supported but one material relationship
  is inferred.
- `low` — the result records a bounded possibility or unresolved availability
  question.

## Workflow

### 1. Validate the request and source evidence

1. Confirm that exactly one task or issue context is supplied.
2. Validate the schema and version of every supplied handoff.
3. Verify repository identity from the checkout or `RepositoryContext`.
4. Copy source references and unavailable inputs into `source` without
   normalizing, substituting, or inventing issue identity.
5. Stop with `blocked` when no usable task or repository source exists.
   Continue with `partial` when a useful resolution is possible but material
   context or inventory evidence is unavailable.

### 2. Build the capability focus

Extract only signals relevant to capability selection:

- requested behavior, current behavior, desired outcome, and planned work;
- explicit scope, non-goals, constraints, and acceptance conditions;
- affected applications, libraries, modules, files, APIs, tests,
  configuration, documentation, data models, and dependencies;
- repository technologies, architecture boundaries, conventions, extension
  points, risks, compatibility concerns, and testing implications;
- evaluated approaches, blockers, assumptions, and required investigation.

Record those signals in `focus`. Do not turn a behavior into a framework,
tool, agent, or domain capability without supporting evidence.

### 3. Inventory current-session capabilities

Inspect only the capability names and descriptions already exposed by the
current host session or explicitly supplied as input. Record the type,
specific boundary, and availability evidence for each candidate. Do not:

- invoke a candidate to test it;
- search another plugin or marketplace to make a candidate available;
- infer a capability from a technology label or a familiar name;
- treat a repository-local file as a loaded external capability;
- claim an MCP server or tool is available when its current session status
  does not establish that.

Keep repository-local rules and skills within `plugin/` when they are
included as plugin capabilities. A separately exposed external technology,
testing, security, documentation, or domain capability may be recorded by its
exact `session:skill:<name>`, `session:rule:<name>`, or other host-session
identity and source evidence. Do not copy its content into this plugin,
execute it, or treat an artifact from another plugin as available merely
because it exists in the checkout.

### 4. Match needs without duplicating responsibilities

For each evidenced need:

1. Select the narrowest capability whose documented responsibility covers it.
2. Exclude capabilities that only overlap incidentally or would repeat another
   capability's work.
3. State the exact intended usage and the boundary left to other capabilities.
4. Use repository evidence to distinguish a required capability from an
   optional quality or confidence improvement.
5. Assign `high`, `medium`, or `low` priority independently from
   `required` or `optional` relevance.

Do not list every available capability. A capability is relevant only when the
issue, evaluated implementation, affected areas, repository context, risks, or
planned work gives it a concrete role.

### 5. Detect gaps and classify the result

For every required or useful capability that is not available, add one
corresponding `missing_capabilities` entry. Distinguish:

- `missing` when no specific capability is known;
- `unavailable` when a specific capability is known but cannot be used in the
  current session;
- `blocking` when the gap prevents a reliable implementation plan or
  execution boundary;
- `weakening` when the gap reduces confidence, safety, coverage, or quality
  without preventing a bounded plan.

Use `resolved` when the request, repository, and capability inventory are
verified well enough to return a complete resolution. Use `partial` when a
useful result remains but a material input, boundary, or availability claim is
unresolved. Use `blocked` when the request or repository source is missing,
invalid, or has an unsupported handoff version.

### 6. Return the handoff

Return exactly one version-1
[`ContextCapabilities`](../../shared/schemas/ContextCapabilities.yaml) object.
Preserve order when priority or intended future usage makes the order
meaningful. Recommend at most one next Skill and never invoke it. Set
`failure: null` only for a `resolved` result; include structured failure
evidence for `partial` and `blocked`.

## Output contract

Use this English version-1 shape. The example is illustrative and must be
replaced with evidence from the actual request, repository, and current
session:

```yaml
schema: ContextCapabilities
version: 1
status: resolved
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
  implementation_evaluation_version: 1
  repository_context_version: 1
  repository_conventions_version: 1
  references:
    - task
    - repository:src/reporting/export.ts
    - session:skill:evaluate-implementation
  unavailable_inputs: []
focus:
  summary: "Resolve capabilities for filtering the reporting export workflow."
  technologies:
    - "The reporting technology identified by RepositoryContext."
  architecture_signals:
    - "The request maps to the existing export boundary."
  risks:
    - "Shared export behavior may affect more than one format."
  planned_work:
    - "Preserve the existing export boundary while evaluating the filter."
  paths_of_interest:
    - "src/reporting/export.ts"
capabilities:
  - capability: "Implementation approach evaluation"
    type: skill
    relevance: required
    priority: high
    rationale: "The context includes meaningful implementation alternatives and compatibility concerns."
    intended_usage: "Evaluate feasibility and approach trade-offs before the implementation plan is finalized."
    scope_boundary: "Evaluates approaches; it does not resolve capabilities or implement changes."
    availability: available
    evidence:
      - session:skill:evaluate-implementation
      - repository:plugin/skills/evaluate-implementation/SKILL.md
    confidence: high
missing_capabilities: []
recommended_next_skill: build-implementation-plan
failure: null
```

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No task, issue, or usable repository source was supplied. | `blocked` |
| `invalid_input` | A supplied task or handoff cannot be parsed or validated. | `blocked` |
| `unsupported_version` | A supplied handoff has an unsupported schema version. | `blocked` |
| `insufficient_context` | Resolution is useful, but task, repository, implementation, or session-inventory evidence is materially unavailable. | `partial` |
| `conflicting_evidence` | Issue, handoff, instruction, repository, or capability-inventory evidence conflicts in a way that may change applicability or availability. | `partial` |
| `analysis_failure` | Read-only resolution fails after valid inputs were accepted. | `partial` or `blocked`, according to whether reliable findings remain |
