---
name: inspect-repository
description: Inspects a repository read-only and returns a bounded, issue-focused version-1 RepositoryContext covering applications, libraries, packages, project and architecture boundaries, technologies, build systems, package managers, configuration, tests, documentation, development tooling, instructions, commands, relevant paths, assumptions, and open questions for downstream planning or implementation. Use automatically when repository context is needed for a task or issue; do not use for source-code implementation, project-specific test design, issue rewriting, or GitHub writes.
---

# Inspect Repository

Inspect the current repository to establish reliable context for downstream
planning and implementation. Build a bounded, issue-focused inventory rather
than loading the entire codebase. Identify applications, libraries, packages,
services, project boundaries, languages, frameworks, build systems, package
managers, configuration, tests, documentation, development tooling, and
recognizable architecture boundaries. Locate applicable repository
instructions without duplicating the detailed convention analysis owned by
`detect-repository-conventions`. Distinguish verified facts from assumptions
and unresolved questions. Return a concise structured repository context with
relevant paths, technologies, commands, and findings.

## Boundaries

- Read local repository files and read-only Git or GitHub metadata only. Never
  edit files, Git state, branches, worktrees, remotes, GitHub resources, or
  generated artifacts.
- Do not run installs, builds, tests, formatters, linters, migrations, hooks,
  or other commands that can change the checkout or external state. Discover
  commands from configuration and documentation; report them without running
  them.
- Keep inspection bounded. Do not load the entire source tree or large
  dependency, vendor, cache, coverage, or generated trees into context. Prefer
  directory metadata, manifests, configuration, targeted files, and concise
  evidence paths over source or documentation dumps.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive command arguments. Redact credentials before
  recording remote or command evidence.
- Keep this workflow within repository-collaboration scope. Inventory a
  framework, test runner, or project tool only as repository evidence; do not
  provide implementation advice, design a project-specific test strategy, or
  infer domain or product rules.
- Do not silently load an issue, choose a different repository, invoke another
  Skill, or turn an inferred convention into a requirement.
- Keep the structured handoff and newly authored report text in English. Keep
  explanations in the user's conversation language.

## Input

Use the current workspace checkout as the primary input. Accept an optional
task focus containing any combination of:

- A task or issue description
- A repository and issue identity or issue URL
- A supplied version-1 `LoadedIssue` snapshot
- Explicit paths or project areas to inspect

Copy only the focus needed to scope inspection into `focus`. If a
`LoadedIssue` is supplied, use its repository identity and available affected
paths as evidence; do not re-fetch or reinterpret the issue automatically.
Never infer repository or issue identity from an unrelated branch name or
arbitrary text.

## Workflow

### 1. Establish checkout and repository identity

1. Confirm the current path is a repository checkout and record its
   `checkout_path`.
2. Read the repository root, current branch, `HEAD`, working-tree state,
   staged/untracked state, and available base-branch information using
   read-only Git operations.
3. Read remote names and URLs. Strip credentials, query secrets, and embedded
   tokens before using any URL as evidence.
4. When the target is a GitHub repository and the read-only GitHub CLI is
   available, use it only to verify `owner`, `name`, canonical URL, default
   branch, and visibility. Otherwise use the sanitized remote only when it
   verifies the same identity.
5. If the checkout or repository identity cannot be verified, return
   `status: blocked` with the required fields populated only with known
   values. Do not guess an owner, repository name, URL, branch, or target
   remote.

Set `remotes[].is_target` to `true` only when the supplied repository identity
or an explicit repository configuration verifies that remote. Keep it `false`
when target status is not verified and record the uncertainty in `findings`.

### 2. Read applicable instructions

Locate instruction sources that can govern the checkout, including:

- `AGENTS.md` and `CLAUDE.md`
- `CONTRIBUTING`, `CONTRIBUTING.md`, and equivalent contribution guides
- `.cursor/rules/` and other host-specific rule directories
- Repository-local plugin or package instructions
- Relevant `.github/` contribution and workflow guidance

Read only files applicable to the checkout or focused paths. Record each
instruction path, its apparent scope, and `precedence` only when the file or
repository convention makes precedence explicit. A nearer instruction file
may narrow a broader one, but do not claim a precedence order that the
repository does not establish. Preserve conflicts as an `open_question`
finding instead of resolving them silently.

### 3. Map repository structure and project boundaries

Inspect the root listing and bounded directory metadata, excluding `.git`,
dependency/vendor directories, caches, coverage, and generated output unless
the task explicitly targets them. Do not recursively load unrelated source
 files. Identify:

- Top-level applications, packages, libraries, services, plugins, and shared
  workspaces
- Monorepo markers, workspace declarations, and explicit project boundaries
- Source, test, documentation, configuration, CI, and tooling directories
- Relevant entry points and manifests
- Recognizable architecture boundaries, such as application/library/plugin or
  service separation, package/workspace boundaries, and documented source
  layers

