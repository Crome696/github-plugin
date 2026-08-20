---
name: create-commit
description: Creates and verifies exactly one Git commit from an approved version-1 CommitProposal with exact file scope, message, and task-scoped delivery authorization. Use automatically when validated changes are ready; never push or create a pull request.
---

# Create Commit

Create exactly one local Git commit from one approved
[`CommitProposal`](../../shared/schemas/CommitProposal.yaml). This Skill owns
the path-scoped staging, commit, and verification steps. It does not compose,
rewrite, or approve the proposal.

## Boundaries

- Accept only one version-1 `CommitProposal` with
  `status: approved`,
  `authorization.exact_scope_approved: true`, and
  `authorization.commit_authorized: true`.
- Stage only the repository-relative paths listed in
  `files.added`, `files.modified`, and `files.deleted`.
- Never use `git add .`, `git add -A`, `git add --all`, `git commit -a`, or a
  wildcard pathspec. Never stage a path merely because it appears in the
  working tree.
- Use only the approved `message.subject` and `message.body`. Do not add,
  remove, translate, normalize, or infer message text, trailers, issue
  references, or co-authors.
- Never amend, reset, restore, clean, checkout, switch, rebase, merge, force
  push, push, create a pull request, or invoke another Skill automatically.
- Do not bypass hooks with `--no-verify` or equivalent flags.
- Do not expose or commit secrets, tokens, private keys, credential-bearing
  values, `.env` contents, or other confidential data.
- Before the final status check, write one local version-2 `PreCommitGate`
  snapshot to `.cursor/hooks/state/pre-commit.json` containing the exact
  approved `CommitProposal`, the complete current `ValidationResult`, the
  verified worktree identity, the pre-commit `HEAD`, the exact approved
  message-file bytes, and the complete cached staged-index fingerprint. The
  hook state path is ignored and must never be staged. Version-1 snapshots
  fail closed and must be regenerated as version 2.
- A normal commit uses the existing task-scoped delivery authorization and
  does not ask for a second conversational approval. A repository instruction
  may explicitly re-enable an interactive commit gate for its scope.

## Required input

Validate all of the following before changing the index:

1. The input is exactly one version-1 `CommitProposal` with the required
   `status`, repository, branch, file lists, message, and authorization
   fields.
2. `status` is `approved`; reject `draft`, `partial`, `created`, or
   `blocked`. Both authorization flags are `true`,
   `authorization.source` identifies `task_intent`, `plan_build`,
   `repository_policy`, `session_continuity`, or `explicit_user`, and
   `authorization.evidence` identifies the task scope and authorization
   source. A diagnostic validation or readiness flag is not commit
   authorization.
   `validation.result_status` must be `passed` with non-empty evidence; a
   partial, blocked, failed, or unknown validation result is not a validated
   commit input.
3. `repository`, `branch`, and `base_sha` agree with the trusted
   `BranchWorkspace` or `WorkingTreeInspection` handoff. The expected
   absolute worktree path must come from that handoff or explicit verified
   workspace input. Do not silently substitute the current checkout, branch,
   or path.
4. The workspace is the expected repository and branch. A primary-checkout
   operation is valid only when an applicable repository instruction clearly
   authorizes that exact operation and scope; record the policy path and
   concise evidence.
5. The union of `files.added`, `files.modified`, and `files.deleted` is
   non-empty, contains no duplicates or overlaps, and contains only
   repository-relative paths. Reject absolute paths, paths containing `..`
   components, empty paths, and paths with NUL characters. Preserve the exact
   path spelling from the approved proposal.
6. The complete current version-1 `ValidationResult` is available with
   `status: passed`, aligned scope, no blockers or unresolved unexpected
   changes, passed required checks, and
   `readiness.commit_preparation_allowed: true`. Its complete handoff is
   required for the `PreCommitGate`; `validation.result_status` alone is not
   sufficient.
7. `message.subject` is non-empty and `message.body` is a string. Require
   `commit.sha: null`, `commit.created_at: null`, and an empty
   `commit.files_committed` when those fields are supplied; do not reuse an
   earlier commit result.

Missing, malformed, contradictory, or stale input is `blocked`. Do not guess
the repository, branch, worktree, scope, or message.

## Autonomous delivery authorization

Immediately before the local Git write, state the exact operation:

> Create one Git commit in `<repository>` on `<branch>` containing exactly
> `<approved paths>` with the approved message `<subject>`; no push or pull
> request will be performed.

For the normal task-scoped delivery path, this statement is an execution
announcement. Do not wait for another affirmative response when the proposal's
authorization record covers the same repository, task, branch, worktree, and
validated path scope. Preserve that record in the resulting handoff.

