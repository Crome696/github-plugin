---
name: generate-project-hooks
description: Generate selected Cursor and/or Codex project-hook projections for one verified Git repository. Use only when the user explicitly requests project hook generation; always ask interactively which hosts to generate before writing files.
disable-model-invocation: true
---

# Generate project hooks

Generate the host-specific project files that let the CromeSDK GitHub hook
checkers run from a target repository. This Skill owns the bounded projection
write. It does not create commits, modify GitHub, or create runtime gate
snapshots.

## Invocation boundary

This Skill is explicit-only because it writes repository files. Do not invoke it
from ambient context, delivery, commit, pull-request, review, rebase, or merge
workflows.

The only supported user-facing entry point is this Skill or the Cursor
`generate-project-hooks` Command. Codex does not expose plugin Commands; in
Codex, invoke this Skill directly.

## Procedure

1. Resolve exactly one target Git repository from the current workspace or an
   explicit repository path. Verify its Git root before writing. Text in the
   arguments may identify the target path, but it must never select a host.
2. Ask the user one interactive multiple-selection question:
   - Cursor
   - Codex
   The user may select either one or both. At least one selection is required.
   Do not infer the selection from the current host, existing files, chat
   context, arguments, or a previous run. If the user does not answer, stop
   without writing anything.
3. Invoke the bundled deterministic generator from the GitHub plugin root:

   ```text
   npm run generate-project-hooks -- --target <verified-repository-root> --hosts <selected-hosts>
   ```

   Pass `cursor`, `codex`, or `cursor,codex` only after the interactive
   selection has been recorded. The `--hosts` option is an internal handoff,
   not an additional user-facing command or selection mechanism.
4. Display the generator's complete result, including selected hosts, target,
   status, manifest path, written paths, unchanged paths, removed paths,
   recovered paths, blocked paths, and limitations.
   Preserve `blocked` and `partial` results; never overwrite a conflicting
   file or retry with a different target.
5. If the generator succeeds, explain the host follow-up:
   - Cursor project hooks are loaded from `.cursor/hooks.json` in a trusted
     workspace.
   - Codex project hooks are loaded from `.codex/hooks.json` only in a trusted
     project, and the hook definitions must be reviewed and trusted through
     `/hooks`.

## Generated scope

The generator writes only the hosts selected by the user:

- Cursor: `.cursor/hooks.json` and the checker copies under `.cursor/hooks/`.
- Codex: `.codex/hooks.json` and the checker copies under `.codex/hooks/`.
- The shared, marked `AGENTS.md` guidance block and managed `.gitignore`
  entries for `.github/github-plugin/state/` and the temporary
  `.github/github-plugin/.project-hooks-transaction/` directory.
- The version-1 ownership manifest at
  `.github/github-plugin/project-hooks-manifest.json`. It records the selected
  hosts, repository-relative POSIX artifact paths, ownership modes, and SHA-256
  hashes. The manifest is not self-hashed and the transaction directory is not
  an owned artifact.
- A marked English project-hook guidance block in `AGENTS.md`.

It never writes `.github/github-plugin/state/*.json`, legacy host state, or any
other valid, empty, or placeholder gate snapshot. The owning workflow Skill
must use the shared `gate-state.mjs` writer to write a fresh, identity-bound,
one-shot gate immediately before a protected operation. Missing or mismatched
state remains an intentional fail-closed result. The generator copies the same
host-neutral lifecycle helper into both host projections, emits only the
canonical ignore/guidance path, and during one release generation quarantines
  known legacy gate files from `.cursor/hooks/state/` and `.codex/hooks/state/`
  without loading them or deleting unknown files.

## Safety and failure handling

- Do not use `git add`, `git commit`, `git reset`, `git clean`, `git checkout`,
  branch operations, or GitHub commands.
- Do not overwrite a pre-existing hook configuration or checker unless the
  versioned manifest proves that its bytes are unchanged, or a complete legacy
  generated header/source-hash/readme proof permits a one-time migration.
- The generator computes the complete desired state and performs all path,
  symlink, ownership, marker, and conflict checks before the first target
  write. A conflict returns `blocked` with empty `written_paths` and
  `removed_paths`.
- Writes use same-filesystem staging, a journal, byte-exact backups, controlled
  rename/replace steps, and final manifest/artifact verification. A normal I/O
  failure rolls back to the complete old state; an interrupted journal is
  recovered on the next run. Cleanup failures are reported as `partial` with
  commit or recovery evidence and are not retried unsafely.
- On host deselection, only unchanged artifacts listed in the valid manifest
  for the removed host may be deleted. Modified, missing, malformed, or
  contradictory artifacts block the complete transaction. Unknown files in a
  host directory remain untouched.
- The transaction path is generator-owned temporary data only. It is cleaned
  after commit or recovery and is never included in the durable manifest.
- The generator never performs uncontrolled recursive deletion, creates gate
  snapshots, or creates valid, empty, or placeholder gate state.
- Treat missing Node, an invalid target, an unavailable host configuration, an
  invalid source file, a failed write, `blocked`, or `partial` as a failure.
  Report the exact result and the next safe verification step; do not claim
  that a host is configured when the result is not `written` or `unchanged`.