Represent each task-relevant project boundary and supporting artifact in
`relevant_paths` with a repository-relative path and a concrete reason. Do
not claim that a directory is a project solely because its name looks
project-like; use a manifest, configuration, source layout, dependency
declaration, or documentation as evidence. Record an architecture boundary as
a fact only when its boundary is directly evidenced; otherwise preserve it as
an inferred or uncertain finding with the supporting paths. Inventory these
boundaries as repository context; leave their detailed naming and organization
conventions to `detect-repository-conventions`.

### 4. Inventory technologies, packages, and tooling

Read the smallest set of manifests and configuration files that can verify
the stack. Check applicable examples such as:

- Languages and runtimes: source extensions, language manifests, runtime
  declarations, and version files
- Frameworks: dependency manifests and framework configuration, not directory
  names alone
- Applications, libraries, and packages: project manifests, workspace
  declarations, package metadata, and directly declared package dependencies
- Build systems: package scripts, Make/Task files, compiler and bundler
  configuration, project files, and CI definitions
- Package managers: lockfiles, workspace declarations, and package-manager
  metadata
- Tests: test directories, test scripts, test-runner configuration, and CI
  test jobs
- Documentation: README files, `docs/`, contribution guides, architecture
  notes, and generated documentation configuration
- Development tooling: formatters, linters, type checkers, pre-commit
  configuration, CI workflows, containers, and release tooling

Add one `technologies` entry per distinct evidenced technology or tool. Use
`evidenced` for direct declarations, `inferred` only for a reasonable
conclusion supported by multiple or strongly indicative paths, and
`uncertain` for conflicting or incomplete evidence. Use the prescribed
category values; put project boundaries and artifacts in `relevant_paths`.

### 5. Discover commands without executing them

Collect developer commands from package-manager scripts, Make/Task files,
language-tool configuration, contribution documentation, CI workflows, and
other repository-owned instructions. Record the command name, exact
non-sensitive command, certainty, and evidence path in `commands`.

Prefer commands explicitly documented as supported. Mark commands inferred
from configuration as `inferred`, and do not present a command as verified
because it merely resembles a common ecosystem command. Do not execute a
discovered command.

### 6. Apply task focus

When a task or issue is supplied:

1. Extract only its repository, project, path, technology, and workflow
   signals needed to scope inspection.
2. Inspect the named paths and their applicable instructions first.
3. Follow direct references from those paths to the minimum additional
   manifests, project boundaries, tests, documentation, or tooling needed for
   context.
4. Stop once the relevant project context and evidence are sufficient for the
   handoff; do not enumerate unrelated projects or read unrelated source.
5. Record omitted areas or unavailable paths as `uncertain` findings when
   they could affect downstream planning.

Without a supplied focus, perform a bounded root-level inventory and inspect
project metadata before considering deeper files. Prioritize repository
identity and instructions, named or directly referenced project metadata,
adjacent project boundaries, and direct dependency edges in that order.

Do not turn task language into repository facts. Keep product requirements in
the supplied issue or task rather than copying them into this handoff.

### 7. Classify evidence and status

Classify every technology, command, finding, and non-trivial architecture
assertion:

- `evidenced` — directly stated by a readable repository or metadata source
- `inferred` — derived from clear, recorded evidence but not directly stated
- `uncertain` — incomplete, conflicting, inaccessible, or unresolved

Use `findings.kind: fact` for verified observations,
`findings.kind: assumption` for interpretations that downstream work must
validate, and `findings.kind: open_question` for unresolved decisions or
conflicting evidence. Every entry needs concise evidence that points to a
path, metadata field, or read-only command result.

Set the result to:

- `verified` when repository identity and the relevant local context were
  inspected successfully with no material unresolved evidence gap
- `partial` when identity is verified but important local or external context
  could not be read or verified
- `blocked` when a required checkout or repository identity cannot be
  established, or a supplied focus conflicts with the verified repository
  identity

Do not use `partial` or `blocked` to hide a normal empty result. An empty test,
documentation, or tooling inventory is a verified finding when the relevant
repository area was actually inspected.

## Output contract

Return one version-1 `RepositoryContext` handoff. The contract requires the
top-level fields `status`, `repository`, `git`, `remotes`, `relevant_paths`,
and `instructions`. Include the additional context fields shown below when
applicable; use an inspected empty list or `null` for no applicable data, and
preserve unavailable or conflicting evidence in `findings` and `checks`.
Preserve the field names and values defined by
[`RepositoryContext`](../../shared/schemas/RepositoryContext.yaml):

```yaml
schema: RepositoryContext
version: 1
status: verified | partial | blocked
repository: {}
git: {}
remotes: []
relevant_paths: []
instructions: []
technologies: []
commands: []
findings: []
checks: []
focus: null
```

Use repository-relative paths except for the explicitly named
`git.checkout_path`. Keep `null` for unavailable values and distinguish it
from an inspected empty list. Include checks for identity, Git state,
instruction discovery, structure/stack discovery, and focus coverage where
relevant. If the result is `partial` or `blocked`, preserve the missing or
conflicting evidence in `findings` and `checks`; never fabricate a complete
context.

After the handoff, give a concise conversation-language summary of the
verified facts, assumptions, and unresolved questions. Do not claim that a
build, test, installation, or other discovered command passed unless it was
explicitly run by an authorized separate workflow.
