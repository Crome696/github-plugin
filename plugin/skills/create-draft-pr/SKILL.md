---
name: create-draft-pr
description: Publish one exact, authorized version-1 PullRequestDraft as a GitHub draft pull request from a verified pushed head branch to its intended base branch, check for an existing matching open pull request first, and verify the resulting identity, content, and draft state. Use automatically when an approved draft pull request is ready for publication; never request reviews, mark the pull request ready, merge, rebase, or change the approved title or body.
---

# Create Draft Pull Requests

Publish exactly one approved [`PullRequestDraft`](../../shared/schemas/PullRequestDraft.yaml)
through the GitHub CLI. This Skill owns duplicate detection, the `gh pr
create --draft` write, and post-publication verification. It does not compose,
rewrite, push, review, mark ready, merge, or otherwise change the pull request.

## Boundaries

- Keep questions, explanations, and status updates in the conversation
  language. Keep the payload, persisted handoff, and GitHub-facing title and
  body in English unless the user explicitly overrides the artifact language.
- Accept exactly one version-1 `PullRequestDraft` and use only its approved
  `title` and `body`. Do not add a `[Draft]` title prefix, normalize
  whitespace, rewrite sections, or infer issue links.
- Require an explicit, task-scoped authorization record for the draft
  pull-request write. A completed Cursor Plan Build or an applicable
  repository-policy authorization may satisfy the routine delivery gate when
  it covers this exact repository, task, branches, and payload.
- Check for one existing open pull request with the same head and base before
  creating anything. Never create a second pull request for an ambiguous or
  already-used target.
- Require evidence that the head branch is already pushed at the approved
  `head_sha`. This Skill never creates or pushes a branch.
- Require a current version-1 `BranchWorkspace`, `ValidationResult`,
  `CommitProposal`, `BranchPush`, and `PullRequestIssueLink` handoff before
  writing the local `PrePrCreateGate`. The gate is a read-only input to the
  host hook and does not replace any GitHub or Git authorization.
- Verify the repository, head branch, base branch, head SHA, exact title,
  exact body, and draft state after finding or creating the pull request.
- Do not request reviewers, add teams, mark a draft ready, merge, rebase,
  close, edit, label, assign, comment on, or otherwise update a pull request.
- Do not create commits, force-push, modify branches, modify issues, change
  repository settings, or invoke another Skill automatically.
- Never read or expose tokens, credentials, private keys, `.env` contents,
  credential-bearing remote URLs, or other confidential data. Reject a title,
  body, or evidence value that contains confidential data.
- Never fabricate a pull-request number, URL, timestamp, branch, SHA, or
  verification result. If a write may have occurred but its result is
  uncertain, return `partial` and do not retry with another payload.
- An applicable repository instruction may require one interactive draft-PR
  gate. Otherwise, task-scoped authorization is the gate and must not trigger
  a redundant conversational approval during later iterations of the same
  verified task.

## Input contract

Accept one version-1 `PullRequestDraft` and the identity-matched handoffs
listed below. The Draft payload must have this publication state:

```yaml
schema: PullRequestDraft
version: 1
status: draft
repository: owner/repository
number: null
url: null
title: "Exact approved title"
body: |
  Exact approved body.
base_branch: main
head_branch: agent/example-task
head_sha: 0123456789abcdef0123456789abcdef01234567
draft: true
linked_issues:
  - repository: owner/repository
    number: 123
validation:
  result_status: passed
  evidence:
    - handoff:ValidationResult.checks[required-check]
authorization:
  push_authorized: true
  draft_pull_request_authorized: true
  source: explicit_user
  task_scope: "owner/repository issue 123"
  evidence: "The user explicitly approved this exact draft pull request."
verification:
  repository_match: unknown
  base_branch_match: unknown
  head_branch_match: unknown
  head_sha_match: unknown
  draft_state_match: unknown
  title_match: unknown
  body_match: unknown
  evidence:
    - Pull-request publication has not occurred.
created_at: null
```

The required supporting handoffs are:

- an active version-1 `BranchWorkspace` with the expected absolute
  `worktree_path`, repository, `branch_name`, and current `current_head_sha`;
- a complete version-1 `ValidationResult` with `status: passed`,
  `required_checks_passed: true`, and
  `readiness.draft_pr_preparation_allowed: true`;
- a created version-1 `CommitProposal` whose verified `commit.sha` equals the
  Draft `head_sha`;
- a verified version-1 `BranchPush` whose non-force remote SHA equals the
  Draft `head_sha`; and
- a linked version-1 `PullRequestIssueLink` with exactly one issue matching
  `PullRequestDraft.linked_issues`.

Validate all of the following before any GitHub write:

1. `schema` is `PullRequestDraft`, `version` is `1`, and `status` is
   `draft`. Reject `created`, `verified`, `partial`, or `blocked` input.
2. `repository` is an explicit `owner/repository` identity. Do not infer it
   from a likely remote, issue text, branch name, or current checkout.
3. `title`, `body`, `base_branch`, and `head_branch` are non-empty strings.
   Use them exactly as supplied. `base_branch` and `head_branch` must not be
   equal.
