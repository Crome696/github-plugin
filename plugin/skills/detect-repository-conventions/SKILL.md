---
name: detect-repository-conventions
description: Detect repository conventions for planning and implementation, including naming, structure, architecture boundaries, code organization, branching, commits, testing, documentation, formatting, linting, and contribution requirements. Use automatically when repository conventions are needed for planning or implementation; do not modify the repository or turn observed patterns into mandatory rules.
---

# Detect Repository Conventions

Analyze the repository to identify established development conventions relevant to planning and implementation. Detect naming patterns, project structure, architecture boundaries, coding organization, branching and commit conventions, testing practices, documentation patterns, formatting, linting, and contribution requirements. Prioritize explicit repository instructions over inferred patterns. Support inferred conventions with concrete evidence from existing files and code. Identify conflicting or inconsistent conventions and clearly distinguish mandatory rules from observed practices. Return a structured summary with convention, evidence, scope, confidence, and relevant paths. Do not modify the repository.

## Boundaries

- Read repository files and read-only Git or GitHub metadata only. Never edit
  files, Git state, branches, worktrees, remotes, GitHub resources, or
  generated artifacts.
- Do not run installs, builds, tests, formatters, linters, migrations, hooks,
  or other commands that can change the checkout or external state. Discover
  commands and tools from repository-owned files without executing them.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive command arguments. Redact credentials before
  recording metadata as evidence.
- Keep the workflow within repository-convention discovery. Do not implement
  source changes, design a project-specific test strategy, infer product or
  domain rules, or prescribe improvements.
- Do not silently invoke another Skill, load an issue, choose a different
  repository, or treat a branch name alone as repository identity.
- Keep the structured handoff and newly authored report text in English. Keep
  questions and explanations in the user's conversation language.

## Input

Use the current workspace checkout as the primary input. Accept an optional
focus containing:

- A task or issue description
- Explicit paths or project areas
- A supplied version-1 `RepositoryContext` handoff

Copy only repository, project, path, technology, or workflow signals needed to
scope discovery into `focus`. A supplied `RepositoryContext` may provide
verified identity and relevant paths as evidence, but it never replaces
identity verification and must not be silently re-fetched or modified.

The output is the companion `RepositoryConventions` handoff for that
`RepositoryContext`. It extends the downstream planning context with
convention descriptions and their evidence sources; it does not mutate or
replace the `RepositoryContext` contract.

## Evidence model

Record one convention per distinct, actionable pattern. Every convention must
include a concrete evidence reference and a repository-relative path.

### Authority

- `mandatory` is reserved for an applicable explicit instruction or
  authoritative repository configuration. Examples include `AGENTS.md`,
  `CLAUDE.md`, `CONTRIBUTING*`, applicable host rules, package instructions,
  required CI checks, and formatter or linter configuration that governs the
  relevant scope.
- `observed` describes a repeated or otherwise clear pattern in source files,
  project structure, documentation, configuration, or read-only Git history.
  It is useful guidance but is not a requirement.

An explicit applicable instruction takes precedence over an inferred pattern.
A nearer instruction may narrow a broader one only when the repository makes
that scope or precedence clear. Do not invent a precedence order.

A declared script, tool, or configuration key is evidence that it exists, not
by itself evidence that contributors must use it. Read-only Git history can
support an observed pattern, but cannot establish a mandatory rule.

### Confidence

- `evidenced`: directly stated or directly configured in a readable source.
- `inferred`: a reasonable conclusion supported by concrete evidence from
  existing files, code, structure, or history but not directly stated.
- `uncertain`: evidence is incomplete, inaccessible, or conflicting.

Use `findings.kind: fact` for verified observations,
`findings.kind: assumption` for interpretations that downstream work must
validate, and `findings.kind: open_question` for unresolved or conflicting
evidence. Never promote an `inferred` or `uncertain` finding to a mandatory
convention.

Do not infer a convention from a single example, the current branch alone, or
an ecosystem default. If an inspected category has no supporting evidence,
return no convention entry for that category; do not create a placeholder.
When evidence is incomplete or contradictory, preserve the limitation as an
`uncertain` convention or finding and record the conflict.

## Workflow

### 1. Establish checkout and repository identity

1. Confirm that the workspace is a repository checkout.
2. Record the checkout path, current branch, `HEAD`, working-tree state, and
   available base-branch information with read-only Git operations.
3. Read remote names and URLs only as sanitized identifiers. Strip credentials,
   query secrets, and embedded tokens.
4. When a GitHub target is explicitly available and read-only GitHub metadata
   can verify it, use that metadata to confirm owner, name, canonical URL,
   default branch, and visibility.
5. If the checkout or repository identity cannot be verified, return
   `status: blocked` with only known repository values. Do not guess identity.

### 2. Read applicable instructions first

Locate and read instructions that may govern the checkout or focused paths:

