---
name: update-github-issue
description: Applies a validated partial update to one existing GitHub issue under task-scoped autonomous delivery authorization while preserving its identity, history, and unspecified metadata. Use automatically when a user asks to change selected issue fields; use create-github-issue for a full issue rewrite.
---

# Update GitHub Issues

Apply one validated patch to exactly one existing GitHub issue. Validate the
target and patch, read the live issue, show the final-value preview, apply only
the requested fields under the existing task-scoped delivery authorization,
and verify the result. Do not ask for a redundant update approval.

## Boundaries

- Match questions, explanations, and status updates to the conversation
  language.
- Keep the patch, preview, warnings, and persisted handoff in English unless
  the user explicitly overrides the artifact language.
- Preserve the issue number, repository, URL, comments, event history, and
  every field not present in the patch.
- Change only `title`, `body`, `labels`, `assignees`, `milestone`, or `state`.
  Do not create an issue, rewrite a second issue, modify comments, projects,
  issue type, repository settings, pull requests, or unrelated metadata.
- Do not use this Skill for triage close without a merged pull request with a
  duplicate, not-planned, or not-delivered reason; hand that work to
  [close-github-issue](../close-github-issue/SKILL.md).
- Do not use [load-github-issue](../load-github-issue/SKILL.md) as a write
  operation. Its snapshot may provide context, but this Skill must re-read the
  exact target immediately before updating it.
- Never read or expose tokens, credentials, private keys, `.env` contents, or
  unnecessary issue comments.
- A repository instruction may explicitly require one interactive update gate
  for its scope. The autonomous routine does not repeat that gate during later
  iterations of the same issue/task.

## Input contract

Accept one version-1 `IssueUpdate` payload:

```yaml
status: approved
issue:
  repository: owner/repository
  number: 123
  url: https://github.com/owner/repository/issues/123
patch:
  title: "Approved title"
  labels:
    add: ["bug"]
    remove: []
  assignees:
    add: ["octocat"]
    remove: []
    set: null
approval:
  exact_payload: true
  update_authorized: true
  source: task_intent
  task_scope: "owner/repository issue 123"
```

The input may identify the issue with `repository` plus a positive `number`, or
with one issue URL. Normalize the identity and verify that all supplied
identity fields describe the same issue. Never guess a repository or issue
number from the current workspace, branch, remote, or issue text.

`patch` must contain at least one supported field. An absent field means
preserve the current value. A present `body` may be an empty string to clear
the body; a present `milestone: null` clears the milestone; `state` accepts
`open` or `closed`. For `labels`, use only `add` and `remove`. For
`assignees`, use either `add`/`remove` delta operations or a non-null `set`,
never both. Lists must not contain duplicates, and add/remove lists must not
overlap.

The payload must have `status: approved`, `approval.exact_payload: true`, and
`approval.update_authorized: true`. `approval.source` must identify a
task-scoped delivery authorization, explicit user authorization, or applicable
repository-policy evidence. These approvals must cover the exact repository,
issue number, and patch values; an approved summary or direction is
insufficient.

## Workflow

### 1. Validate identity, authorization, and patch

Validate the repository format, positive issue number, URL consistency,
supported patch keys, field types, list uniqueness, and approval flags before
any write. Reject an empty patch and unsupported fields. Check authentication
without copying sensitive output:

```text
gh auth status
```

Read only the selected issue:

```text
gh issue view <number> --repo <owner>/<repo> --json title,body,state,labels,assignees,milestone,number,url,updatedAt
```

Treat the returned issue as the source of truth. Stop if the issue is missing,
inaccessible, or belongs to a different repository or number. Require
`updatedAt`; a missing concurrency baseline is a validation failure.

### 2. Compute and show the preview

Derive the final value for every requested field from the live baseline:

- `title` and `body` become the exact supplied values.
- Labels become current labels plus `add` minus `remove`.
- Assignee deltas become current assignees plus `add` minus `remove`;
  `set` becomes the exact requested login list.
- `milestone` becomes the supplied title or is cleared when it is `null`.
- `state` becomes `open` or `closed`.

Before applying the write authorization, show a concise preview containing only
the requested fields, with `before` and `after` values. Also list the fields
that will be preserved. Do not show unrelated comments or metadata. If every
requested value already equals the live value, return a completed no-op with a
warning and do not perform a write.

### 3. Apply the task-scoped delivery authorization

Immediately before the external operation, state:

> Update issue `<number>` in `<owner>/<repo>` with the approved patch. Only
> `<changed fields>` will change; all other issue metadata and history will be
> preserved.

Confirm that the delivery authorization record covers the same repository,
issue, patch, and task scope. State **Updating an existing issue** and
continue without waiting for another affirmative response. Record the source
and task scope in `approval`.

If applicable repository instructions explicitly require the independent
**Updating an existing issue** gate, wait once for that exact target and patch
and set `approval.interactive_gate: true` with its evidence. Otherwise set
`approval.interactive_gate: true` because the autonomous routine authorization
has been validated; it records that the write gate was satisfied, not that a
new chat prompt was shown.

### 4. Refresh the concurrency baseline

Immediately after the authorization/preview phase and before writing, re-run
the
the exact `gh issue view` command. Compare its `updatedAt`, number, URL, and
repository identity with the baseline used for the preview. If any differs,
stop with `edit_conflict`; show a new preview only after reloading and
revalidating the same task authorization (and any policy gate that explicitly
requires a new approval). Never overwrite a concurrent change.