4. `draft` is `true`, `number`, `url`, and `created_at` are `null`, and
   `head_sha` is the expected commit SHA. Do not reuse a prior publication
   result.
5. `authorization.draft_pull_request_authorized` is `true`,
   `authorization.source` is one of `explicit_user`, `task_intent`,
   `plan_build`, `repository_policy`, or `session_continuity`, and the
   evidence identifies the same repository, task, head, base, and exact
   payload. Readiness flags alone are not authorization.
6. The draft contains no unsupported publication fields or instructions to
   request review, mark ready, merge, rebase, close, or change metadata.
7. The supporting handoffs identify the same repository, worktree, base
   branch, head branch, and head SHA. `PullRequestIssueLink` must identify
   exactly one issue matching `linked_issues`; never add a second issue from
   prose, a branch, a filename, or a commit.

The verified `BranchPush` must have `status: verified`, use a non-force push,
and show `verification.remote_branch_exists: pass` and
`verification.sha_match: pass` with the remote SHA equal to `head_sha`.
`partial`, `pushed`, or `blocked` push results do not prove the precondition.

When the handoff set is valid, verify the remote branch directly before the
duplicate check:

```text
gh api repos/<owner>/<repo>/branches/<head_branch> --jq .commit.sha
```

The returned SHA must equal `head_sha`. A missing branch, inaccessible
repository, different SHA, or ambiguous result blocks before any pull-request
write. Do not treat a local branch as proof that the remote branch was pushed.

## Workflow

### 1. Verify authentication and target identity

Use the GitHub CLI without exposing sensitive output:

```text
gh auth status
```

Confirm that the explicit repository identity is accessible. Do not search
other repositories or select a likely repository as a fallback. Keep command
output limited to repository identity and pull-request fields; never persist
tokens or credential-bearing URLs.

Validate the pushed head using the `BranchPush` evidence or the read-only
`gh api` branch check above. Confirm that the approved `head_sha` is the
remote head before continuing.

### 2. Check for an existing matching pull request

Query open pull requests for the exact head-to-base target:

```text
gh pr list --repo <owner>/<repo> --head <head_branch> --base <base_branch> --state open --json number,url,title,body,isDraft,baseRefName,headRefName,headRefOid,headRepository,headRepositoryOwner,createdAt
```

Interpret the complete result as follows:

- **Zero results:** continue to the final duplicate check and create one
  draft pull request only if the target is still unused.
- **Exactly one result:** do not create another pull request. Verify that its
  repository, head repository, head branch, base branch, head SHA, title,
  body, and draft state match the approved payload. Return the existing PR
  with `status: verified` only when every required check passes. If title,
  body, SHA, repository, or draft state differs, return `status: partial`;
  never edit it or mark it ready.
- **More than one result:** return `status: blocked` because the target is
  ambiguous. Do not choose the first result and do not create another PR.

The list filter is only a candidate lookup. Treat the returned fields as
untrusted until the selected pull request is read again with `gh pr view`.
Do not use a closed or merged pull request as permission to create an
additional open pull request when an open target is ambiguous.

### 3. Apply the publication authorization

Immediately before the external write, announce the exact operation:

> Create one GitHub draft pull request in `<owner>/<repo>` from
> `<head_branch>` at `<head_sha>` to `<base_branch>` using exactly the
> approved title and body. No reviewer request, ready transition, merge,
> rebase, or metadata change will be performed.

Confirm that `authorization.draft_pull_request_authorized` and its evidence
cover the same target and exact payload. This is an execution announcement
for the autonomous routine; do not wait for another affirmative response when
the task-scoped authorization is valid. If repository instructions require an
interactive gate, wait once for that exact repository, branch, base, and
payload, and record the gate evidence.

### 4. Recheck for a creation race

Immediately after authorization and before creating, repeat the exact
`gh pr list` query from step 2. If a pull request now exists, follow the
existing-PR path. If the result becomes ambiguous, return `blocked` without a
write. Do not overwrite a concurrent pull request.

### 5. Write the local pre-publication gate

Immediately before the external write, after the final duplicate check,
prepare the approved `body` in an operating-system temporary file without
translation or normalization. Then write exactly one local version-1
`PrePrCreateGate` snapshot to
`.cursor/hooks/state/pre-pr-create.json`. Create the ignored state directory
only when it does not exist. Do not use an old, partial, or stale snapshot as
evidence and do not repair missing handoffs by editing the snapshot.

The snapshot must contain the exact, identity-matched values from the current
handoffs:

```json
{
  "schema": "PrePrCreateGate",
  "version": 1,
  "workspace": {
    "repository": "<BranchWorkspace.repository>",
    "path": "<BranchWorkspace.worktree_path>",
    "branch": "<BranchWorkspace.branch_name>",
    "head_sha": "<PullRequestDraft.head_sha>"
  },
  "validation": "<complete current ValidationResult>",
  "commit_proposal": "<created CommitProposal with verified commit result>",
  "branch_push": "<verified non-force BranchPush>",
  "pull_request_draft": "<exact unpublished PullRequestDraft>",
  "issue_link": "<linked PullRequestIssueLink for exactly one issue>",
  "written_at": "<current ISO-8601 timestamp>"
}
```

