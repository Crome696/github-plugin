---
name: check-linked-issue-status
description: Check one pull request's uniquely linked GitHub issue, issue state, explicit acceptance criteria, closing relationship, and evidence-backed integration consistency. Use automatically when a workflow needs current issue-to-PR consistency; never close or edit an issue, change a pull request, publish GitHub content, merge, rebase, or modify local files.
---

# Check Linked Issue Status

Assess exactly one pull request and return one version-1
[`LinkedIssueStatusAssessment`](../../shared/schemas/LinkedIssueStatusAssessment.yaml)
handoff. This is a diagnostic, read-only assessment. It does not authorize
integration or merging.

## Boundaries

- Read GitHub and supplied handoffs only. Never close or edit an issue, change a
  pull request, publish a comment or review, merge, rebase, resolve a thread,
  or modify Git, the worktree, or local files.
- Preserve exact repository, PR number, canonical URL, and current head SHA.
  Do not combine stale supplied evidence with a newer live head.
- Select an issue only when `LinkedIssue` or retrieved GitHub relationship
  evidence establishes exactly one `linked` candidate. A mentioned-only,
  ambiguous, cross-repository, or inferred candidate is not a primary issue.
- Do not invent acceptance criteria, closing intent, implementation behavior,
  test results, or merge requirements. Keep missing and uncertain evidence
  explicit.
- Keep the structured handoff and authored rationale in English. Add a concise
  conversation-language summary after the handoff.

## Input contract

Accept either:

```yaml
repository: owner/repository
number: 123
```

or one pull-request URL from which the exact repository and positive number can
be parsed. Accept optional, identity-validated version-1
`LoadedPullRequest`, `LinkedIssue`, `PullRequestDiffAnalysis`, and explicit
SHA-bound validation evidence. The preferred hybrid behavior is:

1. Use complete supplied handoffs when their repository, PR number, URL, and
   current head SHA match.
2. Retrieve only missing or stale fields through the bounded read-only requests
   below.
3. If a supplied handoff conflicts with live identity or head state, refresh it
   instead of merging the two snapshots.

Validate one non-empty owner/repository and a positive integer PR number.
Reject aliases, decimals, zero, negative numbers, and repository mismatches.
If identity cannot be established, return `blocked` with
`failure.code: missing_identity`; never search for a likely PR.

## Required evidence

Use the narrowest available source and record the command, endpoint, field,
identifier, and head SHA in material evidence:

1. Pull-request identity, state, base branch, body, commits, linked issues, and
   current head:

   ```text
   gh pr view <number> --repo <owner>/<repo> --json number,url,state,title,body,baseRefName,headRefOid,commits
   ```

2. Issue candidates and GitHub relationships, when `LinkedIssue` is absent or
   incomplete:

   ```text
   gh api --paginate --slurp "repos/<owner>/<repo>/issues/<number>/timeline" -H "Accept: application/vnd.github+json"
   gh api graphql -f query='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:100){nodes{number title url repository{nameWithOwner}}}}}}' -F owner=<owner> -F name=<repo> -F number=<number>
   ```

3. The exact unique issue, after linkage is established:

   ```text
   gh issue view <issue-number> --repo <issue-owner>/<issue-repo> --json title,body,state,stateReason,number,url,updatedAt,closedAt
   gh api --paginate --slurp "repos/<issue-owner>/<issue-repo>/issues/<issue-number>/timeline" -H "Accept: application/vnd.github+json"
   ```

4. Current diff and commit evidence for criteria coverage only when not
   supplied or not tied to the current head:

   ```text
   gh pr diff <number> --repo <owner>/<repo>
   gh pr view <number> --repo <owner>/<repo> --json commits,body
   ```

Run `gh auth status` when authentication is not already known to be available,
but never copy credentials or sensitive authentication output into the
handoff. Do not load an issue until one unique linked candidate is established.

## Relationship assessment

Reuse the exact candidate classifications from `LinkedIssue`:

- `linked` requires a supported closing keyword or retrieved GitHub relationship.
- `mentioned` is a concrete reference without closing or relationship evidence.
- Multiple linked candidates are `ambiguous`; mentioned-only candidates are
  `unresolved`.
- A closing keyword in a quoted, negated, or code-only example is not
  authoritative. Preserve it as evidence and classify the intent as uncertain
  when context cannot be established.
- A keyword-only relationship is not the same as confirmed GitHub closing
  evidence. Report both sources independently.

Set `linkage.closing_relationship.consistency` to `consistent` only when the
unique relationship is supported and the available evidence establishes
explicit close-on-integration intent. Use `needs-clarification` for a
keyword-only or contextually uncertain link, `inconsistent` for conflicting
targets or a relationship that does not match the selected issue, and
`not-applicable` only when no closing relationship is claimed.

## Issue and acceptance criteria assessment

Preserve the exact issue title, state, state reason, and source evidence.
Extract only explicit, independently identifiable acceptance criteria from the
issue body (for example, a heading named “Acceptance Criteria”, checklist
items, or explicit Given/When/Then conditions). Do not convert goals,
background, labels, or a closed state into criteria.

