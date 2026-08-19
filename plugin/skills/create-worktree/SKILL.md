---
name: create-worktree
description: Create or explicitly reuse one authorized Git implementation worktree from a verified ImplementationPlan, ReviewFixPlan, or CiFixPlan and return BranchWorkspace creation evidence. Use explicitly when preparation owns workspace creation; never verify, repair, reset, clean, or remove a worktree.
disable-model-invocation: true
---

# Create Worktree

Create or explicitly reuse exactly one authorized implementation workspace
described by a version-1 `ImplementationPlan` or `ReviewFixPlan`. Return
one version-1 [`BranchWorkspace`](../../shared/schemas/BranchWorkspace.yaml)
with the observed creation or reuse result. Workspace verification remains the
separate responsibility of `verify-worktree`.

## Boundaries

- Read the supplied plan, repository metadata, filesystem metadata, and
  read-only Git metadata before the one authorized workspace operation.
- Create only the exact approved branch and absolute worktree path from the
  plan. Do not infer a base branch, branch name, path, repository, or remote.
- Reuse an existing branch or registered worktree only when the task-scoped
  authorization or an applicable repository policy identifies that exact
  repository, branch, path, base revision, and reuse operation.
- Never overwrite, reset, clean, switch, detach, remove, or silently replace an
  existing branch or worktree. Preserve an occupied or mismatched target as a
  structured failure.
- Do not edit source files, generate artifacts, install dependencies, run
  tests, commit, push, publish a pull request, resolve conflicts, or invoke
  `verify-worktree` automatically.
- Do not create or use the primary checkout as a dedicated worktree. A primary
  checkout fallback is valid only when its exact policy authorization is
  recorded as `authorized_branch_fallback`.
- Do not expose secrets, credential-bearing remote URLs, private keys, `.env`
  values, personal data, or unnecessary command output.
- Keep the structured handoff and authored report in English. Questions and
  explanations may use the conversation language.

## Required input

Require exactly one version-1 planning handoff:

- `ImplementationPlan` for creating or reusing the authorized implementation
  workspace; or
- `ReviewFixPlan` or `CiFixPlan` for attaching or reusing the existing
  pull-request head workspace. Its `pull_request`, `workspace`, `scope`, and
  `authorization` must identify the exact repository, head branch, worktree
  path, and task scope.

The selected handoff must provide:

1. A verified `repository` in `owner/repository` form.
2. A non-empty `workspace` containing the approved `base_branch`,
   `base_sha`, `branch_name`, absolute `worktree_path`, and
   `isolation_mode`.
3. A task-scoped routine authorization covering the exact repository, issue or
   pull request, branch, path, base revision, workspace operation, and
   isolation mode, unless an applicable repository policy explicitly supplies
   the authorization.
4. A valid `primary_checkout_untouched` expectation and any fallback evidence.

Before treating routine authorization as missing, read the applicable
repository instructions, especially the target repository's `AGENTS.md`. A
clear, scope-matched policy may supply the exact workspace, reuse, or fallback
authorization; record its source path and concise quote or paraphrase. If the
policy instead requires an interactive gate, wait once for that exact scope.
The policy does not replace repository identity, base-revision, safe-state, or
verification evidence.

Reject missing, malformed, conflicting, stale, unauthorized, or
cross-repository values with a `blocked` `BranchWorkspace`. Do not use the
current checkout or a branch name as a substitute for missing input.

## Preflight evidence

Before the write or reuse decision:

1. Confirm the plan and all authorization values refer to one repository and
   one exact workspace.
2. Normalize the absolute target path and ensure it is distinct from the
   primary checkout in dedicated mode.
3. Read the registered worktree list, branch refs, and target filesystem
   metadata. Record whether the branch and worktree existed before the
   operation.
4. Confirm the approved base revision resolves to one commit and is compatible
   with the requested branch creation.
5. Stop on an occupied path, existing branch, registered worktree, active Git
   operation, unmerged state, or identity mismatch unless exact reuse is
   authorized.

Use sanitized evidence references such as `handoff:ImplementationPlan.workspace`,
`git:worktree-list`, `git:show-ref`, `filesystem:<path>`, and
`authorization:<source>`. Preserve unavailable command results as failures,
never as passed checks.

## Authorized operation

Announce the exact effect immediately before the mutation:

> Create or reuse the authorized implementation worktree `<absolute path>` for
> `<repository>` on `<branch>` from `<base branch>@<base SHA>`; no files,
> commits, pushes, pull requests, or verification repairs will be performed.

For a new dedicated worktree, run only the bounded equivalent of:

```text
git worktree add -b <approved-branch> <approved-absolute-path> <approved-base>
```

For an explicitly authorized existing target, perform no creation write and
record the exact reuse evidence. Do not turn reuse into a claim that the
workspace is verified.

For `ReviewFixPlan` or `CiFixPlan` with `workspace.operation: attach_existing_branch`, the
existing pull-request head branch is the target. After verifying the exact
repository, branch, base, absolute path, and task-scoped authorization, use
only the bounded equivalent of:

```text
git worktree add <approved-absolute-path> <existing-pr-head-branch>
```

Do not use `-b`, create a replacement branch, detach the branch, or attach a
different head. This operation may be repeated only as explicitly authorized
reuse of the same registered worktree.

## Result and handoff

Return exactly one version-1 `BranchWorkspace`:

- `status: planned` after a successful create or authorized reuse, because
  downstream verification has not yet occurred;
- `status: partial` when the operation may have created the target but
  post-operation evidence is incomplete;
- `status: blocked` before a write for missing authorization, identity
  mismatch, occupied or unsafe targets, or invalid input.

Populate `branch_exists_before`, `worktree_exists_before`, `created_at`,
`current_head_sha`, `cleanup`, `evidence`, and `failure` only from observed
facts. A partial or blocked result must preserve the exact target and one
structured failure. Set `recommended_next_skill` to `verify-worktree` only
after the target creation or authorized reuse is observed; the recommendation
is advisory and does not invoke or authorize verification.

This Skill owns workspace creation or reuse only. `verify-worktree` owns the
read-only trust decision, and cleanup Skills own later removal.
