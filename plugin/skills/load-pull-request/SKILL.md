---
name: load-pull-request
description: Load one GitHub pull request by repository and number and return a structured LoadedPullRequest snapshot with preserved title and body, head and base, commits, files, checks, reviews, draft state, authors, and related metadata. Use automatically when a downstream workflow needs live pull-request data or the user asks to load, fetch, or read a pull request; do not use for diff analysis, review decisions, merge readiness, publication, or GitHub writes.
---

# Load GitHub Pull Requests

Load exactly one live GitHub pull request as a read-only `LoadedPullRequest`
version-1 handoff. Preserve the result as an immutable source reference for
downstream diff, issue, check, and review workflows, and distinguish retrieved
facts from unavailable information.

## Boundaries

- Read GitHub only. Do not edit pull requests, issues, comments, labels,
  assignees, branches, repositories, or local repository files.
- Preserve the exact GitHub `title`, `body`, review bodies, comment bodies, and
  commit message parts. Do not translate, summarize, normalize whitespace,
  rewrite content, or silently change the snapshot after loading.
- Return the requested pull-request identity, state, draft status, authors,
  head and base revisions, commits, file metadata, checks, reviews, review
  requests, comments, linked issues, and supported metadata when retrieved.
- File entries contain path and change statistics only. Do not fabricate or
  include a complete patch in the snapshot.
- Infer linked issues only from retrieved GitHub timeline evidence. Never infer
  an issue from pull-request body text, branch names, commit messages, or
  arbitrary URLs.
- Never infer a repository, pull-request number, author, branch, SHA, check,
  review, comment, issue, or metadata value. Ask for missing identity instead
  of searching for a likely pull request.
- Do not automatically invoke another Skill. Diff analysis belongs to a
  downstream workflow that consumes this snapshot; review decisions and merge
  readiness remain separate workflows.
- Do not expose tokens, credentials, private keys, `.env` contents, or
  unnecessary command output.

## Input contract

Accept either:

```yaml
repository: owner/repository
number: 123
```

or one GitHub pull-request URL from which the repository and positive pull
request number can be parsed. The repository must contain exactly one
non-empty owner and repository name. The pull-request number must be an
integer greater than or equal to 1; reject decimals, negative values, zero,
and non-numeric aliases.

If the repository or pull-request number is missing, ask one concise identity
question. If the identity remains unavailable, return `blocked` with
`failure.code: missing_identity`; do not guess from the current workspace,
branch, remote, or issue text.

## Workflow

1. Validate the supplied identity and normalize only its repository and number.
   Run `gh auth status` when authentication is not already known to be
   available, without copying sensitive output into the handoff.
2. Load the primary pull-request payload with:

   ```text
   gh pr view <number> --repo <owner>/<repo> --json number,url,title,body,state,isDraft,author,assignees,labels,milestone,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,headRepositoryOwner,commits,files,statusCheckRollup,reviews,reviewRequests,comments,additions,deletions,changedFiles,mergeable,mergeStateStatus,createdAt,updatedAt,closedAt,mergedAt,id
   ```

   Target the exact repository and number supplied by the user. Use the
   returned JSON as the source of truth for the title, body, state, draft
   status, identity, branches, commits, files, checks, reviews, comments,
   counts, merge metadata, and timestamps.
3. Load issue-link evidence separately so linked issues are not confused with
   arbitrary URLs in the body. Use the GitHub pull request timeline through
   the authenticated GitHub CLI, including pagination:

   ```text
   gh api --paginate --slurp "repos/<owner>/<repo>/issues/<number>/timeline" -H "Accept: application/vnd.github+json"
   ```

   Map issue references from timeline events such as cross-references,
   connected items, and pull requests that closed an issue. Deduplicate by
   repository and number, preserve the relationship evidence, and return
   `linked_issues: []` when the timeline was retrieved successfully but
   contains no linked issues. Do not infer an issue from pull-request text
   alone.
4. Map CLI/API camelCase keys to the contract's snake_case keys without
   changing textual values. Map the GitHub pull-request state to `open`,
   `closed`, or `merged` using the retrieved state and merge timestamp. Keep
   the head repository distinct from the base repository for cross-repository
   pull requests.
