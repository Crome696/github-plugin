---
name: load-linked-issue
description: Resolve the GitHub issue linked to one pull request from closing keywords, explicit references, and GitHub relationship evidence, classify candidates as linked, mentioned, or ambiguous, and load the unique linked issue read-only. Use automatically when a PR needs its related issue context; do not guess under ambiguity or perform GitHub writes.
---

# Load Linked Issue

Resolve the issue relationship for exactly one GitHub pull request and return
one version-1 [`LinkedIssue`](../../shared/schemas/LinkedIssue.yaml) handoff.
Use retrieved GitHub relationship evidence, explicit issue references, and
closing keywords. Load the issue only after one unique `linked` candidate has
been established.

## Boundaries

- Read GitHub only. Never edit a pull request, issue, comment, label,
  assignee, milestone, branch, repository, or local file.
- Never close an issue, merge a pull request, mark it ready, change its body,
  or publish any GitHub content.
- Do not select an issue from a branch name, filename, commit SHA, title
  similarity, a bare number without `#`, or unstructured prose.
- Do not select the most likely issue when more than one linked candidate
  remains. Return `ambiguous` and explicit clarification requests.
- An explicit issue reference without a closing keyword or retrieved GitHub
  relationship is `mentioned`, not `linked`.
- Do not automatically invoke `load-pull-request`, `load-github-issue`, or
  another Skill. If no suitable handoff is supplied, perform the bounded
  read-only GitHub CLI requests described below and return the corresponding
  contract.
- Preserve exact GitHub title, body, comment, and commit-message text in the
  nested `LoadedIssue` or evidence fields. Do not translate, normalize
  whitespace, or expose credentials and unnecessary command output.
- Keep the structured handoff and authored rationale in English. Add a short
  conversation-language summary after the handoff.

## Input contract

Accept either:

```yaml
repository: owner/repository
number: 123
```

or one GitHub pull-request URL from which the repository and positive pull
request number can be parsed. Accept an optional version-1 `LoadedPullRequest`
with the same repository and number. Use only its retrieved fields; if a
required field is null or unavailable, retrieve that field directly.

Validate that the repository has exactly one non-empty owner and repository
name and that the pull-request number is an integer greater than or equal to
1. Reject decimals, zero, negative values, aliases, and repository mismatches.
If identity is missing, ask one concise question. If it remains unavailable,
return `blocked` with `failure.code: missing_identity`; never search for a
likely pull request.

## Candidate discovery

1. Validate the identity and run `gh auth status` when authentication is not
   already known to be available. Do not copy authentication output into the
   handoff.
2. When a complete `LoadedPullRequest` is not available, load the exact
   pull-request fields needed for discovery:

   ```text
   gh pr view <number> --repo <owner>/<repo> --json number,url,title,body,commits
   ```

   Treat the returned body and commit message parts as source text. Do not
   infer issue identity from a title, branch, SHA, or changed path.
3. Retrieve structured relationship evidence separately from arbitrary
   pull-request text:

   ```text
   gh api --paginate --slurp "repos/<owner>/<repo>/issues/<number>/timeline" -H "Accept: application/vnd.github+json"
   ```

   Map only timeline events whose payload identifies a concrete issue
   relationship, such as `referenced`, `cross_referenced`, `connected`, or
   `closed_by`. Preserve the event type and source location in candidate
   evidence. Ignore arbitrary URLs and text that merely appear in an event
   payload.
4. Retrieve GitHub's explicit closing-issue relationship:

   ```text
   gh api graphql -f query='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:100){nodes{number title url repository{nameWithOwner}}}}}}' -F owner=<owner> -F name=<repo> -F number=<number>
   ```

   Treat each returned `closingIssuesReferences` node as relationship
   evidence. Use the exact repository and issue number from the response.
   Do not replace a missing or failed response with an inference.

## Classify candidates

Normalize candidates only by their structural repository and positive issue
number. Deduplicate identical repository/number pairs while retaining every
distinct evidence source.

### Evidence strength

| Candidate classification | Required evidence |
| --- | --- |
| `linked` | A supported closing keyword targets the issue, or a retrieved GitHub timeline/GraphQL relationship explicitly targets it. |
| `mentioned` | A concrete `#number`, `owner/repository#number`, or GitHub issue URL targets the issue, but no closing keyword or GitHub relationship was retrieved. |

Recognize case-insensitive GitHub closing-keyword forms `close`, `closes`,
`closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`, and `resolved` when
they target a concrete issue reference. Record the exact matched fragment in
`keyword_text`, and record whether it came from `pull_request.body` or a
commit message. Do not treat a keyword inside a negated, quoted, or
code-only example as authoritative; if the context cannot be established,
preserve the evidence and request clarification instead of promoting it.

Recognize same-repository `#number`, qualified `owner/repository#number`, and
canonical GitHub issue URLs as explicit references. A bare number without `#`
is not a candidate. A reference to another issue is retained as a separate
candidate; it is never silently folded into the first candidate.

When evidence for one candidate contains both `linked` and `mentioned` signals,
classify that candidate as `linked` and preserve both sources. A single linked
candidate may coexist with any number of mentioned candidates; mentioned
candidates do not prevent loading the unique linked candidate.

## Decide whether to load

Use the following deterministic outcomes:

| Condition | Status | Action |
| --- | --- | --- |
| Exactly one `linked` candidate | `loaded` or `partial` | Load that exact issue read-only. |
| More than one `linked` candidate | `ambiguous` | Do not load any issue. Return all linked candidates and clarifications. |
| No `linked` candidate, with one or more `mentioned` candidates | `unresolved` | Do not load a mentioned issue. Request evidence that identifies the intended relationship. |
| No candidates | `unresolved` | Do not search by similarity. Request the exact issue or linking evidence. |
| Required identity, authentication, candidate discovery, or exact lookup fails | `blocked` | Preserve known identity and return the narrowest failure code. |

