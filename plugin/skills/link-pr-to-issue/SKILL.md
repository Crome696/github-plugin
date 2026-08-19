---
name: link-pr-to-issue
description: Establish one unambiguous, evidence-backed relationship between one Draft pull request and one GitHub issue, selecting the default closing keyword or an explicit neutral opt-out from verified intent and repository conventions. Use automatically when a Draft pull request needs issue linkage; never force an ambiguous target, mutate GitHub, or close an issue.
---

# Link Pull Request to Issue

Produce exactly one version-1
[`PullRequestIssueLink`](../../shared/schemas/PullRequestIssueLink.yaml)
handoff for one Draft pull request and one verified GitHub issue. This Skill
owns relationship validation and keyword selection only. It does not edit a
pull-request body. The downstream publication workflow consumes a successful
handoff; `compose-pr-description` consumes it only when the validated
relationship requires a bounded recompose.

## Boundaries

- Read only the supplied version-1 handoffs, bounded repository-convention
  evidence, and the supplied pull-request body.
- Never run `gh issue close`, `gh pr merge`, `gh pr ready`, `gh pr edit`,
  `gh pr create`, or any other GitHub write.
- Never edit files, Git state, a pull-request body, issue metadata, issue state,
  branches, or worktrees.
- Do not invoke another Skill automatically. `recommended_next_skill` is
  advisory and never authorizes or invokes a follow-up.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive command output.
- Keep the structured handoff and authored rationale in English. Preserve
  supplied evidence accurately and do not invent issue requirements or
  closing intent.

## Required input

Accept exactly one set of these version-1 handoffs:

1. `LoadedIssue` with `status: loaded` or `status: partial`, a non-null
   `issue.repository`, `issue.number`, `issue.url`, and title.
2. `PullRequestDraft` with `status: draft`, `created`, `verified`, or
   `partial`, `draft: true`, a non-empty `repository`, `base_branch`, and
   `head_branch`. A composition-only draft may have null `number`, `url`, and
   `head_sha`; do not replace them with inferred values.

The issue and pull-request repository must match. The issue number and URL
must identify the same repository issue. The pull request must remain a Draft;
an unknown or false `draft` value is a blocker.

Accept these optional inputs when supplied:

- `RepositoryConventions` version 1, but use only an explicit,
  non-conflicting convention that names pull-request issue-link or
  close-on-merge behavior. A convention that explicitly requires neutral
  references or forbids close-on-merge is an opt-out from the default.
- `closing_intent`, an explicit task or issue decision with
  `should_close_on_merge: true|false`, a source, and reproducible evidence.
  A true decision must mean closure after the pull request merges into the
  repository's default branch.
  A supplied `false` decision is an explicit opt-out and overrides a generic
  closing convention.
- A `PullRequestDraft.body` and `linked_issues` for consistency checks. They
  are evidence of existing content, not permission to edit it.

Validate every supplied handoff before using it. Accept only version 1,
preserve unavailable evidence, and never replace a missing value with one
inferred from the branch name, filename, commit message, title, or prose.

## Establish the unique issue relationship

Use the `LoadedIssue` identity as the only intended target:

1. Compare `LoadedIssue.issue.repository` with `PullRequestDraft.repository`.
2. Compare the loaded issue's repository and number with every entry in
   `PullRequestDraft.linked_issues`, when present.
3. Inspect explicit GitHub issue references in the supplied body, including
   `owner/repository#number`, full issue URLs, and references in the issue
   linkage section. A reference to the loaded issue is consistent evidence.
4. Treat a reference to any other issue, a second linked-issue entry, or a
   repository mismatch as an unresolved candidate. Return `ambiguous` with
   `ambiguous_candidates`; do not choose the issue that appears most likely.
5. Treat an explicit closing reference for the loaded issue as a separate
   closing-intent signal. It must agree with the selected close-on-merge
   decision. GitHub applies that closing behavior when the pull request merges
   into the repository's default branch.
6. Do not treat a bare issue number, a branch name, a filename, a commit
   message, or unstructured prose as proof of a relationship. If no
   contradictory explicit reference exists, the verified `LoadedIssue` is the
   sole target.

Return `blocked` for missing or malformed identity, unsupported versions,
repository mismatch, a non-Draft pull request, or a conflicting
`linked_issues` value. Return `ambiguous` when more than one issue candidate
remains. Do not return a usable `linked` result in either case.

## Select the relationship kind

The closing relationship is the default:

```text
Fixes owner/repository#123
```

Use the neutral `Refs` relationship only when an explicit opt-out establishes
that the verified issue should remain open after the pull request merges into
the repository's default branch. Otherwise use a GitHub closing keyword:

GitHub's supported closing-keyword forms and default-branch behavior are
documented at
<https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue>.

