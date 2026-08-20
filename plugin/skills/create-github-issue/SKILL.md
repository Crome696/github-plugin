---
name: create-github-issue
description: Publish one validated GitHub IssueDraft as a new issue or apply a validated rewrite to one existing issue under task-scoped authorization, including exact labels and verification. Use automatically for an authorized issue write; use compose-product-sub-issues for draft-only composition without publishing.
---

# Publish GitHub Issue Drafts

Publish exactly one validated version-2 `IssueDraft` through the GitHub CLI. Use create
mode for a new issue and edit mode for one verified existing issue. This Skill
publishes an exact payload that was already drafted and validated; it does not
interview, rewrite, or invent issue content.

`issue-agent` maps its `create` mode to publication `mode: create` and its
`refine` mode to publication `mode: edit`; this Skill remains the owner of the
mode-specific GitHub write and post-publication verification. Routine
publication uses the task-scoped delivery authorization and does not ask a
second conversational gate.

## Boundaries

- Match questions, explanations, and status updates to the conversation
  language.
- Keep the GitHub title, body, labels, and persisted handoff fields in English
  unless the user explicitly overrides the artifact language.
- Require `approval.exact_payload: true` and
  `approval.publication_authorized: true` from the task-scoped delivery
  authorization, explicit user authorization, or applicable repository-policy
  evidence.
- State `Publishing an issue` for create mode or `Overwriting an existing
  issue` for edit mode immediately before the external write. This is an
  execution announcement for the autonomous routine and not a new approval
  prompt. A repository instruction may explicitly re-enable one interactive
  gate; wait once for that exact scope and record the evidence.
- Apply only the approved title, body, and label operations. Preserve every
  label not explicitly approved for removal.
- Do not consume or publish a `ProductSubIssueDrafts` set. That handoff is
  draft-only; this Skill publishes exactly one version-2 `IssueDraft`.
- Use [update-github-issue](../update-github-issue/SKILL.md) for partial
  updates to selected issue fields; this Skill owns new issues and full
  approved title/body rewrites.
- Do not change issue state, assignees, milestones, projects, issue type,
  comments, repository settings, or unrelated metadata.
- Never read or expose secrets, credentials, private keys, `.env` contents, or
  unnecessary issue comments.

## Input contract

Validate the incoming `IssueDraft` before any write:

```yaml
status: approved
mode: create | edit
issue:
  repository: owner/repository
  number: null | 123
  url: null | https://github.com/owner/repository/issues/123
title: "Exact approved title"
body: "Exact approved body"
labels:
  add: []
  remove: []
  preserve: []
approval:
  exact_payload: true
  publication_authorized: true
  source: task_intent
  task_scope: "owner/repository issue 42"
```

The repository must be verified from an explicit `owner/repository`, an issue
URL, or an unambiguous current Git remote. Do not search for a likely
repository or issue.

- In `create` mode, `issue.number` and `issue.url` are `null` before the
  operation. `labels.remove` must be empty and `labels.preserve` must be
  empty because there is no existing issue metadata to preserve.
- In `edit` mode, `issue.number` and `issue.url` are required and must identify
  the same repository. Read the live issue before publication and use its
  current labels and state as the preservation baseline.
- In edit mode, `labels.remove` must be a subset of the live labels and
  `labels.preserve` must contain every live label not explicitly removed. Stop
  if the live labels do not match the approved preservation baseline.
- `title`, `body`, and every label operation must be the exact values shown for
  approval. An approved summary, direction, or earlier draft is insufficient.
- Reject `draft`, `partial`, or `blocked` input, missing approval flags, missing
  label arrays, unsupported metadata, or a mode/target mismatch.

## Workflow

### 1. Validate the target and payload

Confirm the repository, mode, exact title, body, labels, approval flags, and
publication authorization. In edit mode, read exactly the selected issue:

```text
gh issue view <number> --repo <owner>/<repo> --json title,body,labels,state,url
```

Stop if the issue cannot be read, the repository or issue URL does not match,
the issue is not the approved target, or authentication and authorization are
unavailable. Do not use another issue as a fallback.

### 2. Apply the task-scoped delivery authorization

Immediately before the write, state the exact target and external effect:

- **Create:** publish one new issue in `<owner>/<repo>` using the validated
  title, body, and label additions.
