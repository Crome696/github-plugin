---
name: close-github-issue
description: Close exactly one verified GitHub issue without a merged pull request after independent authorization for that repository, issue, and close reason, then verify the live closed state. Use only when the user explicitly asks to triage-close a verified issue or an applicable repository policy authorizes that exact close.
disable-model-invocation: true
---

# Close GitHub Issue

Close exactly one GitHub issue through `gh issue close` without requiring a
merged pull request and return a version-1
[`IssueClosure`](../../shared/schemas/IssueClosure.yaml) result. This Skill is
explicitly invoked. Post-merge linked-issue closure remains
[close-linked-issue](../close-linked-issue/SKILL.md). Generic field updates
remain [update-github-issue](../update-github-issue/SKILL.md).

## Boundaries

- Operate on one exact, verified issue. Never search for a likely issue or
  infer identity from the current workspace, branch, remote, or issue text.
- Require independent authorization for the exact repository, issue number and
  URL, and close reason. The authorization may be an explicit user approval or
  a clearly applicable target-repository `AGENTS.md` policy. Merge approval,
  `LinkedIssueClosure`, implementation completeness, routine delivery, or a
  generic `IssueUpdate` state patch never satisfies this gate.
- Supported close reasons are `duplicate`, `not_planned`, and `not_delivered`.
  Map `not_planned` and `not_delivered` to GitHub `not planned`. Map
  `duplicate` to GitHub `duplicate`.
- A `duplicate` close requires one unique same-repository duplicate target
  that is not the selected issue. Missing, same-as-target, cross-repository,
  or ambiguous duplicate targets block without writing.
- A short English close comment is generated from the authorized reason and
  sent with the same `gh issue close` command. It is not a second GitHub
  write and is not separately authorized.
- Never close an already closed issue. Return `no-op` when the immediate
  preflight confirms that the issue is already closed.
- Never mutate issue title, body, labels, assignees, milestones, issue type,
  pull requests, reviews, threads, branches, Git state, local files, or
  worktrees.
- Never retry an ambiguous write, roll back a closure, or conceal partial
  verification. Never expose credentials, tokens, private keys, or sensitive
  logs.
- Keep the handoff and authored GitHub text in English.

## Required handoffs

Require all of the following before any write:

1. A version-1 `LoadedIssue` whose repository, number, and URL match the
   selected issue.
2. A version-1 `IssueClosure` handoff with `status: approved`,
   `authorization.exact_target: true`, `authorization.exact_close_operation:
   true`, `authorization.close_authorized: true`,
   `authorization.close_reason_authorized: true`, and an explicit
   authorization source covering the repository, issue, and close reason.

Reject missing, malformed, stale, cross-repository, or contradictory inputs
with `status: blocked`; do not search for a likely issue.

Before asking for close approval, read the applicable repository
instructions, especially the target repository's `AGENTS.md`. A policy may
replace the conversational gate only when it clearly names this repository,
the issue, the close operation, the close reason, and, for `duplicate`, the
duplicate target. Record its source path and concise quote or paraphrase in
`authorization.evidence`, use `authorization.source: repository_policy`, and
do not wait for another affirmative response.

## Close reason and comment

Require `close_reason` before any write:

| `close_reason` | GitHub `--reason` | Generated English comment |
| --- | --- | --- |
| `not_planned` | `not planned` | `Closed as not planned.` |
| `not_delivered` | `not planned` | `Closed as consciously not delivered.` |
| `duplicate` | `duplicate` | `Duplicate of <owner/repository>#<number>.` |

Use that generated comment as `comment`. Do not accept a free-form comment in
place of the authorized reason. Record `github_state_reason` as `not_planned`
or `duplicate` to match the GitHub reason.

## Immediate live preflight

Perform these reads as close as possible to the write and record repository,
identifiers, returned fields, and timestamps:

```text
gh auth status
gh issue view <issue-number> --repo <owner>/<repo> --json title,state,stateReason,number,url,updatedAt,closedAt
```

For `duplicate`, also load the duplicate target:

```text
gh issue view <duplicate-number> --repo <owner>/<repo> --json title,state,number,url
```

Require every preflight check to be `pass`:

- The issue identity matches the authorized repository, number, and URL.
- A close reason is present and is one of the three supported values.
- For `duplicate`, the duplicate target exists in the same repository, has a
  positive number, and is not the selected issue.
- Authorization still names that exact repository, issue, and reason.

If the issue is already closed, return `no-op` with fresh evidence and do not
attempt a write. If any state is changed, unknown, unavailable, or ambiguous,
return `blocked` with the narrowest failure code.

## Close authorization and announcement

Immediately before the write, state the exact effect:

> Close GitHub issue `<owner>/<repository>#<issue-number>` as
> `<close_reason>` without a merged pull request. Title, body, labels,
> assignees, milestones, and pull-request state will not change.

Do not infer authorization from any other workflow. Continue without another
chat prompt when exact user or repository-policy authorization is current and
matches the preflight target. Stop when exact authorization is absent, stale,
ambiguous, or does not match the preflight target.

## Close operation

Perform exactly one issue-state mutation:

```text
gh issue close <issue-number> --repo <owner>/<repository> --reason "<github-reason>" --comment "<generated-comment>"
```

Use `--reason "not planned"` or `--reason duplicate` according to the mapping
above. Do not add title, body, label, assignee, milestone, merge, or cleanup
options. If the command errors or has an ambiguous result, do not retry.
Reload the issue once:

- return `blocked` if it is still open and no closure occurred;
- return `partial` if it may be closed but identity or required verification
  is incomplete.

## Post-close verification

Reload the exact issue and verify:

1. repository, issue number, URL, and selected issue identity;
2. `state: CLOSED`;
3. `closedAt` and `stateReason` where GitHub exposes them;
4. issue fields outside the state transition, reason, and generated comment
   are unchanged.

Return `closed` only when all required checks pass.

## Result and failure semantics

- `closed`: issue closure was written and fully verified.
- `no-op`: immediate preflight proved the issue was already closed; this Skill
  performed no write.
- `blocked`: no write occurred because required identity, close reason,
  duplicate target, authorization, or preflight state was not valid.
- `partial`: a write may have occurred but closure verification is incomplete
  or contradictory.

Use these failure codes:

| Code | Meaning |
| --- | --- |
| `missing_input` | Required handoff or identity is absent or malformed. |
| `missing_close_reason` | The close reason is missing or is not one of the supported values. |
| `ambiguous_duplicate_target` | A duplicate close lacks a unique, same-repository, different-issue target. |
| `already_closed` | The target was already closed; use `no-op` without mutation. |
| `approval_missing` | Exact close authorization is absent. |
| `state_changed` | Immediate live state differs from the approved target. |
| `permission_denied` | GitHub rejected the authorized operation. |
| `api_failure` | A required read or write failed. |
| `verification_incomplete` | A write may have occurred but required verification is unavailable or contradictory. |

## Final checklist

- [ ] Exact issue identity is selected.
- [ ] Close reason is `duplicate`, `not_planned`, or `not_delivered`.
- [ ] Duplicate target is unique, same-repository, and not the selected issue.
- [ ] Exact close authorization covers the repository, issue, and reason.
- [ ] Issue state was refreshed immediately before writing.
- [ ] Already closed, missing reason, ambiguous duplicate, changed, or unknown
  states caused no close write.
- [ ] Exactly one `gh issue close` operation was attempted, with the mapped
  GitHub reason and generated English comment.
- [ ] Issue closure and preserved fields were verified.
- [ ] No unrelated GitHub, Git, or local mutation occurred.