If applicable repository instructions explicitly require an interactive
commit gate, wait once for that exact scope and record the approval. A new
file list within the same verified issue or task does not create a second
conversation gate; re-run the read-only scope and validation checks instead.

## Workflow

### 1. Verify identity and read-only state

Before staging, verify the worktree with read-only Git commands:

```text
git -C <worktree_path> rev-parse --show-toplevel
git -C <worktree_path> branch --show-current
git -C <worktree_path> rev-parse --verify HEAD^{commit}
git -C <worktree_path> status --porcelain=v1 --untracked-files=all
git -C <worktree_path> ls-files -u
```

The repository root, branch, current commit ancestry, and worktree
association must match the trusted handoff. A non-empty unmerged-index result,
in-progress merge/rebase/cherry-pick/revert/bisect, unresolved identity, or
repository mismatch blocks the operation. Do not repair the state.

### 2. Perform the pre-staging scope check

Treat the approved path union as the only allowed scope. Parse the complete
`git status --porcelain=v1 --untracked-files=all` result, including staged,
unstaged, deleted, renamed, and untracked paths.

- Every approved path must be present in the expected change state or be an
  approved deletion.
- Any staged path outside the approved union is a blocker. Do not stage or
  commit around it.
- Any changed, deleted, renamed, or untracked path outside the approved union
  is scope drift and a blocker. Do not silently classify it as harmless.
- A path with an unmerged status is always a blocker.
- Do not continue when the approved scope is empty, has disappeared, or no
  longer matches the validated working-tree evidence.

This check happens before any `git add` command. If it blocks, leave the index
and files unchanged and return `status: blocked`.

### 3. Stage only the approved paths

For each path in the approved union, run an individual explicit pathspec
operation:

```text
git -C <worktree_path> add -- <approved-path>
```

Quote paths according to the active shell. The `--` separator is required.
This command also records an approved deletion when the path is absent from
the worktree. Never use a directory, wildcard, `-u`, or bulk pathspec.

Immediately inspect the resulting index:

```text
git -C <worktree_path> diff --cached --name-only --no-renames
git -C <worktree_path> diff --cached --check
```

The cached name set must equal the approved path union exactly. A missing,
extra, duplicate, unmerged, or uncheckable path blocks the commit. Do not
unstage or clean automatically; report the exact diagnostic state.

### 4. Write the local PreCommitGate snapshot

After the cached scope and whitespace checks pass, write exactly one
repository-local, ignored JSON snapshot at
`.cursor/hooks/state/pre-commit.json`. Create the ignored state directory only
when it does not exist. The snapshot must have this version-2 shape:

```json
{
  "schema": "PreCommitGate",
  "version": 2,
  "workspace": {
    "repository": "<verified owner/repository>",
    "path": "<verified absolute worktree path>",
    "branch": "<verified branch>",
    "head_sha": "<HEAD captured before staging>"
  },
  "validation": "<the complete current ValidationResult object>",
  "commit_proposal": "<the exact approved CommitProposal with an empty commit result>",
  "commit_binding": {
    "message_file": {
      "path": "<absolute temporary message-file path>",
      "sha256": "<SHA-256 of the complete message-file bytes>",
      "byte_length": 0
    },
    "staged_index": {
      "format": "git-diff-cached-raw-z-no-renames-full-index-abbrev-40-v1",
      "sha256": "<SHA-256 of the cached raw staged-index bytes>",
      "byte_length": 0
    }
  },
  "written_at": "<current ISO-8601 timestamp>"
}
```

The `workspace`, `validation.workspace`, and `commit_proposal` identities must
agree. `validation` must be the complete current handoff, not a summary or
only its `result_status`; `commit_proposal` must remain `status: approved` and
must contain the exact repository-relative path union and authorization. The
message file must contain the approved subject, two newline characters when a
body is present, the approved body, and exactly one trailing newline. The
staged-index digest must be captured from the exact format named in the
snapshot and must be recomputed immediately before commit preparation. Do not
put secrets, tokens, private keys, `.env` contents, or credential-bearing
values into the snapshot. If the snapshot cannot be written or verified as
valid JSON, return `status: blocked` and leave the index and files unchanged.
Do not rewrite or delete a stale snapshot as a repair step.

### 5. Check status immediately before committing

Apply the shared [`cli-transport-file-lifecycle` Rule](../../rules/cli-transport-file-lifecycle.mdc)
to the exact temporary message file before this check, using only the approved
message fields as described in the next section. The file is transport-only;
the gate snapshot may bind its exact path and bytes for the one commit
invocation, but it must not turn the file into retained workflow state. Then
run the final pre-commit check:

```text
git -C <worktree_path> status --porcelain=v1 --untracked-files=all
```

