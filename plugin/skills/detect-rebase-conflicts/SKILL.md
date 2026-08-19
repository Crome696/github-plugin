---
name: detect-rebase-conflicts
description: Analyze one stopped or explicitly planned Git rebase, identify confirmed and potential conflicts with file- and hunk-level evidence, compare base, ours, and theirs changes, assess possible impact with available technology capabilities, and produce a read-only handoff for a separate resolution step. Use automatically when a rebase is stopped, conflicted, or being planned; never resolve conflicts or mutate Git state.
---

# Detect Rebase Conflicts

Analyze exactly one stopped or explicitly planned rebase and return a version-1
[`RebaseConflictAnalysis`](../../shared/schemas/RebaseConflictAnalysis.yaml)
handoff. The result is diagnostic input for a separate resolution workflow.

## Boundaries

- Read Git state and supplied evidence only. Never edit files, conflict markers,
  the index, `HEAD`, refs, branches, worktrees, or configuration.
- Never run `rebase --continue`, `rebase --skip`, or `rebase --abort`; never run merge,
  checkout, switch, reset, restore, clean, `git add`, commit, push, or conflict
  resolution commands.
- Analyze one explicit checkout and one rebase context. Do not infer a target
  branch, revision, repository, or rebase plan from the current branch name or
  recent history.
- Do not treat a planned rebase as a confirmed conflict. Mark predictions as
  `potential` and preserve the evidence and assumptions behind them.
- Do not propose or apply a merge choice, edit strategy, generated patch, or
  resolution command. A later resolution step owns those decisions.
- Keep repository paths relative and use the smallest verified hunk or index
  location. Never invent line numbers, blob IDs, or side contents.
- Redact credentials, tokens, private keys, `.env` values, personal data, and
  unnecessary command output. Write the handoff in English; conversational
  explanations may use the user's language.

## Accepted input

Require an explicit checkout and one of:

1. `mode: stopped`, with evidence of an active rebase and the current Git
   status/index state; or
2. `mode: planned`, with explicit source revision, target/base revision, and
   ordered commits or an equivalent bounded plan.

Validate all supplied identity and revision evidence:

- Resolve the canonical repository root and ensure the checkout belongs to the
  requested repository.
- Require full commit IDs for source, target, and any current rebase commit
  when available. Keep unavailable IDs null and record the limitation.
- Reject conflicting repository or revision identities instead of choosing one.
- For a stopped rebase, distinguish an active rebase state from ordinary
  uncommitted changes. An absent or unreadable rebase state is not proof that
  no conflict exists.
- For a planned rebase, do not start the rebase or create temporary state.
  Use only explicit revisions and read-only Git comparisons.

At least one bounded Git or supplied evidence source must be usable. Preserve
partial and unavailable sources instead of treating them as empty.

## Evidence collection

For a stopped rebase, inspect only read-only evidence such as:

- active rebase metadata and current operation;
- sanitized `status` and unmerged index stages;
- conflict-marker locations and the smallest relevant hunks;
- path status and rename/delete metadata;
- base, ours, and theirs blob or commit evidence where Git exposes it.

For a planned rebase, inspect only read-only evidence such as:

- explicit source and target revisions;
- the ordered commits to replay;
- merge-base and changed-path comparisons;
- overlapping edits, incompatible path operations, renames, binary files,
  submodules, and mode changes.

Use reproducible references such as:

- `input:checkout`, `input:source_revision`;
- `git:<sanitized command>`;
- `rebase-state:<field>`;
- `index:<path>:stage-1`, `index:<path>:stage-2`, `index:<path>:stage-3`;
- `diff:<path>:<line-range>`;
- `capability:<name>:<evidence-id>`.

A missing, truncated, or failed command is an uncertainty or limitation, never
a successful check.

## Conflict classification

Create one entry per distinct affected path and causal conflict. Use only these
types unless evidence supports a more precise repository-specific type:

- `content`, `add_add`, `modify_delete`, `delete_modify`,
  `rename_rename`, `rename_modify`, `directory_file`, `binary`, `submodule`,
  `mode`, or `unknown`.

Mark a conflict `confirmed` only when the stopped rebase or supplied evidence
shows an unmerged path, explicit conflict marker, failed replay, or equivalent
Git conflict state. Mark it `potential` when a planned comparison shows
overlapping or incompatible changes but no replay has confirmed the conflict.

For every entry, record:

- affected repository-relative path and optional old/new paths;
- base, ours, and theirs revision/blob references, with unavailable values
  explicit;
- the relevant changed lines, hunks, index stages, path operations, or binary
  metadata actually observed;
- plausible impact on behavior, build, data, API, generated output, or
  repository state, clearly separated from observed facts;
- confidence, uncertainty, and a concrete verification question for the
  resolution step.

Do not elevate a style difference or overlapping text alone into a confirmed
defect. Do not merge separate causal mechanisms merely because they affect one
file.

## External technology capabilities

Inspect capabilities already exposed by the current host session before
semantic assessment. Apply a capability only when it is available, relevant to
the verified path, and returns bounded evidence. Record its exact name, type,
availability, use, scope, and evidence in `capabilities_applied`.

Examples include a language, framework, schema, build, security, or domain
capability relevant to an affected file. Do not install, authenticate,
configure, or invent capabilities, and do not reference another plugin's
artifacts. An unavailable capability is a limitation, not a finding.

## Workflow

1. Validate repository, checkout, mode, source, target, and revision identity.
2. Establish whether the result is `analyzed`, `partial`, or `blocked`.
3. Collect only mode-appropriate read-only evidence and preserve command
   limitations.
4. Enumerate affected paths and classify each distinct conflict mechanism.
5. Compare base, ours, and theirs changes without choosing a resolution.
6. Apply relevant available technology capabilities and record their evidence.
7. Separate confirmed conflicts, potential conflicts, assumptions, and
   uncertainties.
8. Return exactly one English `RebaseConflictAnalysis` handoff and at most one
   advisory `recommended_next_skill` for the separate resolution workflow.

Use `blocked` for missing identity, conflicting revisions, missing required
planned inputs, or unusable evidence. Use `partial` when useful findings exist
but relevant state, hunks, revisions, or capabilities are unavailable.

## Output contract

First give a concise summary in the conversation language. Then return exactly
one version-1 `RebaseConflictAnalysis` object. It must include repository and
checkout identity, rebase mode and revisions, source evidence coverage,
conflicts, capabilities, assumptions, uncertainties, blockers, impact
assessment, resolution handoff boundaries, metadata, and failure evidence.

The output must state that it is read-only and does not authorize or perform
conflict resolution. A later resolution step may use the handoff, but this
Skill must never invoke that step automatically.
