---
name: push-branch
description: Push a verified prepared Git branch to its explicitly selected remote under task-scoped autonomous delivery authorization, inspect branch, remote, upstream, and local status, verify the remote head, and prevent force-pushes unless separately authorized by the user or a matching target-repository AGENTS.md policy. Use automatically when a validated branch push is ready; never create a pull request.
---

# Push Branch

Push exactly one prepared branch from a trusted workspace to one verified
remote. This Skill owns the non-force default, push execution, and post-push
verification. Routine non-force delivery uses the task-scoped authorization
record and does not ask for a redundant chat gate. It does not create commits,
modify worktrees, or create pull requests. Return exactly one version-1
[`BranchPush`](../../shared/schemas/BranchPush.yaml) handoff.

## Boundaries

- Accept only one version-1 [`BranchWorkspace`](../../shared/schemas/BranchWorkspace.yaml)
  with `status: active`, a non-null `current_head_sha`, `failure: null`, and
  an explicitly identified repository, branch, and absolute worktree path.
- Verify the expected repository, checked-out branch, current `HEAD`, selected
  remote, upstream relationship, remote branch, and local status before any
  push command.
- Use the recorded `BranchWorkspace.branch_name`; never silently substitute a
  branch, worktree, repository, remote, or remote branch.
- Never use `--force`, `--force-with-lease`, `--force-if-includes`, or an
  equivalent option for a normal push.
- Use `--force-with-lease=<remote-ref>:<observed-remote-sha>` only when the
  request explicitly asks for force, `authorization.force_push_authorized` is
  true, and the authorization evidence covers that exact force operation. The
  authorization may be an explicit user approval or a clearly applicable
  target-repository `AGENTS.md` policy that names the exact repository, remote,
  branch, and force-with-lease effect. The observed remote SHA remains
  mandatory live evidence; an unbounded force option is never allowed.
- Do not create or amend commits, stage files, reset, restore, clean, checkout,
  switch, rebase, merge, cherry-pick, delete branches, add or remove
  worktrees, fetch, or repair Git state.
- Do not invoke another Skill automatically. A recommended next Skill is
  advisory only and never grants authorization.
- Do not run `gh pr create` or any other pull-request operation. This Skill
  returns before pull-request creation.
- Never record credential-bearing remote URLs, tokens, private keys, `.env`
  contents, or other confidential data. Sanitize remote evidence to the
  repository identity and a credential-free URL.
- Keep the structured handoff and durable report text in English. Keep
  questions and explanations in the user's conversation language.
- A repository instruction may explicitly require one interactive non-force
  push gate for its scope. Force-push authorization is always independent of
  routine delivery authorization, but a clearly scoped target-repository
  `AGENTS.md` policy may supply that separate force authorization.

## Input

Accept one operation request containing:

```yaml
schema: BranchWorkspace
version: 1
status: active
repository: owner/repository
base_branch: main
base_sha: 0123456789abcdef0123456789abcdef01234567
branch_name: agent/example-task
worktree_path: C:/absolute/path/to/worktree
current_head_sha: fedcba9876543210fedcba9876543210fedcba98
failure: null
```

The caller may additionally provide:

```yaml
remote_name: origin
remote_branch: agent/example-task
request_force: false
authorization:
  push_authorized: true
  force_push_authorized: false
  evidence: "The current task authorization covers this exact non-force push."
  source: task_intent
```

`remote_name` must come from verified repository or `RepositoryContext`
evidence. If it is omitted, use the verified default remote from that
context; do not guess `origin` from convention alone. `remote_branch` defaults
to the recorded local branch only when no conflicting upstream target exists.
If the upstream points to a different remote or branch, require an explicit
remote target rather than silently following it.

Reject the input before any write when:

- the handoff is not version 1, is not `active`, has a non-null `failure`, or
  lacks the required repository, branch, worktree, or head identity;
- the path is not an existing worktree of the expected repository, the branch
  is detached or different, or `HEAD` does not equal `current_head_sha`;
- the selected remote is missing, its push URL does not identify the expected
  repository, or the target remote branch is ambiguous;
- the index contains unmerged entries or Git reports an in-progress merge,
  rebase, cherry-pick, revert, or bisect;
