---
name: mark-pr-ready
description: Mark exactly one open GitHub Draft pull request Ready-for-Review after independent authorization for that pull request, head SHA, unique linked issue, and optional confirmed reviewer set, then verify the non-Draft state. Use only when the user explicitly asks to mark a verified pull request ready or an applicable repository policy authorizes that exact Ready-for-Review transition.
disable-model-invocation: true
---

# Mark Pull Request Ready for Review

Mark exactly one GitHub pull request Ready-for-Review through the one canonical
`gh pr ready` operation and return a version-1
[`PullRequestReady`](../../shared/schemas/PullRequestReady.yaml) result.
Only after that transition is verified may this Skill request the exact
authorized reviewer set through one separate canonical `requested_reviewers`
`POST`. This Skill is explicitly invoked. Draft publication, review
publication, merge readiness, and routine delivery authorization never invoke
or authorize this Skill.

## Boundaries

- Operate on one exact, open Draft pull request with a unique linked issue.
- Require independent authorization for the exact repository, pull-request
  number and URL, expected head SHA, and reviewer `add` set. The authorization
  may be an explicit user approval or a clearly applicable target-repository
  `AGENTS.md` policy. Plan, commit, push, Draft PR, review, CI, or merge
  readiness never satisfies this gate.
- An empty authorized reviewer set is valid and must not request reviewers.
- An already non-Draft open pull request returns `already_ready` after identity
  verification and must not request additional reviewers.
- Ready-for-Review and reviewer assignment are separate external mutations with
  separate race and authorization boundaries; neither operation inherits
  authority from the other.
- Never use `gh pr edit`, `--reviewer` on `gh pr create`, auto-merge, merge,
  rebase, review publication, thread mutation, title or body edits, labels, or
  assignees.
- Pending or failed CI is a warning, never a Ready-for-Review blocker.
- Keep durable handoffs in English. Conversation summaries may use the
  conversation language.
- Never expose tokens, credentials, or raw sensitive logs.

## Input contract

Require one version-1 [`PullRequestReady`](../../shared/schemas/PullRequestReady.yaml)
handoff in `status: approved`, one version-1
[`LoadedPullRequest`](../../shared/schemas/LoadedPullRequest.yaml), and one
version-1 [`LinkedIssue`](../../shared/schemas/LinkedIssue.yaml) with a unique
linked issue.

Before any GitHub write, reject or return `blocked` when any of the following
is absent, malformed, stale, or inconsistent:

1. `repository` is an explicit `owner/repository`, and the pull-request number
   is positive. Canonical URL, base branch, head branch, and full expected head
   SHA are present.
2. `authorization.exact_target`, `authorization.exact_ready_operation`,
   `authorization.ready_authorized`, and `authorization.reviewers_authorized`
   are all `true`. Evidence covers the exact identity, head SHA, and reviewer
   `add` set, including when that set is empty.
3. `LinkedIssue.status` is `loaded` with exactly one unique linked issue whose
   repository and number match `linked_issue`. Mentioned-only or ambiguous
   candidates block.
4. The live pull request is open. If it is already non-Draft, return
   `already_ready` without writing. If it is not a Draft and not already ready
   in a verifiable way, block.
5. The live head SHA equals `expected_head_sha`.
6. The live URL, base branch, head branch, and exactly one linked issue match
   the gate immediately before each operation. Missing live evidence blocks.

Read the applicable repository instructions, especially the target
repository's `AGENTS.md`, before treating a repository-policy authorization as
covering this exact Ready-for-Review and reviewer set. Preserve the source path
and a concise quote or paraphrase in `authorization.evidence`. The policy
replaces the conversational gate only.

## Current-state preflight

Perform every check as close as possible to the write.

1. Confirm authentication without recording confidential output:

   ```text
   gh auth status
   ```

2. Load the exact live pull request:

   ```text
   gh pr view <number> --repo <owner>/<repo> --json number,url,title,isDraft,state,baseRefName,headRefName,headRefOid,reviewRequests
   ```

3. Confirm it is still the same open pull request and head SHA. Record
   `preflight` results. Unique-issue failure, closed state, unknown Draft
   status, or a changed head blocks.
4. If `isDraft` is `false` and the pull request is open, set
   `status: already_ready`, `draft_state.after: false`,
   `result.ready_attempted: false`, and do not request reviewers.

## Deterministic pre-ready gate

Immediately before `gh pr ready`, write a current local version-2
[`PrePrReadyGate`](../../shared/schemas/PrePrReadyGate.yaml) to
`.github/github-plugin/state/pre-pr-ready.json` through the shared
`plugin/hooks/lib/gate-state.mjs` writer. The snapshot must contain the exact
repository, pull request, expected head SHA, `is_draft: true`, unique linked
issue, authorized `reviewers.add` set, independent authorization flags, and a
fresh `GateLifecycle` authority with operation `pre-pr-ready`. The five-minute
TTL, maximum 60-second future skew, nonce, and non-overwriting atomic publish
are mandatory; the Hook claims the gate before semantic validation. Do not
stage or commit that ignored path.

The host `pre-pr-ready` Hook must fail closed unless the gate, live identity,
current Draft state, unique issue, command, and authorized reviewer set match.
Do not bypass the Hook.

## Ready write

Run only:

```text
gh pr ready <number> --repo <owner>/<repo>
```

The command must be one standalone operation with no URL target, `--undo`,
wrapper, extra flag, redirect, or shell separator. Do not add reviewers,
assignees, labels, or body flags. After the command, reload the pull request
and confirm `state: OPEN`, `isDraft: false`, the exact URL/branches, the same
head SHA, and exactly one matching linked issue.

## Optional reviewer requests

When `reviewers.add` is non-empty and the ready transition succeeded, request
only that exact set through this canonical GitHub requested-reviewers API
operation:

```text
gh api repos/<owner>/<repo>/pulls/<number>/requested_reviewers --method POST --input <payload-file>
```

The payload file must contain exactly two keys and no others:

```json
{
  "reviewers": ["user-login"],
  "team_reviewers": ["team-slug"]
}
```

Before this separate reviewer mutation, write a second version-2
`PrePrReadyGate` to the same canonical path with `is_draft: false`, a fresh
nonce, and lifecycle operation `pre-reviewer-request`. Never reuse the
`pre-pr-ready` authority for the reviewer POST. If the authorized reviewer set
is empty, do not write this second gate and do not issue a reviewer request.
The reviewer gate is independently claimed and consumed, so a failed POST or
process restart cannot replay it.

Gate entries with `kind: user` map to `reviewers`; entries with
`kind: team` use the `<organization>/<team-slug>` form and map only the slug
to `team_reviewers` after verifying that the organization matches the
repository. Arrays are compared as normalized, duplicate-free typed sets.
Do not use `gh pr edit`, a different HTTP method, a different endpoint,
additional API writes, `--field`, or a compound command. If the ready
transition succeeds and the reviewer request fails, return `status: partial`
with `failure.code: reviewer_request_failed` after recording that the pull
request is already non-Draft.

## Output

Return `ready` only after verification proves the open pull request is
non-Draft at the expected head SHA and the authorized reviewer set matches
(`not_requested` when `add` is empty). Return `already_ready` for an already
non-Draft open pull request. Return `blocked` or `partial` with a concrete
failure code instead of inventing success.