This timestamp check is the available CLI conflict guard, not an atomic
transaction. If another change lands between the final read and a write,
verify the result and report any incomplete or conflicting effect as
`partial`; do not retry with a different payload.

### 5. Apply only requested fields

Apply the shared [`cli-transport-file-lifecycle` Rule](../../rules/cli-transport-file-lifecycle.mdc)
when using the GitHub CLI and an operating-system temporary file for an exact
multiline body. The approved bytes and one direct edit operation belong to one
`try/finally` lifecycle; cleanup is guaranteed for success and every handled
failure. Do not place secrets in it.

For non-state fields, run the equivalent of one edit operation containing only
the requested flags:

```text
gh issue edit <number> --repo <owner>/<repo> \
  [--title "<title>"] [--body-file <body-file>] \
  [--add-label "<label>"] [--remove-label "<label>"] \
  [--add-assignee "<login>"] [--remove-assignee "<login>"] \
  [--milestone "<milestone>"] [--remove-milestone]
```

Repeat flags only for approved values. For an explicit assignee `set`, remove
current logins not in the requested set and add requested logins not already
assigned. For `milestone: null`, pass `--remove-milestone`; if the installed
CLI cannot represent it safely, stop with `api_failure` rather than changing
another field.

For a requested state transition, use only the matching operation:

```text
gh issue close <number> --repo <owner>/<repo>
gh issue reopen <number> --repo <owner>/<repo>
```

Do not pass state or unrelated metadata flags to `gh issue edit`. Do not retry
the payload write inside this lifecycle; report a transient CLI failure after
the shared cleanup completes. Stop on authentication, permission, validation,
policy, or conflict errors. Cleanup diagnostics are separate and sanitized.

### 6. Verify and summarize

After every external write, fetch the exact issue again:

```text
gh issue view <number> --repo <owner>/<repo> --json title,body,state,labels,assignees,milestone,number,url,updatedAt
```

Verify the repository, number, and URL; every requested final value; every
preserved field; and the absence of an unintended state or metadata change.
Use `completed` only when all requested and preservation checks pass. Use
`partial` when any external write occurred but a later operation or
verification failed. Use `blocked` when no external write occurred.

Return the version-1 `IssueUpdate` summary with:

- final status and exact target;
- a preview of requested before/after values;
- `applied_changes` with only actual external effects;
- `preserved_fields`;
- warnings and retry/conflict information;
- verification checks with evidence;
- the failure code and phase when blocked or partial.

## Failure modes

Use these stable failure codes:

| Code | Meaning | Result |
| --- | --- | --- |
| `missing_identity` | Repository, issue number, or URL is missing or ambiguous. | `blocked` |
| `issue_not_found` | The exact issue cannot be read. | `blocked` |
| `auth_unavailable` | GitHub authentication is unavailable. | `blocked` |
| `permission_denied` | GitHub rejected the requested update. | `blocked` or `partial` |
| `validation_failed` | The identity, types, patch, or baseline is invalid. | `blocked` |
| `empty_patch` | No supported field was supplied. | `blocked` |
| `approval_missing` | Exact payload or update authorization is absent. | `blocked` |
| `delivery_authorization_missing` | The task-scoped routine authorization or required policy gate was not satisfied. | `blocked` |
| `edit_conflict` | The live target changed after the preview baseline. | `blocked` |
| `api_failure` | A CLI/API operation or verification failed after validation. | `blocked` or `partial` |

Do not claim that an issue was updated without write and verification evidence.
If a write occurred before a later failure, report the exact effects and stop;
never silently roll back or overwrite the issue.

## Completion report

Return this English structured summary:

```markdown
## Status
completed | partial | blocked

## Target
- Repository:
- Issue URL:
- Issue number:
- Operation: updated | no_op | partial | not_started
- External effects:

## Preview
- Field: before -> after
- Preserved fields:

## Applied changes
- Field: exact applied value or effect

## Approval
- Exact payload approved:
- Update authorized:
- Interactive gate: not required for autonomous routine delivery, or the
  exact policy/user gate evidence
- Delivery authorization source and task scope:
- Evidence:

## Verification
- [PASS|FAIL|SKIPPED] Target identity — evidence
- [PASS|FAIL|SKIPPED] Requested fields — evidence
- [PASS|FAIL|SKIPPED] Preserved fields — evidence
- [PASS|FAIL|SKIPPED] State and metadata — evidence

## Warnings
- None, or the exact warning.

## Failure
- None, or code, phase, message, and whether any external write occurred.
```

## Example

Input:

```yaml
status: approved
issue:
  repository: octo-org/octo-repo
  number: 42
  url: https://github.com/octo-org/octo-repo/issues/42
patch:
  title: "Document the release rollback path"
  labels:
    add: ["documentation"]
    remove: []
  assignees:
    add: ["octocat"]
    remove: []
    set: null
approval:
  exact_payload: true
  update_authorized: true
  source: task_intent
  task_scope: "octo-org/octo-repo issue 42"
```

After reading issue 42, show the exact title, label, and assignee
before/after values, list body, milestone, and state as preserved, apply the
task-scoped authorization, update only those three fields, and verify them with
`gh issue view`. Report the issue URL, actual effects,
preserved fields, and verification evidence in the completion report.