This command must be the last read-only operation before `git commit`. The
index and working-tree status must still contain only the approved scope, with
no unmerged entries or new scope drift. Do not run a formatter, test, hook
preparation command, or other operation between this check and the commit.
The only subsequent operation is the commit using the already prepared
message file.

### 6. Create the commit with the exact message

Construct one temporary message file from the approved fields only before the
immediate pre-commit status check:

- when `message.body` is empty, the file contains exactly `message.subject` and
  one trailing newline;
- otherwise, it contains `message.subject`, two newline characters, and
  `message.body`, followed by one trailing newline.

Do not add a trailing explanation, generated metadata, or trailer. The only
permitted command is one standalone direct invocation with the verified
worktree and exact message file; wrappers, pipelines, redirection, command
substitution, pathspecs, alternate message sources, and additional options
are denied by the hook. Use the message file with Git's verbatim cleanup and
leave normal hooks enabled:

```text
git -C <worktree_path> commit --cleanup=verbatim --file=<exact-message-file>
```

Run the one direct commit invocation inside the Rule's `try/finally` lifecycle.
Its `finally` path performs the validated, non-recursive best-effort cleanup
after Git returns, including non-zero exit, timeout, or handled exception. A
cleanup failure is reported separately and must not replace the Git result. If
the commit command fails, do not retry with another message or bypass flag. No
commit SHA may be reported unless Git verifies that a new commit exists.

### 7. Verify the commit and final status

After a successful Git return, capture and verify the new commit:

```text
git -C <worktree_path> rev-parse --verify HEAD^{commit}
git -C <worktree_path> rev-parse --show-toplevel
git -C <worktree_path> branch --show-current
git -C <worktree_path> show --no-renames --format=fuller --name-only HEAD
git -C <worktree_path> diff-tree --root --no-commit-id --name-only --no-renames -r HEAD
git -C <worktree_path> show -s --format=%cI HEAD
git -C <worktree_path> show -s --format=%B HEAD
git -C <worktree_path> status --porcelain=v1 --untracked-files=all
```

Verify all of the following:

- `HEAD` resolves to a new commit after the pre-commit `HEAD` captured in step
  1 and the SHA is syntactically valid;
- the committed path set equals the approved union exactly;
- the commit message equals the approved subject/body composition;
- the repository root and checked-out branch still match the expected
  repository and branch;
- the final status is captured exactly and contains no unexpected scope;
- no push or pull-request operation occurred.

Set `status: created` only when the commit and every required verification
passes. Preserve the authorization evidence, set `commit.sha` to the verified
SHA, set `commit.created_at` to the verified ISO-8601 committer timestamp, and
set `commit.files_committed` to the verified repository-relative path list.

If a commit was created but a required verification fails, set `status:
partial`, preserve the verified SHA and exact available evidence, and report
the failed check. Do not amend, reset, or create a replacement commit.

## Failure semantics

Return `status: blocked` when no commit was created because input,
authorization, identity, approval, status, scope, index, hook, or Git
preconditions failed. Keep `commit.sha` null and
`commit.files_committed` empty unless Git independently verified otherwise.

Return `status: partial` only when Git created a commit but final verification
is incomplete or detects a mismatch. Never report `created` for an unverified
SHA, an unverified file set, an altered message, or a failed final status
check.

Do not repair a blocked or partial workspace. Explain the concrete evidence,
the exact completed effect, and the next diagnostic action without performing
that action automatically.

## Output contract

Return the version-1 `CommitProposal` with its original approved scope and
message preserved:

```yaml
schema: CommitProposal
version: 1
status: created
repository: owner/repository
branch: agent/example-task
base_sha: 0123456789abcdef0123456789abcdef01234567
files:
  added:
    - docs/example.md
  modified:
    - src/example.ts
  deleted: []
message:
  subject: "Document the example workflow"
  body: ""
rationale: >-
  Created from the exact approved scope after the immediate pre-commit status
  check and cached-index equality check.
validation:
  result_status: passed
  evidence:
    - git:status:pre-commit
    - git:index:cached-scope-equals-approved-scope
    - git:commit:verified
authorization:
  exact_scope_approved: true
  commit_authorized: true
  source: task_intent
  task_scope: "example/repository issue 42"
  evidence: "The current task authorization covers this exact commit scope."
commit:
  sha: 0123456789abcdef0123456789abcdef01234567
  created_at: "2026-08-07T13:00:00+00:00"
  files_committed:
    - docs/example.md
    - src/example.ts
```

Also return this concise completion report in the conversation language:

```markdown
## Commit
- SHA:
- Files:
- Final status:
- Push:
- Pull request:
```

`Push` and `Pull request` must always state `not performed`. Do not report a
commit, SHA, file list, or clean status without the corresponding Git output.