- `authorization.push_authorized` is false or lacks task-scoped delivery
  evidence, explicit user evidence, or exact repository-policy evidence;
- the remote branch has diverged and the request does not contain separate
  force authorization for the exact target;
- the request asks for force but does not contain both
  `request_force: true` and `authorization.force_push_authorized: true`.

A dirty working tree is recorded in `local.dirty` and reported because
uncommitted files are not included in a branch push. It is not itself a reason
to claim that the pushed `HEAD` is dirty or to push those files. Unmerged
entries and in-progress Git operations always block.

## Autonomous non-force delivery

Inspect all read-only identity and divergence evidence first. Immediately
before a push command, state the exact operation:

> Push local branch `<branch_name>` from `<worktree_path>` in
> `<owner/repository>` to remote `<remote_name>` branch
> `<remote_branch>`. Use `<set-upstream or no set-upstream>` and
> `<normal push or force-with-lease using the observed remote SHA>`. No pull
> request will be created.

For a normal non-force push, this statement is an execution announcement. Do
not wait for another affirmative response when the delivery authorization
covers the same repository, task, branch, remote, worktree, and target scope.
Record the authorization source and evidence in the handoff.

If applicable repository instructions explicitly require an interactive
non-force push gate, wait once for that exact scope and record the approval.
A completed Cursor Plan Build or task intent establishes routine continuity but
never authorizes force. Before requiring force authorization, read the target
repository's `AGENTS.md`. If it clearly authorizes the exact force-with-lease
operation, record its source path and concise quote or paraphrase in
`authorization.evidence`, set `authorization.source: repository_policy`, and
do not wait for a chat approval. Otherwise require explicit user approval for
the exact remote branch and force effect.

## Workflow

### 1. Validate workspace identity

Validate the incoming `BranchWorkspace` and read the applicable repository
instructions before applying approval or workspace-policy overrides. In the
expected worktree, run read-only checks equivalent to:

```text
git -C <worktree_path> rev-parse --show-toplevel
git -C <worktree_path> branch --show-current
git -C <worktree_path> rev-parse --verify HEAD^{commit}
git -C <worktree_path> status --porcelain=v1 --untracked-files=all
git -C <worktree_path> ls-files -u
git -C <worktree_path> worktree list --porcelain
```

The resolved repository root must be the expected worktree, the branch must
equal `branch_name`, and `HEAD` must equal the recorded
`current_head_sha`. Confirm that the path is registered to this repository.
Do not use the primary checkout, another worktree, or a similarly named
branch as a fallback.

Detect in-progress operations from Git administrative metadata, including
merge, rebase, cherry-pick, revert, and bisect state. Do not repair an unsafe
workspace. Capture the complete local status, including staged, unstaged,
deleted, renamed, and untracked paths, without exposing their contents.

### 2. Verify remote and upstream

Resolve the selected push remote without refreshing remote-tracking state:

```text
git -C <worktree_path> remote get-url --push <remote_name>
git -C <worktree_path> rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git -C <worktree_path> rev-list --left-right --count <upstream>...HEAD
git -C <worktree_path> ls-remote --heads <remote_name> refs/heads/<remote_branch>
```

Use the remote push URL only to verify the expected `owner/repository`
identity. Record a credential-free sanitized URL. Treat an unavailable
upstream as `exists: false`, not as evidence for a guessed remote.

Record ahead and behind counts with their meanings: the upstream-only count
is `behind`, and the local-only count is `ahead`. The target remote ref is
`refs/heads/<remote_branch>`. If the upstream and requested target disagree,
either use the explicitly requested target or block with
`upstream_mismatch`; never silently push to the configured upstream.

### 3. Decide whether force would be required

Compare the observed remote branch SHA with the local `HEAD`:

- If the remote branch is absent, a normal push is sufficient.
- If the remote SHA equals local `HEAD`, no push command is necessary; report
  `up_to_date` after verification.
- If the remote SHA is an ancestor of local `HEAD`, use a normal fast-forward
  push.
- If the remote branch has diverged or contains commits not reachable from
  local `HEAD`, stop before writing unless the exact force operation is
  separately authorized.

