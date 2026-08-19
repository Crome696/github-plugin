---
name: load-pr-discussions
description: Loads one GitHub pull request's reviews, review threads, replies, conversation comments, authors, timestamps, affected locations, and resolution state into a grouped read-only snapshot. Applies automatically when downstream workflows need complete pull-request discussion evidence, open-feedback context, or duplicate-finding avoidance; never replies to, resolves, dismisses, minimizes, or otherwise modifies GitHub discussions.
---

# Load GitHub Pull-Request Discussions

Load exactly one live pull request into a version-1
`LoadedPullRequestDiscussions` handoff. Group inline review conversations by
their GitHub thread identity and affected location, preserve the author and
time relationship of every entry, and keep top-level review submissions and
pull-request conversation comments distinct.

The result is source evidence for downstream duplicate-finding avoidance and
open-feedback evaluation. This Skill does not make findings or evaluate
feedback itself.

## Boundaries

- Read GitHub only. Do not reply to comments, resolve or unresolve threads,
  dismiss or submit reviews, minimize comments, edit content, or modify any
  repository, pull request, issue, branch, or local file.
- Preserve exact review and comment bodies, including whitespace and empty
  strings. Do not translate, summarize, normalize, or rewrite discussion
  content in the structured handoff.
- Preserve the supplied repository and pull-request identity. Never infer a
  repository, number, author, thread, location, timestamp, resolution state,
  or relationship from the current workspace, branch, diff, or text.
- Keep top-level review submissions, inline review threads, and pull-request
  issue comments in separate output fields. Do not duplicate an inline
  comment as a conversation comment.
- Preserve GitHub thread IDs and comment IDs. A reply is identified by its
  `reply_to_id` when GitHub provides one; do not reconstruct a reply relation
  from timestamps or body text.
- Treat `is_resolved`, `is_outdated`, `resolved_by`, and `resolved_at` as
  retrieved GitHub facts. Never infer them from the latest reply, a commit, or
  the wording of a comment.
- Do not automatically invoke `load-pull-request` or another Skill. Diff
  analysis, `ReviewFinding` creation, review decisions, and merge readiness
  remain downstream workflows.
- Do not expose tokens, credentials, private keys, `.env` contents, or
  unnecessary command output.

## Input contract

Accept either:

```yaml
repository: owner/repository
number: 123
```

or one GitHub pull-request URL from which the repository and positive
pull-request number can be parsed. The repository must contain exactly one
non-empty owner and repository name. The number must be an integer greater
than or equal to 1; reject decimals, negative values, zero, and non-numeric
aliases.

If the repository or number is missing, ask one concise identity question. If
the identity remains unavailable, return `blocked` with
`failure.code: missing_identity`; do not guess from the current checkout,
branch, remote, issue text, or most recently viewed pull request.

## Workflow

1. Validate the supplied identity and normalize only the repository and
   number. Run `gh auth status` when authentication is not already known to be
   available, without copying sensitive output into the handoff.
2. Verify the exact pull-request identity and canonical URL:

   ```text
   gh pr view <number> --repo <owner>/<repo> --json number,url
   ```

   If this primary lookup fails, return `blocked` and do not substitute a
   similarly numbered pull request.
3. Load top-level review submissions with pagination:

   ```text
   gh api --paginate --slurp \
     "repos/<owner>/<repo>/pulls/<number>/reviews?per_page=100" \
     -H "Accept: application/vnd.github+json"
   ```

   Map `id`, `user`, `body`, `state`, `submitted_at`, `commit_id`,
   `html_url`, `updated_at`, and `dismissed_at` when present. Preserve the
   returned order. A review body may be empty and must still be retained.