For `ambiguous` and `unresolved`, set `primary_issue` and `loaded_issue` to
null, keep `failure` null for a successful read that found no unique
relationship, and populate `clarifications`. A clarification must state what
evidence is missing, such as an exact issue number, a closing keyword, or a
confirmed GitHub relationship.

## Load the unique issue

After and only after one unique linked candidate is established, retrieve the
issue using its exact repository and number:

```text
gh issue view <issue-number> --repo <issue-owner>/<issue-repo> --json title,body,state,author,assignees,labels,milestone,comments,number,url,createdAt,updatedAt,closedAt,id,stateReason,isPinned
```

Retrieve issue relationship enrichment separately, including pagination:

```text
gh api --paginate --slurp "repos/<issue-owner>/<issue-repo>/issues/<issue-number>/timeline" -H "Accept: application/vnd.github+json"
```

Map the result to the version-1 `LoadedIssue` contract exactly as
`load-github-issue` specifies:

- Preserve title, body, comment bodies, and supported metadata exactly.
- Return `linked_pull_requests: []` only when the timeline was successfully
  retrieved and contains no linked pull requests.
- Use `null` and `unavailable_fields` for unavailable values; never fabricate
  them.
- Use nested `LoadedIssue.status: loaded` when the primary payload and
  enrichment succeed, or `partial` when the primary payload succeeds but
  enrichment fails.

Return top-level `status: loaded` when the nested issue is complete. Return
top-level `status: partial` when the unique issue is established and the
nested issue is partial. If the exact issue cannot be loaded, keep the
verified `primary_issue`, set `loaded_issue` to null, return `blocked`, and
describe the exact failed operation in `failure`.

## Output contract

Return exactly one version-1 `LinkedIssue` object with:

- `pull_request`: the requested repository, number, and canonical URL when
  available.
- `candidates`: every deduplicated issue candidate, classified as `linked` or
  `mentioned`, with relationship, keyword, source, and evidence details.
- `primary_issue`: the unique linked issue only; null when the relationship is
  ambiguous, unresolved, or blocked before selection.
- `loaded_issue`: the nested `LoadedIssue` only for a uniquely selected issue
  that was loaded or partially loaded.
- `ambiguous_candidates`: all candidates that prevent unique selection.
- `clarifications`: actionable questions and required evidence for
  `ambiguous` and `unresolved` results.
- `blockers`: operational or validation blockers with evidence.
- `evidence` and `rationale`: reproducible English explanation of the
  classification and load decision.
- `recommended_next_skill`: `analyze-issue` only when `loaded_issue` is
  available; otherwise `null`. This value is advisory.
- `failure`: null for `loaded`, `ambiguous`, and `unresolved` results unless
  an operational failure occurred; otherwise the narrowest loader failure
  with `code`, `message`, `operation`, and `retryable`.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository or pull-request number is absent and cannot be clarified. | `blocked`; do not run a guessed lookup. |
| `invalid_pull_request_number` | The number is not a positive integer. | `blocked`; preserve known repository identity. |
| `repository_not_found` | The repository is malformed or GitHub cannot resolve it. | `blocked`; do not substitute another repository. |
| `pull_request_not_found` | The exact pull request cannot be loaded. | `blocked`; do not return a similarly numbered pull request. |
| `issue_not_found` | The selected exact issue cannot be loaded. | `blocked`; do not substitute a mentioned issue. |
| `inaccessible` | GitHub returns a permission error for a required request. | `blocked`; do not expose private content. |
| `auth_unavailable` | `gh` authentication is absent or unusable. | `blocked`; do not request or print credentials. |
| `api_failure` | Network, rate-limit, malformed-response, or other required API/CLI request fails. | `blocked`, or `partial` only when the selected issue's primary payload loaded and a non-primary enrichment failed. |

Multiple linked candidates are not an API failure: use `ambiguous` with
`clarifications` and no issue load. Mentioned-only candidates are not a
failure: use `unresolved` and request linking evidence.

## Compact examples

Unique closing keyword:

```yaml
schema: LinkedIssue
version: 1
status: loaded
pull_request:
  repository: octo-org/widgets
  number: 42
  url: https://github.com/octo-org/widgets/pull/42
candidates:
  - repository: octo-org/widgets
    number: 17
    url: https://github.com/octo-org/widgets/issues/17
    title: Preserve issue context
    classification: linked
    relationship: null
    keyword_text: "Fixes #17"
    evidence_sources: [pull_request.body]
    evidence: ["The PR body contains the supported closing keyword Fixes #17."]
primary_issue:
  repository: octo-org/widgets
  number: 17
  url: https://github.com/octo-org/widgets/issues/17
  title: Preserve issue context
loaded_issue:
  schema: LoadedIssue
  version: 1
  status: loaded
  # Remaining LoadedIssue fields are preserved exactly.
clarifications: []
ambiguous_candidates: []
blockers: []
evidence:
  - pull_request.body contains the exact closing reference Fixes #17.
rationale: >-
  Exactly one linked candidate was found from a supported closing keyword, so
  that issue was loaded read-only.
recommended_next_skill: analyze-issue
failure: null
```

Mentioned-only or conflicting linked candidates must instead return
`unresolved` or `ambiguous`, leave `loaded_issue` null, and include a concrete
clarification. Never choose an issue merely because it is the only issue
mentioned or because its number appears in a branch or commit identifier.
