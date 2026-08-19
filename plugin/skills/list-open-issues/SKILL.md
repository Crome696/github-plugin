---
name: list-open-issues
description: Load every currently open GitHub issue in one repository into a version-1 OpenIssueInventory, excluding pull requests, preserving titles and parsed P-prefix evidence, and failing closed when the retrieved list is truncated. Use automatically before ranking or reprioritizing open issues; do not use to rank, update titles, load one issue, or change GitHub.
---

# List Open Issues

Load the current open-issue inventory for exactly one repository as a
read-only version-1
[`OpenIssueInventory`](../../shared/schemas/OpenIssueInventory.yaml) handoff.
Exclude pull requests. Preserve exact titles. Parse a leading P-number prefix
when present. Do not rank issues or write GitHub.

## Boundaries

- Match questions, explanations, and status updates to the conversation
  language.
- Keep the structured handoff in English.
- Require an explicit `owner/repository` or repository URL. Do not guess the
  repository from the current workspace, branch, or remote.
- Read GitHub only. Do not edit issues, comments, labels, assignees,
  milestones, pull requests, or repository settings.
- Do not invoke `rank-open-issues`, `apply-issue-priority-titles`,
  `update-github-issue`, or `load-github-issue` automatically.
- Apply [`github-evidence.mdc`](../../rules/github-evidence.mdc) and
  [`issue-priority-title-policy.mdc`](../../rules/issue-priority-title-policy.mdc).
- Never expose tokens, credentials, private keys, `.env` contents, or
  unnecessary command output.

## Input contract

Accept either:

```yaml
repository: owner/repository
```

or one GitHub repository URL from which exactly one `owner/repository` can be
parsed. If identity is missing or ambiguous, return `blocked` with
`failure.code: missing_identity`.

## Workflow

### 1. Authenticate without recording secrets

```text
gh auth status
```

Stop with `auth_unavailable` or `permission_denied` when authentication or
repository access cannot be verified.

### 2. List every currently open issue

Page until the result is complete. A safe equivalent is:

```text
gh issue list --repo <owner>/<repo> --state open --limit 1000 --json number,title,url,state,labels,updatedAt,createdAt
```

Exclude pull requests. `gh issue list` already excludes them; do not add
`gh pr list` results. If the page or limit may have truncated the set, return
`partial` or `blocked` with `truncated: true` and
`failure.code: truncated_inventory`. Never treat a truncated list as `loaded`.

### 3. Preserve titles and parse existing prefixes

For each issue, copy the exact GitHub title. Parse a leading prefix matching
`P<digits>`, `P<digits>:`, or `[P<digits>]`. Record `current_priority` when
that number is a positive integer; otherwise `null`. Set `remainder_title` to
the title after stripping that prefix and surrounding separators. If no prefix
exists, `remainder_title` equals `title`.

Do not translate, rewrite, or normalize remainder text beyond prefix stripping.

### 4. Return the inventory

Set `status: loaded` only when `truncated` is false, `failure` is null, and
every retrieved open issue is present. Preserve unavailable fields explicitly.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository identity is missing or ambiguous. | `blocked` |
| `auth_unavailable` | GitHub authentication cannot be verified. | `blocked` |
| `permission_denied` | The repository cannot be listed. | `blocked` |
| `truncated_inventory` | A page or limit may have omitted open issues. | `partial` or `blocked` |
| `api_failure` | The list command failed unexpectedly. | `blocked` |
| `invalid_input` | The supplied identity is malformed. | `blocked` |