For each criterion:

1. Preserve its text and source location or source field.
2. Compare it with current PR description, changed diff, commits, and supplied
   SHA-bound validation evidence.
3. Mark it `covered` only when the evidence directly demonstrates the
   criterion, `partially-covered` when only part is demonstrated,
   `not-covered` when current evidence contradicts or omits it, and
   `unverifiable` when the available evidence cannot establish the result.

An issue being closed, a `Fixes` keyword, a successful check, or a commit
message alone does not prove criterion coverage. If the issue has no explicit
criteria, return `acceptance_criteria.status: absent` and record that as an
evidence gap. If the issue or relevant body is unavailable, use `unavailable`.

## Deterministic result

Return exactly one `LinkedIssueStatusAssessment`:

- `consistent`: exact current identity, unique linked issue, issue state and
  closing relationship are compatible, and every explicit criterion is covered
  by current evidence.
- `needs-attention`: the relationship is established but a criterion is
  partially covered or unverifiable, criteria are absent, or closing intent is
  keyword-only and requires confirmation.
- `inconsistent`: confirmed conflicting closing targets, a relationship to a
  different issue, a closed/open state contradiction relevant to the stated
  integration objective, or a criterion is explicitly not covered.
- `blocked`: exact PR or required issue evidence cannot be loaded, identity or
  head evidence is stale/ambiguous, authentication is unavailable, or the
  unique issue cannot be established.

Keep confirmed blockers separate from `uncertainties`. Every blocker must
include observable evidence and a concrete impact. A missing requirement is
not a confirmed defect; report it as `needs-attention` or an uncertainty unless
the supplied workflow explicitly requires it.

## Output requirements

Include:

- exact PR identity and current head SHA;
- every candidate and the selected issue, or the reason selection was withheld;
- issue status and exact issue evidence;
- every extracted criterion with source, coverage, evidence, and gaps;
- closing keyword and GitHub relationship evidence separately;
- integration status, blockers, uncertainties, rationale, and recommended next
  diagnostic skill;
- `failure: null` for successful `consistent`, `needs-attention`,
  `inconsistent`, `ambiguous`, or `unresolved` assessments unless an
  operational failure occurred.

Use `recommended_next_skill: assess-merge-readiness` only when the assessment
is complete and identity-bound; otherwise use `null`. This is advisory and
never invokes or authorizes another workflow.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository or PR number is absent and cannot be clarified. | `blocked` |
| `invalid_pull_request_number` | The PR number is not a positive integer. | `blocked` |
| `pull_request_not_found` | The exact PR cannot be loaded. | `blocked` |
| `issue_not_found` | The unique selected issue cannot be loaded. | `blocked` |
| `inaccessible` | Required GitHub content is not accessible. | `blocked` |
| `auth_unavailable` | GitHub authentication is absent or unusable. | `blocked` |
| `stale_head` | Supplied evidence does not match the current head SHA. | `blocked`; refresh |
| `api_failure` | A required read-only request fails. | `blocked` |

## Compact examples

Unique linked issue with all criteria evidenced:

```yaml
schema: LinkedIssueStatusAssessment
version: 1
status: consistent
repository: octo-org/widgets
pull_request: {number: 42, url: https://github.com/octo-org/widgets/pull/42, state: open}
head_sha: abc123
linkage:
  status: linked
  primary_issue: {repository: octo-org/widgets, number: 17, url: https://github.com/octo-org/widgets/issues/17, title: Preserve issue context}
  closing_relationship:
    status: confirmed
    consistency: consistent
    explicit_close_intent: true
    keyword_evidence: ["pull_request.body: Fixes #17"]
    github_evidence: ["closingIssuesReferences includes #17"]
    evidence: ["The PR body and GitHub relationship identify the same issue."]
  candidates: []
  evidence: ["LinkedIssue identifies exactly one linked candidate."]
issue: {status: loaded, repository: octo-org/widgets, number: 17, state: open, state_reason: null, title: Preserve issue context, evidence: ["gh issue view returned state=open"]}
acceptance_criteria:
  status: complete
  items:
    - {id: AC-1, text: "Preserve issue context", source: "issue.body: Acceptance Criteria", coverage: covered, evidence: ["PR diff demonstrates the requested behavior"], gap: null}
  evidence: ["The only explicit criterion is covered by current PR evidence."]
integration: {status: consistent, issue_pr_relationship: consistent, rationale: "The exact issue, closing relationship, and criterion evidence agree.", recommended_action: null}
blockers: []
uncertainties: []
evidence: {status: complete, sources: []}
rationale: The current pull request and uniquely linked issue are consistent for diagnostic integration review.
recommended_next_skill: assess-merge-readiness
failure: null
```

Ambiguous closing targets must leave `primary_issue` null, return
`status: blocked`, list every candidate, and request clarification. Never load
or select the issue merely because it is the only one mentioned.