Without that separate authorization, return `status: blocked`,
`push.result: not_run`, and failure code `force_push_required` or
`force_push_denied`. Never turn a normal approval into force authorization.

### 4. Execute the approved push

After the gate is satisfied, use an explicit refspec so the target is
unambiguous:

```text
git -C <worktree_path> push --set-upstream <remote_name> <branch_name>:<remote_branch>
```

Use `--set-upstream` only when the verified target should become the local
upstream. Otherwise use the same refspec without that flag. For a separately
authorized divergent update, require the observed remote SHA and use:

```text
git -C <worktree_path> push --force-with-lease=<remote_ref>:<observed_remote_sha> <remote_name> <branch_name>:<remote_branch>
```

Never use `--force` or a force-with-lease form without an expected remote SHA.
Do not retry a rejected push with a stronger option. Preserve the command
result and sanitized error evidence.

### 5. Verify the result

After a successful push or an up-to-date preflight, verify all applicable
facts:

```text
git -C <worktree_path> ls-remote --heads <remote_name> refs/heads/<remote_branch>
git -C <worktree_path> rev-parse --verify HEAD^{commit}
git -C <worktree_path> rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git -C <worktree_path> status --porcelain=v1 --untracked-files=all
```

The remote SHA must equal the verified local `HEAD`, the remote branch must
exist, and any requested upstream configuration must match the selected
remote and branch. A push command can return success while verification
remains incomplete; return `status: partial` in that case and preserve the
observed effect. Return `status: verified` only when the required repository,
branch, remote, SHA, and upstream checks pass.

### 6. Return the handoff

Return exactly one version-1 `BranchPush`. Include the sanitized remote
identity, remote branch, push result, force state, local status, authorization
evidence, and verification evidence. Set `recommended_next_skill` only as an
advisory value; it never invokes or authorizes pull-request creation.

## Failure semantics

Return `status: blocked` when no push was performed because input, identity,
remote, upstream, local-state, authorization, divergence, or preflight
validation failed. Keep `push.attempted: false`, `push.result: not_run`, and
remote SHA fields null unless Git independently supplied them.

Return `status: partial` when a push command may have changed the remote but a
required verification failed, timed out, or returned contradictory evidence.
Preserve the exact available remote ref and SHA; do not retry, force, reset, or
clean up automatically.

Return `status: verified` only after the remote branch is confirmed at the
expected local head SHA, including an already `up_to_date` branch. `status:
pushed` may represent a successful push before a separate verifier consumes the
handoff; this Skill should return `verified` or `partial` after its own
verification step.

## Output contract

```yaml
schema: BranchPush
version: 1
status: verified
repository: owner/repository
branch_name: agent/example-task
worktree_path: C:/absolute/path/to/worktree
remote:
  name: origin
  owner_repository: owner/repository
  url_sanitized: https://github.com/owner/repository.git
  ref: refs/heads/agent/example-task
upstream:
  exists: true
  ref: origin/agent/example-task
  ahead: 0
  behind: 0
  evidence:
    - git:upstream:verified
local:
  head_sha: fedcba9876543210fedcba9876543210fedcba98
  branch_match: true
  detached: false
  in_progress_operation: null
  dirty: false
  worktree_registered: true
  evidence:
    - git:branch:verified
    - git:status:captured
push:
  attempted: true
  forced: false
  force_mode: none
  set_upstream: false
  remote_ref: refs/heads/agent/example-task
  remote_sha: fedcba9876543210fedcba9876543210fedcba98
  result: success
  completed_at: "2026-08-07T14:00:00+00:00"
  evidence:
    - git:push:success
authorization:
  push_authorized: true
  force_push_authorized: false
  evidence: "The current task authorization covers this exact non-force push."
  source: task_intent
  task_scope: "owner/repository issue 42"
verification:
  repository_match: pass
  branch_match: pass
  remote_branch_exists: pass
  sha_match: pass
  upstream_configured: pass
  evidence:
    - git:ls-remote:sha-matches-head
failure: null
recommended_next_skill: null
```

Also return this concise completion report in the conversation language:

```markdown
## Branch push
- Remote branch:
- Push result:
- Local head:
- Force-push:
- Pull request: not performed
```

Do not report a remote branch, SHA, upstream, or success state without the
corresponding Git evidence.
