---
name: apply-issue-priority-titles
description: Apply one confirmed OpenIssueRanking as unique P-number titles on the current open GitHub issues after exact-set authorization and a live identity check, delegating each title patch to update-github-issue. Use automatically after exact ranked-set approval; do not invent ranks, change bodies or labels, or roll back successful title writes.
---

# Apply Issue Priority Titles

Apply one confirmed version-1
[`OpenIssueRanking`](../../shared/schemas/OpenIssueRanking.yaml) to the live
open issues in that repository. Return a version-1
[`IssueReprioritization`](../../shared/schemas/IssueReprioritization.yaml)
result. Delegate each title write to
[`update-github-issue`](../update-github-issue/SKILL.md). Own the batch
preflight, exact-set authorization check, continuation after partial failure,
and verification.

Require a matching version-1
[`OpenIssueInventory`](../../shared/schemas/OpenIssueInventory.yaml) from the
same run or a fresh list used only for live-set comparison.

## Boundaries

- Match questions, explanations, and status updates to the conversation
  language.
- Keep GitHub titles and the persisted handoff in English unless the user
  explicitly overrides artifact language. Preserve exact remainder text.
- Require `OpenIssueRanking.status: ranked` with
  `authorization.ranking_confirmed`, `exact_payload`, and `exact_set` all
  true. Command invocation never satisfies those flags.
- Immediately before any write, re-list currently open issues and require the
  live issue-number set to equal `source.issue_numbers`. A changed set returns
  `blocked` with `failure.code: live_set_changed` and no write.
- Change only `title`. Never change body, labels, assignees, milestone, or
  state.
- Treat an already matching live title as `no_op` for that issue.
- Do not roll back a successful title write. Do not stop remaining updates
  after one failure.
- Apply [`issue-priority-title-policy.mdc`](../../rules/issue-priority-title-policy.mdc),
  [`github-safety.mdc`](../../rules/github-safety.mdc),
  [`interactive-approval.mdc`](../../rules/interactive-approval.mdc), and
  [`github-evidence.mdc`](../../rules/github-evidence.mdc).
- Never expose secrets, credentials, or unnecessary issue comments.

## Input contract

```yaml
open_issue_ranking:
  schema: OpenIssueRanking
  version: 1
  status: ranked
open_issue_inventory:
  schema: OpenIssueInventory
  version: 1
  status: loaded
```

Reject missing, malformed, or non-version-1 handoffs. Reject `recommended`,
`partial`, or `blocked` rankings. Reject truncated inventories.

## Workflow

### 1. Validate authorization and identity

Confirm the ranking repository matches the inventory repository. Confirm every
ranked issue number appears exactly once in the inventory and source set.
Confirm every `proposed_title` equals `P<confirmed_rank> ` plus
`remainder_title`. Confirm the three ranking authorization flags and set
`title_writes_authorized` from the same exact-set user or repository-policy
evidence.

### 2. Refresh the live open-issue set

Re-run the list command used by `list-open-issues` immediately before the
first write. Compare live open issue numbers with the approved set as sets.
Any added, missing, or extra issue is `live_set_changed`. Do not guess which
new issue should receive which rank.

### 3. Announce and apply

Announce that exact P-number titles will be written for the approved
repository and issue set. This is transparency, not a new approval prompt.

For each ranked issue, build one version-1 `IssueUpdate` whose `patch`
contains only `title` set to `proposed_title`. Hand that payload to
`update-github-issue`. Record `updated`, `no_op`, or `failed`. Continue the
remaining issues after a failure.

### 4. Choose status

- `applied` when every ranked issue is `updated` or `no_op`,
  `failed_operations` is empty, and `failure` is null.
- `no_op` when every issue was already at the approved title and no write
  occurred.
- `partial` when at least one external title write occurred and a later write
  or verification did not complete.
- `blocked` when no external write occurred.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | Ranking or inventory is absent. | `blocked` |
| `invalid_input` | Required fields are missing or invalid. | `blocked` |
| `unsupported_version` | A supplied handoff is not version 1. | `blocked` |
| `approval_missing` | Ranking confirmation or exact-set flags are false. | `blocked` |
| `ranking_unconfirmed` | Status is not `ranked`. | `blocked` |
| `identity_mismatch` | Repository or issue-number sets disagree. | `blocked` |
| `live_set_changed` | Live open issues no longer match the approved set. | `blocked` |
| `truncated_inventory` | The live list may be incomplete. | `blocked` |
| `update_failure` | An `update-github-issue` write failed. | `partial` if a prior write occurred |
| `verification_failure` | A live title does not match after a write. | `partial` |
