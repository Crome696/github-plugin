---
name: load-github-issue
description: Load one GitHub issue by repository and issue number and return a structured LoadedIssue snapshot with preserved content, metadata, comments, and linked pull requests. Use automatically when a downstream workflow needs live issue data or the user asks to load, fetch, or read a GitHub issue; do not use for issue assessment, rewriting, publication, or GitHub writes.
---

# Load GitHub Issues

Load exactly one live GitHub issue as a read-only `LoadedIssue` version 1
handoff. The handoff is for downstream AI workflows and must separate
retrieved facts from unavailable information.

`issue-agent` mode `refine` consumes this snapshot as the immutable live
baseline before analysis, drafting, comparison, and any approved edit
publication.

## Boundaries

- Read GitHub only. Do not edit issues, comments, labels, assignees,
  milestones, pull requests, repository settings, or local repository files.
- For an approved partial update to selected issue fields, hand the exact
  target and patch to [update-github-issue](../update-github-issue/SKILL.md);
  this Skill remains read-only.
- Preserve the exact GitHub `title`, `body`, and comment bodies. Do not
  translate, summarize, normalize whitespace, interpret markdown, or rewrite
  issue content in the handoff.
- Keep the structured handoff fields and failure codes in English. Keep chat
  explanations in the user's conversation language.
- Never infer an issue number, repository, pull request, author, label,
  comment, milestone, or metadata value. Ask for missing identity information
  instead of searching for a likely issue.
- Do not expose tokens, credentials, private keys, `.env` contents, or
  unnecessary command output.
- Do not automatically invoke another Skill. A downstream workflow may
  consume the returned handoff explicitly.
- Downstream severity-based analysis of this snapshot belongs to
  `analyze-issue`. Parent-issue product assessment belongs to
  `analyze-product-issue`. This Skill only loads and preserves the source
  evidence.

## Input contract

Accept either:

```yaml
repository: owner/repository
number: 123
```

or one GitHub issue URL from which the repository and positive issue number
can be parsed. The repository must contain exactly one non-empty owner and
repository name. The issue number must be an integer greater than or equal to
1; reject decimals, negative values, zero, and non-numeric aliases.

If the repository or issue number is missing, ask one concise identity
question. If the identity remains unavailable, return `blocked` with
`failure.code: missing_identity`; do not guess from the current workspace,
branch, remote, or issue text.

## Workflow

1. Validate the input and normalize only the structural identity. Keep the
   original issue fields untouched. Run `gh auth status` when authentication
   is not already known to be available, without copying sensitive output.
2. Load the primary issue payload with:

   ```text
   gh issue view <number> --repo <owner>/<repo> --json title,body,state,author,assignees,labels,milestone,comments,number,url,createdAt,updatedAt,closedAt,id,stateReason,isPinned
   ```

   The command must target the exact repository and number supplied by the
   user. Use the returned JSON as the source of truth for the issue title,
   body, state, author, labels, assignees, milestone, comments, URL,
   timestamps, and supported issue metadata.
3. Load issue-link evidence separately so linked pull requests are not
   confused with arbitrary URLs in the body. Use the GitHub issue timeline
   endpoint through the authenticated GitHub CLI, including pagination:

   ```text
   gh api --paginate --slurp "repos/<owner>/<repo>/issues/<number>/timeline" -H "Accept: application/vnd.github+json"
   ```

   Map pull requests from timeline events such as cross-references,
   connected items, and pull requests that closed the issue. Deduplicate by
   repository and number, preserve the relationship evidence, and return
   `linked_pull_requests: []` when the timeline was retrieved successfully
   but contains no linked pull requests. Do not infer a pull request from
   issue text alone.
4. Map the result to
   [`LoadedIssue`](../../shared/schemas/LoadedIssue.yaml), converting CLI
   camelCase keys to the contract's snake_case keys without changing textual
   values. Preserve comment order as returned by GitHub. Include only
   retrieved facts.