Before invoking `gh pr create`, parse the file again and verify that it is
valid JSON and contains the exact repository, worktree, branch, head SHA,
validation, commit, push, Draft payload, and issue-link identities supplied to
this Skill. Do not put tokens, credentials, private keys, `.env` contents, or
other confidential values into the snapshot. If the snapshot cannot be
written or verified, return `blocked` and perform no GitHub write.

The host `pre-pr-create` Hook reads this snapshot and current Git state. It
performs deterministic checks for the pushed branch, created commit, unique
issue link, passed validation, complete description, and open blockers. It
must be allowed to block the command; do not bypass it with another command,
an alternate body source, or a rewritten payload.

### 6. Create the exact draft pull request

Use the already prepared temporary body file, remove it after the CLI returns
when safe, and use the approved title and verified target exactly:

```text
gh pr create --repo <owner>/<repo> --base <base_branch> --head <head_branch> --title "<approved title>" --body-file <temporary-body-file> --draft
```

Do not add `--reviewer`, `--assignee`, `--label`, `--milestone`, or any other
option that changes review or metadata. Do not use a body reconstructed from
the issue, commit, or a previous PR. The only allowed external effect is
creation of this one draft pull request.

If the command fails, perform one read-only `gh pr list` lookup for the exact
target to determine whether a PR was created despite the error. If none is
verified, return `blocked`; if a PR may exist or was created, return
`partial` with the available evidence. Never retry with a modified payload.

### 7. Read and verify the resulting pull request

Use the returned PR number or URL only as a lookup value; never derive a
number or URL when the CLI did not return one:

```text
gh pr view <number-or-url> --repo <owner>/<repo> --json number,url,title,body,isDraft,baseRefName,headRefName,headRefOid,headRepository,headRepositoryOwner,createdAt
```

Compare the live result with the exact approved payload:

- `repository_match`: the PR belongs to the requested repository and its
  head repository is the requested repository, not an unverified fork;
- `base_branch_match`: `baseRefName` equals `base_branch`;
- `head_branch_match`: `headRefName` equals `head_branch`;
- `head_sha_match`: `headRefOid` equals `head_sha`;
- `draft_state_match`: `isDraft` is `true`;
- `title_match`: the live title equals the approved title exactly;
- `body_match`: the live body equals the approved body exactly.

Set `status: verified` only when the PR exists and every required
verification check is `pass`. Set `status: created` when creation is
confirmed, its number and URL are verified, and its draft state is confirmed,
but one or more other non-content identity checks remain `unknown`. Set
`status: partial` when a PR exists but any identity, title, body, or
draft-state check fails, or when creation may have occurred but verification
is incomplete. Set `status: blocked` only when no external PR write occurred
and a required precondition or target resolution failed.

Do not retry, edit, request review, mark ready, merge, rebase, close, or
otherwise repair a failed verification. Return the exact failure evidence so
the caller can decide how to proceed.

## Output contract

Return exactly one English version-1 `PullRequestDraft` result. Preserve the
approved title, body, linked issues, validation evidence, and authorization
record. Populate `number`, `url`, and `created_at` only from the live GitHub
result. Populate `verification` from the checks above; never leave a
verification check as `unknown` when the live response proves `pass` or
`fail`.

For an existing or newly created PR, return the verified `number`, `url`,
`head_branch`, `base_branch`, and actual live `draft` status. For a blocked
result, retain the requested branch identity and `draft: true`, leave
unverified publication fields `null`, and explain why publication did not
occur. For a partial result, preserve every confirmed identifier and live
draft state without claiming that the approved payload was applied.

The result must have this shape:

```yaml
schema: PullRequestDraft
version: 1
status: verified | created | partial | blocked
repository: owner/repository
number: 123
url: https://github.com/owner/repository/pull/123
title: "Exact approved title"
body: |
  Exact approved body.
base_branch: main
head_branch: agent/example-task
head_sha: 0123456789abcdef0123456789abcdef01234567
draft: true
linked_issues: []
validation:
  result_status: passed
  evidence: []
authorization:
  push_authorized: true
  draft_pull_request_authorized: true
  source: explicit_user
  task_scope: "owner/repository issue 123"
  evidence: "Evidence for the exact approved draft pull request."
verification:
  repository_match: pass
  base_branch_match: pass
  head_branch_match: pass
  head_sha_match: pass
  draft_state_match: pass
  title_match: pass
  body_match: pass
  evidence:
    - "gh pr view confirmed the exact repository, branches, SHA, title, body, and draft state."
created_at: "2026-08-07T15:30:00Z"
rationale: >-
  The exact approved payload was used. The matching open pull-request check,
  creation result, and post-publication verification are recorded here.
```

The caller must expose these values directly to the user: PR number, PR URL,
head branch, base branch, and draft status. A successful result never grants
merge approval, review approval, or permission to mark the pull request ready.