1. An explicit `closing_intent.should_close_on_merge: false` is sufficient
   opt-out. An explicit, applicable repository convention that selects neutral
   references is also sufficient.
2. An explicit `closing_intent.should_close_on_merge: true` or a convention
   that requires close-on-merge may select `Fixes`, `Closes`, or `Resolves`.
   Normalize an unsupported or missing keyword preference to canonical
   `Fixes`.
3. When no opt-out is supplied, use canonical `Fixes`. The absence of an
   explicit intent is not an opt-out.
4. If the supplied body contains `Refs` without an explicit opt-out, keep the
   validated relationship as `Fixes` and recommend one bounded
   `compose-pr-description` recompose; do not treat the existing body as
   evidence of an opt-out.
5. If the supplied body contains `Fixes`, `Closes`, or `Resolves` while an
   explicit opt-out is present, return `blocked` with
   `closing_intent_unverified`. Never silently convert that content to `Refs`.

Use these canonical output values:

| `linkage_kind` | Body prefix | `closes_issue_on_merge` |
| --- | --- | --- |
| `refs` | `Refs` | `false` |
| `fixes` | `Fixes` | `true` |
| `closes` | `Closes` | `true` |
| `resolves` | `Resolves` | `true` |

The `keyword_text` must contain the verified repository and issue number, for
example `Fixes owner/repository#123`. Record the exact intent or convention
evidence and explain why a closing keyword was or was not selected.

## Produce the handoff

Return exactly one English object with `schema: PullRequestIssueLink` and
`version: 1`.

For a unique, usable relationship:

- Set `status: linked`.
- Copy the verified repository, issue identity, and Draft pull-request
  identity without inventing publication values.
- Set `linkage_kind`, `closes_issue_on_merge`, and `keyword_text` from the
  decision above.
- Set `linked_issues` to exactly the verified issue.
- Include reproducible `evidence` references to the source handoffs, body
  checks, and closing-intent or convention decision.
- Set `ambiguous_candidates` and `blockers` to empty lists, `failure` to
  `null`, and `recommended_next_skill` to `create-draft-pr` when the composed
  Draft body already matches the validated relationship. Recommend
  `compose-pr-description` when the exact validated relationship needs a
  bounded recompose before publication, including an old default `Refs` body
  without an explicit opt-out.

Use `status: partial` only when the exact relationship and keyword are
defensible but a material, non-blocking source limitation remains. Preserve
that limitation in `evidence` and `rationale`; downstream consumers must not
present it as complete verification.

Use `status: ambiguous` when multiple issue candidates or contradictory issue
references prevent a unique target. Use `status: blocked` when a required
identity, Draft state, supported version, or close-on-merge decision is
contradictory. For both statuses, set `keyword_text` and
`linkage_kind` to `null`, keep `linked_issues` empty unless the contract
explicitly preserves a verified single candidate for partial diagnostics, and
never fabricate a closing decision.

## Output contract

```yaml
schema: PullRequestIssueLink
version: 1
status: linked
repository: owner/repository
issue:
  repository: owner/repository
  number: 123
  url: https://github.com/owner/repository/issues/123
  title: "Document the workflow"
pull_request:
  repository: owner/repository
  number: null
  url: null
  head_sha: null
  base_branch: main
  head_branch: agent/document-workflow
  draft: true
linkage_kind: fixes
closes_issue_on_merge: true
keyword_text: "Fixes owner/repository#123"
linked_issues:
  - repository: owner/repository
    number: 123
evidence:
  - handoff:LoadedIssue.issue.repository
  - handoff:LoadedIssue.issue.number
  - handoff:PullRequestDraft.repository
  - handoff:PullRequestDraft.draft
  - decision:default-close-on-merge
rationale: >-
  The loaded issue and Draft pull request identify the same repository, and no
  competing issue reference or explicit close-on-merge opt-out was supplied.
  The default Fixes relationship was selected so the issue closes after a
  merge into the repository's default branch.
blockers: []
ambiguous_candidates: []
recommended_next_skill: create-draft-pr
failure: null
```

## Failure checks

Block or return an ambiguous result for:

- missing, malformed, unsupported, or identity-inconsistent handoffs;
- a pull request whose Draft state is false or unknown;
- multiple `linked_issues` entries or explicit references to another issue;
- an issue URL, repository, or number that does not match the loaded issue;
- a closing keyword that conflicts with an explicit close-on-merge opt-out or
  applicable repository convention;
- conflicting close-on-merge instructions or repository conventions;
- confidential data in the output or supplied evidence.

Never execute `gh issue close`, merge the pull request, mark it ready, edit
the body, or report that an issue was closed. This Skill only returns the
relationship kind, exact keyword text, and evidence for a separate workflow.