- `AGENTS.md` and `CLAUDE.md`
- `CONTRIBUTING`, `CONTRIBUTING.md`, and equivalent contribution guides
- `.cursor/rules/` and other host-specific rule directories
- Repository-local plugin, package, or workspace instructions
- Relevant `.github/` contribution and workflow guidance

Record explicit requirements as `authority: mandatory`, with their scope and
paths. Preserve contradictory instructions as a conflict and an
`open_question`; do not resolve them silently.

### 3. Map project structure and architecture boundaries

Inspect bounded directory metadata and the smallest set of relevant manifests,
excluding `.git`, dependencies, vendor directories, caches, coverage, and
generated output unless the focus explicitly targets them. Identify:

- Top-level applications, packages, libraries, services, plugins, and shared
  workspaces
- Manifest-defined project boundaries and monorepo relationships
- Source, test, documentation, configuration, CI, and tooling directories
- Entry points, public interfaces, dependency direction, and layer boundaries
  that are supported by imports, configuration, manifests, or documentation

Do not call a directory a project or an architecture boundary based on its
name alone. Record the path and evidence that establishes the boundary.

### 4. Detect conventions by category

Inspect only the files needed to support the requested scope. Check each
applicable category:

- `naming`: directories, files, symbols, exports, configuration keys, tests,
  and public identifiers
- `project_structure`: package layout, workspace boundaries, source/test
  placement, entry points, and shared areas
- `architecture`: module dependencies, layer boundaries, ownership markers,
  public/private interfaces, and prohibited cross-boundary references
- `coding_organization`: module size and responsibility patterns, shared
  utilities, colocated artifacts, and repeated implementation organization
- `branching`: documented branch policy, protected/default branches, branch
  naming, and repeated branch patterns visible in read-only Git metadata
- `commits`: explicit commit requirements and repeated subject/body patterns
  in read-only history; history alone produces an observed convention
- `testing`: test locations, naming, fixtures, runners, scripts, CI checks,
  required coverage, and documented validation practices
- `documentation`: README, docs, architecture notes, inline documentation,
  changelogs, release notes, and required update patterns
- `formatting`: formatter configuration, editor settings, generated-file
  policy, and formatting commands documented by the repository
- `linting`: linter, type-checker, static-analysis, pre-commit, and CI
  configuration, including scope and required status checks
- `contribution`: pull-request, issue, review, release, sign-off, and
  validation requirements documented by the repository

For build and validation signals, read package-manager scripts and manifests,
Make or Task files, CI workflows, contribution documentation, and other
repository-owned command definitions. Record a command as a convention under
`testing`, `contribution`, `formatting`, or `linting` only when its required,
recommended, or repeated use is evidenced. Keep a merely available command in
the supplied or separately discovered `RepositoryContext.commands` inventory
instead of turning it into a rule, and never execute it.

Use direct configuration or instructions as evidence for mandatory rules.
Use repeated examples from existing files or history as evidence for observed
patterns. An inspected category with no evidence is a verified empty result,
not a guessed convention.

### 5. Detect conflicts and scope

When sources disagree, record:

- The conflicting convention descriptions
- The evidence for each source
- The affected categories and repository-relative paths
- Whether the conflict is unresolved, resolved by scope, or resolved by an
  explicit authoritative instruction

Do not merge package-specific patterns into a repository-wide convention.
Represent each distinct scope separately, and mark a convention `uncertain`
when the available evidence cannot establish its scope.

### 6. Classify status and produce the handoff

Use:

- `verified` when identity and the relevant convention sources were inspected
  successfully without a material evidence gap
- `partial` when identity is verified but an important local area or source
  could not be inspected
- `blocked` when checkout or identity cannot be established, or the supplied
  focus conflicts with verified repository identity

Return exactly one version-1 `RepositoryConventions` handoff. Preserve all
required fields from
[`RepositoryConventions`](../../shared/schemas/RepositoryConventions.yaml):

```yaml
schema: RepositoryConventions
version: 1
status: verified | partial | blocked
repository: {}
conventions: []
conflicts: []
findings: []
checks: []
focus: null
```

Use repository-relative paths except for explicitly identified external
metadata. Include checks for identity, instruction discovery, project
structure and architecture, convention categories, conflict coverage, and
focus coverage where relevant. If the result is `partial` or `blocked`,
preserve the missing or conflicting evidence in `findings` and `checks`.

When a valid `RepositoryContext` was supplied, preserve its scope and
identity evidence in the result and add only the convention evidence found by
this workflow. Do not claim that the context was reloaded or changed.

After the handoff, provide a concise conversation-language summary of verified
mandatory rules, observed practices, confidence limits, and unresolved
questions. Do not claim that a build, test, formatter, linter, or other
discovered command passed unless an authorized separate workflow explicitly
ran it.