5. Distinguish availability explicitly:
   - A populated field is a retrieved fact.
   - `[]` means the field was retrieved and has no entries.
   - `null` means the field was unavailable or not produced.
   - Add every unavailable output field path to `unavailable_fields`.
   - Use `status: partial` when the primary pull request loaded but an
     enrichment request, such as the timeline, failed. Set `failure` to the
     mapped operational error for that failed request.
   - Use `status: blocked` when the primary pull request cannot be loaded.
     Keep the known repository, number, and URL identity, set unavailable
     payload fields to `null`, and provide a non-null `failure`.
6. Return one complete version-1 `LoadedPullRequest` object. Treat it as the
   unchanged reference for downstream workflows. Add a short
   conversation-language summary after the structured handoff; never replace
   the handoff with a prose summary.

## Output contract

Return the version-1
[`LoadedPullRequest`](../../shared/schemas/LoadedPullRequest.yaml) object with
these top-level fields:

- `status`: `loaded`, `partial`, or `blocked`.
- `pull_request`: requested repository, positive number, and canonical GitHub
  URL when available.
- `title` and `body`: exact strings from GitHub, including an empty body.
- `state`: `open`, `closed`, or `merged`; `is_draft`: the retrieved draft
  state.
- `author`, `assignees`, `labels`, and `milestone`: available identity and
  display metadata.
- `base` and `head`: branch refs, commit SHAs, and repository identities.
- `commits`: ordered commit metadata with SHAs, exact message parts, authors,
  and timestamps.
- `files`: ordered changed-file metadata with paths, additions, deletions,
  and change types; no fabricated patch content.
- `checks`: status-check rollup entries with status, conclusion, URLs, and
  timestamps when available.
- `reviews`, `review_requests`, and `comments`: available review and
  discussion evidence; review and comment bodies remain exact strings.
- `linked_issues`: issues supported by timeline evidence, including the
  relationship type.
- `metadata`: identifier, change counts, merge state, timestamps, and the
  loader's `retrieved_at` timestamp when available.
- `unavailable_fields`: output field paths such as `checks`, `reviews`, or
  `linked_issues` that were not retrieved.
- `failure`: `null` for a complete `loaded` result; otherwise `code`, `message`,
  `operation`, and `retryable`.

Do not add analysis, review findings, merge recommendations, issue rewrites,
or publication authorization to this handoff.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository or pull-request number is absent and cannot be clarified. | `blocked`; do not run a guessed lookup. |
| `invalid_pull_request_number` | The supplied number is not a positive integer. | `blocked`; preserve known repository identity and explain the validation failure. |
| `repository_not_found` | The repository is malformed or GitHub cannot resolve it. | `blocked`; do not substitute another repository. |
| `pull_request_not_found` | The exact repository exists but the requested pull request does not. | `blocked`; do not return a similarly numbered pull request. |
| `inaccessible` | GitHub returns a permission error or the pull request is not visible to the authenticated account. | `blocked` for the primary load, or `partial` for a secondary enrichment request. |
| `auth_unavailable` | `gh` is not authenticated for the required host or authentication status cannot be used. | `blocked` for the primary load; do not request or print credentials. |
| `api_failure` | Network, server, rate-limit, malformed-response, unsupported-field, or other unexpected GitHub API/CLI failure. | `blocked` for the primary load, or `partial` with the affected field listed as unavailable. |

Map CLI/API evidence to the narrowest applicable code. A 403 or permission
failure is `inaccessible` when authentication exists; an absent login or
expired CLI authentication is `auth_unavailable`. Do not turn an unknown
error into `pull_request_not_found`.

## Compact example

```yaml
schema: LoadedPullRequest
version: 1
status: loaded
pull_request:
  repository: octo-org/widgets
  number: 42
  url: https://github.com/octo-org/widgets/pull/42
title: Preserve pull-request evidence during loading
body: "The loader must return the original body unchanged."
state: open
is_draft: false
author:
  login: octocat
  name: null
  url: https://github.com/octocat
assignees: []
labels: []
milestone: null
base:
  ref: main
  sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  repository: octo-org/widgets
head:
  ref: agent/load-pull-request
  sha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  repository: octo-org/widgets
commits: []
files: []
checks: []
reviews: []
review_requests: []
comments: []
linked_issues: []
metadata:
  node_id: PR_kwDOExample
  additions: 1
  deletions: 0
  changed_files: 1
  mergeable: mergeable
  merge_state_status: clean
  created_at: "2026-08-09T18:00:00Z"
  updated_at: "2026-08-09T18:30:00Z"
  closed_at: null
  merged_at: null
  merged_by: null
  retrieved_at: "2026-08-09T18:31:00Z"
unavailable_fields: []
failure: null
```
