---
name: rank-open-issues
description: Rank one OpenIssueInventory into a unique consecutive P1-through-Pn OpenIssueRanking with recommended versus confirmed ranks and exact proposed titles. Use automatically after listing open issues or when a user asks to order the current open-issue set; do not write GitHub, invent remainders, or treat a recommendation as confirmation.
---

# Rank Open Issues

Rank every issue in one version-1
[`OpenIssueInventory`](../../shared/schemas/OpenIssueInventory.yaml) into a
unique consecutive `P1` through `Pn` version-1
[`OpenIssueRanking`](../../shared/schemas/OpenIssueRanking.yaml). Recommend an
order from evidenced titles, existing P-prefixes, and labels. Confirm the
exact total order with the user. Do not write GitHub.

`P1` is the highest priority. `n` equals the inventory length. Shared numbers
and gaps are forbidden.

## Boundaries

- Match questions and explanations to the conversation language.
- Keep the structured handoff and proposed titles in English unless the user
  explicitly overrides artifact language. Preserve exact remainder text.
- Require `OpenIssueInventory` version 1. Do not silently list issues or
  invoke `list-open-issues`.
- Do not edit GitHub, titles, bodies, labels, or state.
- Do not invent essential ranking decisions. A recommendation is not a
  confirmation.
- Do not reuse [`prioritize-product-issues`](../prioritize-product-issues/SKILL.md)
  or MoSCoW classes. That Skill ranks product sub-issue candidates of one
  parent.
- Apply [`issue-priority-title-policy.mdc`](../../rules/issue-priority-title-policy.mdc),
  [`product-interview-policy.mdc`](../../rules/product-interview-policy.mdc)
  for not inventing essential product order, and
  [`github-evidence.mdc`](../../rules/github-evidence.mdc).
- Ask at most one or two critical ranking questions per round after showing
  the recommended ordered list. The exact-set confirmation is the write gate
  owned by the caller; this Skill only records it.

## Input contract

```yaml
open_issue_inventory:
  schema: OpenIssueInventory
  version: 1
  status: loaded | partial
```

If the inventory is absent, malformed, or not version 1, return `blocked`.
If `status` is `blocked` or `truncated` is true, return `blocked` with
`failure.code: truncated_inventory` or `blocked_source`. Continue from
`partial` only when remaining gaps cannot change the open-issue set.

## Workflow

### 1. Copy the inventory identity

Copy the repository and the exact issue-number set into `source.issue_numbers`
without adding, dropping, or reordering identity.

### 2. Build remainder titles and proposed titles

For each issue, keep `remainder_title` from the inventory. If it is empty
after prefix stripping, return `blocked` with `empty_remainder` for that
issue. Proposed titles are exactly `P<rank> ` plus `remainder_title`.

### 3. Recommend, then confirm

Recommend a unique 1..n order from:

- existing `current_priority` as stale evidence, not as confirmation;
- issue titles and labels;
- user statements already evidenced in this run.

Show the recommended list in the conversation language. Wait for the user to
confirm or reorder the exact sequence. Set `confirmed_rank` only after that
decision or a matching repository-policy ranking that names the exact issue
set and order. Keep `authorization.ranking_confirmed`, `exact_payload`, and
`exact_set` false until every issue has a unique confirmed rank from 1
through n.

Command invocation never confirms the ranking.

### 4. Choose status

- `ranked` only when every inventory issue has one unique consecutive
  `confirmed_rank`, every `proposed_title` matches that rank, and the three
  authorization flags are true.
- `recommended` when a complete recommendation exists but confirmation does
  not.
- `partial` when some confirmations remain.
- `blocked` when the inventory cannot be ranked.

Do not invoke `apply-issue-priority-titles` automatically.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | No `OpenIssueInventory` is available. | `blocked` |
| `invalid_input` | Required fields are missing or invalid. | `blocked` |
| `unsupported_version` | The inventory is not version 1. | `blocked` |
| `blocked_source` | The inventory is `blocked`. | `blocked` |
| `truncated_inventory` | The inventory may omit open issues. | `blocked` |
| `incomplete_source` | A partial inventory cannot support a total order. | `partial` |
| `duplicate_rank` | Two issues would share a P-number. | `blocked` or `partial` |
| `non_consecutive_rank` | Confirmed ranks are not 1..n. | `blocked` or `partial` |
| `empty_remainder` | Stripping the prefix leaves no title text. | `blocked` |
| `ranking_unconfirmed` | The caller requested `ranked` without confirmation. | `recommended` or `partial` |