- **Edit:** overwrite issue `<number>` in `<owner>/<repo>` using the validated
  title, body, and explicitly approved label additions or removals; keep its
  current state unchanged.

Confirm that the delivery authorization record covers the same repository,
issue/task, exact payload, and operation. State the operation and continue
without waiting for another affirmative response. Do not proceed when that
record is missing, ambiguous, or belongs to a different issue.

If applicable repository instructions explicitly require an interactive
publication gate, wait once for that exact operation and scope and record the
source path or approval evidence. Do not ask again during later iterations of
the same issue/task.

### 3. Publish the approved payload

Apply the shared [`cli-transport-file-lifecycle` Rule](../../rules/cli-transport-file-lifecycle.mdc)
to one temporary operating-system file for the exact multiline body. The
approved bytes and exactly one direct create or edit CLI operation belong to
one `try/finally` lifecycle; cleanup is guaranteed for success and every
handled failure. Never place secrets in the file.

For create mode, run the equivalent of:

```text
gh issue create --repo <owner>/<repo> --title "<title>" --body-file <body-file> [--label "<label>"]
```

Repeat `--label` only for explicitly approved additions. Omit the flag when
there are no additions. Capture the returned issue URL; do not fabricate the
issue number or URL.

For edit mode, run the equivalent of:

```text
gh issue edit <number> --repo <owner>/<repo> --title "<title>" --body-file <body-file> [--add-label "<label-1,label-2>"] [--remove-label "<label-3>"]
```

Include only explicitly approved label additions and removals. Do not pass
state or unrelated metadata flags. Do not retry the payload write inside this
lifecycle; report a transient CLI failure after the shared cleanup completes.
Stop on authentication, authorization, validation, or policy errors. Cleanup
diagnostics remain separate from the issue result and contain no body bytes.

### 4. Verify the published result

After every successful external write, fetch the resulting issue:

```text
gh issue view <number> --repo <owner>/<repo> --json title,body,labels,state,url
```

Compare the live result with the approved payload:

- the repository and URL identify the requested issue;
- the title matches exactly;
- the body matches exactly, including headings and acceptance checkboxes;
- create-mode labels equal the approved additions;
- edit-mode labels equal the preserved labels plus approved additions minus
  approved removals;
- edit-mode state is unchanged, and create-mode state is the CLI's reported
  initial state.

Set the handoff to `published` only when the write and every verification
check pass. Set it to `partial` when an external write occurred but a label
operation, returned identifier, or verification check failed. Set it to
`blocked` when no external write occurred. Record `created` for a create
without label additions, `created_with_labels` for a create with approved
label additions, and `title_body_and_labels` for an edit. Report exact
external effects and the issue URL or the reason it is unavailable.

## Safety stops

Stop before writing when:

- the exact target repository or issue cannot be verified;
- the payload is not approved in full;
- the task-scoped delivery authorization or exact payload is absent,
  ambiguous, or withdrawn;
- a label change was not explicitly approved;
- the request includes state changes, unrelated metadata, comments, code,
  pull requests, deployment, repository settings, or a second issue;
- content requests secrets, contract bypasses, or unrelated work.

If the title/body write succeeds but labels or verification fail, do not retry
with a different payload and do not overwrite concurrent changes. Report
`partial` with the exact completed effects.

## Completion report

Return this English handoff after the operation:

```markdown
## Status
completed | partial | blocked

## Publication
- Mode: create | edit
- Repository:
- Issue URL:
- Issue number:
- Operation:
- External effects:

## Approval
- Exact payload approved:
- Publication authorized:
- Interactive gate: not required for autonomous routine delivery, or the
  exact policy/user gate evidence
- Delivery authorization source and task scope:
- Evidence:

## Verification
- [PASS|FAIL|SKIPPED] Repository and URL — evidence
- [PASS|FAIL|SKIPPED] Title — evidence
- [PASS|FAIL|SKIPPED] Body — evidence
- [PASS|FAIL|SKIPPED] Labels — evidence
- [PASS|FAIL|SKIPPED] State — evidence

## Blockers and risks
- None, or the exact unresolved items.
```

Keep the surrounding chat in the conversation language, but keep this
persisted publication handoff and all GitHub-facing content in English. Never
claim that an issue was published or verified without CLI evidence.