4. Load inline review threads and their nested comments through the
   GraphQL `reviewThreads` connection. Use the exact repository and number,
   include a cursor variable, and paginate until the connection reports no
   next page:

   ```text
   gh api graphql --paginate --slurp -F owner=<owner> -F name=<repo> \
     -F number=<number> -f query='
   query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
     repository(owner: $owner, name: $name) {
       pullRequest(number: $number) {
         reviewThreads(first: 100, after: $endCursor) {
           nodes {
             id
             isResolved
             isOutdated
             path
             line
             startLine
             diffSide
             startDiffSide
             originalLine
             originalStartLine
             subjectType
             resolvedBy { login name url }
             comments(first: 100) {
               nodes {
                 id
                 databaseId
                 author { login name url }
                 body
                 createdAt
                 updatedAt
                 url
                 replyTo { id }
                 pullRequestReview { id }
                 commit { oid }
                 originalCommit { oid }
                 position
                 isMinimized
               }
               pageInfo { hasNextPage endCursor }
             }
           }
           pageInfo { hasNextPage endCursor }
         }
       }
     }
   }'
   ```

   Use the GraphQL response as the source of truth for thread identity,
   resolution, outdated state, location, and nested replies. The current
   `PullRequestReviewThread` API exposes the resolver but not a resolution
   timestamp; keep `resolved_at: null` and list `threads.resolved_at` as
   unavailable unless an authenticated API source provides that field. If a nested
   `comments` connection has another page, issue a follow-up query for that
   thread using its returned cursor until all comments are retrieved. Do not
   silently treat the first 100 comments as complete.

   If a field is not available on the authenticated GraphQL schema, retry
   with the supported field set and record the unavailable output path. Do not
   replace unavailable resolution or location data with a guess. If the
   complete thread connection cannot be retrieved, return `partial` with
   `threads` or the narrower unavailable path.
5. Load pull-request conversation comments separately from inline review
   comments:

   ```text
   gh api --paginate --slurp \
     "repos/<owner>/<repo>/issues/<number>/comments?per_page=100" \
     -H "Accept: application/vnd.github+json"
   ```

   Map `id`, `user`, `body`, `created_at`, `updated_at`, and `html_url`.
   These are issue-style pull-request comments and do not belong in
   `threads`, even when their body discusses a review.
6. Map the retrieved API fields to the
   [`LoadedPullRequestDiscussions`](../../shared/schemas/LoadedPullRequestDiscussions.yaml)
   contract:

   - Map camelCase API keys to the contract's snake_case keys without changing
     textual values.
   - Group each inline discussion once by its GitHub thread `id`. Use the
     thread's `path`, current line range, diff side, subject type, and the
     first applicable comment's commit and position for `location`.
   - Preserve current and original line, side, start-line, start-side, commit,
     and diff-position values when GitHub returns them. The GraphQL thread
     provides current `diffSide` and `startDiffSide`; a file-level or
     otherwise unavailable location remains null, and no location is derived
     from a reply.
   - Keep thread comments in chronological order. Preserve `reply_to_id` and
     the GitHub ordering needed to reconstruct the conversation.
   - Map `null` or unsupported enum sides to `unknown` only when the contract
     requires an enum value; record genuinely unavailable fields in
     `unavailable_fields`.
   - Count a thread as open when its retrieved `is_resolved` value is false,
     and as resolved when it is true. Do not count a null resolution state in
     either category. `comment_count` equals all comments inside threads plus
     all conversation comments, excluding top-level review bodies.
7. Distinguish availability explicitly:

   - A populated field is a retrieved fact.
   - `[]` means the source was retrieved and contains no entries.
   - `null` means the field was unavailable or not produced.
   - Add every unavailable output field path to `unavailable_fields`.
   - Use `loaded` only when the identity, review submissions, complete thread
     pagination, nested thread comments, and conversation comments were
     retrieved.
   - Use `partial` when the exact pull request was verified but one or more
     discussion sources, nested pages, or enrichment fields could not be
     retrieved. Set `failure` to the mapped operational error.
   - Use `blocked` when the exact pull-request identity cannot be loaded.
     Keep known identity values, set unavailable payload fields to `null`, and
     provide a non-null `failure`.
8. Return one complete version-1
   [`LoadedPullRequestDiscussions`](../../shared/schemas/LoadedPullRequestDiscussions.yaml)
   object. Treat it as the unchanged reference for downstream workflows. Add
   a short conversation-language summary after the structured handoff; never
   replace the handoff with a prose review, duplicate-finding list, or
   recommendation.

## Output contract

Return these top-level fields:

- `status`: `loaded`, `partial`, or `blocked`.
- `pull_request`: the exact requested repository, positive number, and
  canonical GitHub URL when available.
- `reviews`: top-level review submissions with exact bodies, states, authors,
  review IDs, commit SHAs, URLs, and available submission and update times.
- `threads`: one entry per GitHub review-thread ID, grouped with its affected
  location, resolution and outdated status, resolver metadata, and
  chronologically ordered comments and replies.