5. Distinguish availability explicitly:
   - A populated field is a retrieved fact.
   - `[]` means the field was retrieved and has no entries.
   - `null` means the field was unavailable or not produced.
   - Add every unavailable output field path to `unavailable_fields`.
   - Use `status: partial` when the primary issue loaded but an enrichment
     request, such as the timeline, failed. Set `failure` to the mapped
     operational error for that failed request.
   - Use `status: blocked` when the primary issue cannot be loaded. Keep the
     known repository, number, and URL identity, set unavailable payload
     fields to `null`, and provide a non-null `failure`.
6. Return one complete version-1 `LoadedIssue` object. Add a short
   conversation-language summary after the structured handoff; never replace
   the handoff with a prose summary.

## Output contract

The top-level object must contain `status`, `issue`, `title`, `body`, `state`,
`author`, `labels`, `assignees`, `milestone`, `linked_pull_requests`,
`comments`, `metadata`, `unavailable_fields`, and `failure`.

- `status` is `loaded`, `partial`, or `blocked`.
- `issue` contains the requested `repository`, positive `number`, and
  canonical GitHub `url` when available.
- `title` and `body` are exact strings from GitHub, including an empty body.
- `state` is `open` or `closed` when retrieved.
- `author`, `labels`, `assignees`, `milestone`, `linked_pull_requests`, and
  `comments` retain the available identity and display metadata. Comment
  bodies remain exact strings.
- `metadata` includes the issue identifier, creation/update/close timestamps,
  state reason, pin status, and the loader's `retrieved_at` timestamp when
  available.
- `unavailable_fields` contains output field paths, such as
  `linked_pull_requests` or `comments`.
- `failure` is `null` for a complete `loaded` result. For a partial
  enrichment failure or blocked primary load, include `code`, `message`,
  `operation`, and `retryable`. The message must describe the failure without
  exposing credentials or unnecessary raw output.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository or issue number is absent and cannot be clarified. | `blocked`; do not run a guessed lookup. |
| `invalid_issue_number` | The supplied number is not a positive integer. | `blocked`; preserve known repository identity and explain the validation failure. |
| `repository_not_found` | The repository is malformed or GitHub cannot resolve it. | `blocked`; do not substitute another repository. |
| `issue_not_found` | The exact repository exists but the requested issue number does not. | `blocked`; do not return a similarly numbered issue. |
| `inaccessible` | GitHub returns a permission error or the issue is not visible to the authenticated account. | `blocked` for the primary load, or `partial` for a secondary enrichment request. |
| `auth_unavailable` | `gh` is not authenticated for the required host or authentication status cannot be used. | `blocked` for the primary load; do not request or print credentials. |
| `api_failure` | Network, server, rate-limit, malformed-response, or other unexpected GitHub API/CLI failure. | `blocked` for the primary load, or `partial` with the affected field listed as unavailable. |

Map CLI/API evidence to the narrowest applicable code. A 403 or permission
failure is `inaccessible` when authentication exists; an absent login or
expired CLI authentication is `auth_unavailable`. Do not turn an unknown
error into `issue_not_found`.

## Compact example

```yaml
status: loaded
issue:
  repository: octo-org/widgets
  number: 42
  url: https://github.com/octo-org/widgets/issues/42
title: Preserve issue text during loading
body: "The loader must return the original body unchanged."
state: open
author:
  login: octocat
  name: null
  url: https://github.com/octocat
labels:
  - name: enhancement
    color: "1D76DB"
    description: null
    url: null
assignees: []
milestone: null
linked_pull_requests: []
comments: []
metadata:
  node_id: MDU6SXNzdWUx
  created_at: "2026-08-06T18:00:00Z"
  updated_at: "2026-08-06T18:30:00Z"
  closed_at: null
  state_reason: null
  is_pinned: false
  retrieved_at: "2026-08-06T18:31:00Z"
unavailable_fields: []
failure: null
```