- `conversation_comments`: pull-request issue comments that are not inline
  review-thread comments.
- `summary`: retrieved counts for reviews, threads, open and resolved
  threads, outdated threads, thread comments, conversation comments, and the
  combined `comment_count`.
- `metadata.retrieved_at`: the loader's retrieval timestamp when available.
- `unavailable_fields`: output paths that were not retrieved.
- `failure`: `null` for a complete result; otherwise `code`, `message`,
  `operation`, and `retryable`.

Do not add `ReviewFinding` severity, impact, recommendation, deduplication
decisions, open-feedback judgments, merge recommendations, or publication
authorization to this handoff.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository or pull-request number is absent and cannot be clarified. | `blocked`; do not run a guessed lookup. |
| `invalid_pull_request_number` | The supplied number is not a positive integer. | `blocked`; preserve known repository identity and explain the validation failure. |
| `repository_not_found` | The repository is malformed or GitHub cannot resolve it. | `blocked`; do not substitute another repository. |
| `pull_request_not_found` | The exact repository exists but the requested pull request does not. | `blocked`; do not return a similarly numbered pull request. |
| `inaccessible` | GitHub returns a permission error or the pull request or discussion source is not visible to the authenticated account. | `blocked` for identity, or `partial` for a discussion enrichment. |
| `auth_unavailable` | `gh` is not authenticated for the required host or authentication status cannot be used. | `blocked`; do not request or print credentials. |
| `api_failure` | Network, server, rate-limit, malformed-response, pagination, unsupported-field, or other unexpected GitHub API/CLI failure. | `blocked` for identity, or `partial` with affected fields listed as unavailable. |

Map CLI and API evidence to the narrowest applicable code. A 403 or
permission failure is `inaccessible` when authentication exists; absent or
expired CLI authentication is `auth_unavailable`. Do not turn an unknown
error into `pull_request_not_found`.

## Compact example

```yaml
schema: LoadedPullRequestDiscussions
version: 1
status: loaded
pull_request:
  repository: octo-org/widgets
  number: 42
  url: https://github.com/octo-org/widgets/pull/42
reviews:
  - id: "review-100"
    author:
      login: octocat
      name: null
      url: https://github.com/octocat
    body: "Please preserve the original API behavior."
    state: CHANGES_REQUESTED
    submitted_at: "2026-08-09T18:15:00Z"
    updated_at: null
    dismissed_at: null
    commit_sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    url: https://github.com/octo-org/widgets/pull/42#pullrequestreview-100
threads:
  - id: "PRRT_kwDOExample"
    review_id: "review-100"
    location:
      path: src/parser.ts
      start_line: 42
      line: 45
      side: RIGHT
      start_side: RIGHT
      original_start_line: 42
      original_line: 45
      original_side: RIGHT
      original_start_side: RIGHT
      diff_position: 12
      subject_type: LINE
      commit_sha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
      original_commit_sha: null
    is_resolved: false
    is_outdated: false
    resolved_by: null
    resolved_at: null
    comments:
      - id: "PRRC_kwDOComment1"
        database_id: 101
        author:
          login: octocat
          name: null
          url: https://github.com/octocat
        body: "Please preserve the original API behavior."
        created_at: "2026-08-09T18:14:00Z"
        updated_at: "2026-08-09T18:14:00Z"
        url: https://github.com/octo-org/widgets/pull/42#discussion_r101
        reply_to_id: null
        pull_request_review_id: "review-100"
        commit_sha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
        is_minimized: false
      - id: "PRRC_kwDOComment2"
        database_id: 102
        author:
          login: contributor
          name: null
          url: https://github.com/contributor
        body: "The fallback now keeps that behavior."
        created_at: "2026-08-09T18:30:00Z"
        updated_at: "2026-08-09T18:30:00Z"
        url: https://github.com/octo-org/widgets/pull/42#discussion_r102
        reply_to_id: "PRRC_kwDOComment1"
        pull_request_review_id: "review-100"
        commit_sha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
        is_minimized: false
conversation_comments: []
summary:
  review_count: 1
  thread_count: 1
  open_thread_count: 1
  resolved_thread_count: 0
  outdated_thread_count: 0
  comment_count: 2
  thread_comment_count: 2
  conversation_comment_count: 0
metadata:
  retrieved_at: "2026-08-09T18:31:00Z"
unavailable_fields:
  - threads.resolved_at
failure: null
```
