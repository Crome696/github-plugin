---
name: compose-pr-description
description: Compose an evidence-backed English draft pull-request description from one verified GitHub issue, task-authorized ImplementationPlan, passed ValidationResult, and created CommitProposal. Use automatically when a committed implementation is ready for draft pull-request composition; never push, publish, or modify GitHub.
---

# Compose Pull Request Description

Compose exactly one version-1
[`PullRequestDraft`](../../shared/schemas/PullRequestDraft.yaml) from a
validated implementation and its verified commit. This Skill owns description
composition only. It does not push a branch or create a pull request. When the
supplied plan carries task-scoped routine delivery authorization, preserve that
authorization for the downstream `create-draft-pr` publication workflow
instead of resetting it or asking for a redundant gate.

## Boundaries

- Read only the supplied version-1 handoffs, bounded non-secret repository
  files, repository pull-request templates, and read-only Git metadata.
- Never run `git add`, `commit`, `push`, `reset`, `restore`, `clean`,
  `checkout`, `switch`, `rebase`, `merge`, hooks, tests, formatters,
  installers, `gh pr create`, or another change-producing command.
- Never edit files, the index, branches, worktrees, Git administrative state,
  or GitHub resources.
- Do not invoke another Skill automatically. Any suggested next operation is
  advisory and never invents authorization.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive command output.
- Keep the structured handoff, title, and body in English. Preserve source
  evidence accurately and do not translate or invent it.

## Required input

Accept exactly one set of these version-1 handoffs:

1. `LoadedIssue` with `status: loaded` or `status: partial`, a non-null
   `issue.repository`, `issue.number`, and `issue.url`, and a non-null title.
   The issue body may be unavailable; preserve that limitation and use only
   implementation evidence for the missing context.
2. `ImplementationPlan` with a non-blocked status, a non-empty objective,
   `workspace.base_branch`, and `workspace.branch_name`.
3. `ValidationResult` with `status: passed` and
   `readiness.draft_pr_preparation_allowed: true`.
4. `CommitProposal` with `status: created`, a non-null verified
   `commit.sha`, a non-empty `repository` and `branch`, a non-empty commit
   message subject, and the committed file scope.

The validation result must be usable for draft pull-request preparation.
Do not replace missing identity with the current checkout, a branch name
copied from an unrelated path, or an inferred repository. Do not run checks
again: `ValidationResult.checks` is the only source for executed validation
claims.

Accept these optional inputs when supplied:

- `BranchWorkspace` for repository, base-branch, branch, and head-SHA
  consistency.
- `BranchPush` for consistency evidence only. It does not authorize or
  require a push for composition.
- `RepositoryConventions` for an evidenced pull-request title or body
  convention.
- `PullRequestIssueLink` with `status: linked` for an already validated,
  unique issue relationship and keyword decision.

Validate every supplied handoff before using it. Accept only version 1,
preserve unavailable evidence, and keep the effective repository, issue,
base branch, head branch, and head SHA consistent across all inputs.

## Identity and scope checks

Before composing text, verify all of the following:

1. `LoadedIssue.issue.repository` equals `CommitProposal.repository`.
2. When `ImplementationPlan.issue.repository` is non-null, it equals the
   verified repository. `LoadedIssue.issue.number` equals
   `ImplementationPlan.issue.number`.
3. `CommitProposal.branch` equals `ImplementationPlan.workspace.branch_name`
   and `ValidationResult.workspace.branch`.
4. `CommitProposal.commit.sha` equals `ValidationResult.workspace.head_sha`.
5. `ImplementationPlan.workspace.base_branch` is the selected base branch.
6. If `BranchWorkspace` or `BranchPush` is supplied, its repository, branch,
   base branch, and available head SHA match the values above.
7. If `PullRequestIssueLink` is supplied, its repository, issue identity,
   pull-request repository, base branch, and head branch match the values
   above, and its `linked_issues` contains exactly the verified issue.

Any mismatch, missing required identity, unsupported version, blocked issue,
failed validation, false readiness flag, or unverified commit is a blocker.
Do not compose a plausible body for a blocked result.

## Repository pull-request templates

Inspect only the expected target repository, using this deterministic order:

1. `.github/PULL_REQUEST_TEMPLATE.md`
2. The lexicographically first non-empty file under
   `.github/PULL_REQUEST_TEMPLATE/`
3. `PULL_REQUEST_TEMPLATE.md`
4. `docs/pull_request_template.md`

Use the first readable candidate. If no candidate exists, use the standard
section structure below. Preserve an applicable template's headings, ordering,
and non-conflicting guidance. Add missing required sections without deleting
template content. Fill placeholders only with supplied evidence; never mark a
template checklist complete merely because a plan step exists. Record the
selected template path in `rationale` and `validation.evidence`. A missing
template is not a failure.

## Evidence rules

Use concise, reproducible references in `rationale` and
`validation.evidence`, such as:

- `handoff:LoadedIssue.issue.repository`
- `handoff:LoadedIssue.issue.number`
- `handoff:LoadedIssue.title`
- `handoff:ImplementationPlan.objective`
- `handoff:ImplementationPlan.implementation_steps[<id>]`
- `handoff:ImplementationPlan.out_of_scope`
- `handoff:ImplementationPlan.risks[<index>]`
- `handoff:ValidationResult.readiness.draft_pr_preparation_allowed`
- `handoff:ValidationResult.checks[<id>]`
- `handoff:ValidationResult.evaluation.documented_deviations[<path>]`
- `handoff:ValidationResult.warnings[<id>]`
- `handoff:CommitProposal.message.subject`
- `handoff:CommitProposal.commit.sha`
- `handoff:CommitProposal.commit.files_committed`
- `template:<repository-relative-path>`
- `git:commit:<sha>`

Use only evidence present in the supplied handoffs or readable repository
files. If evidence is unavailable, say so in the body or rationale instead
of filling the gap with a likely behavior, test, risk, or requirement.

## Compose the pull-request text

The body must contain these topics, either as the standard headings below or
under equivalent headings preserved from the selected template:

### Problem / issue context

Summarize the verified issue title and body without changing its intent. Use
the plan's `current_behavior` only when it is supplied as implementation
evidence. If the issue body is unavailable, state that limitation and do not
reconstruct it from assumptions.

### Solution summary

Describe the implemented outcome from `ImplementationPlan.objective`,
`desired_behavior`, and the created commit message. Do not claim behavior
that those sources do not support, and do not describe the workflow as the
solution.

### Key changes

List the completed plan steps supported by
`ValidationResult.evaluation.planned_steps` and the exact committed scope
from `CommitProposal.commit.files_committed` or `CommitProposal.files`.
Distinguish added, modified, and deleted paths when that classification is
available. Do not add paths found only in the issue or plan.

### Tests and validations

Render every `ValidationResult.checks` entry in order with its exact
`result` and available evidence:

- `pass` may be reported as passed.
- `fail` must remain failed and prevents a successful composition.
- `skipped` and `not_run` must be labeled explicitly and must include their
  supplied reason or evidence; never report them as passed.

Include `required_checks_passed` and relevant acceptance or completion
evidence. Do not claim that a test or command ran unless the corresponding
check says it ran and passed. If no test-specific check is supplied, say that
no test-specific execution is recorded rather than inferring one.

### Known limitations

Include only evidenced limitations from:

- `ImplementationPlan.out_of_scope`
- `ImplementationPlan.unresolved_questions`
- `ValidationResult.evaluation.documented_deviations`
- `ValidationResult.warnings`
- `ValidationResult.source.unavailable_inputs`
- unavailable fields in `LoadedIssue`

Keep unresolved questions and documented deviations explicit. Do not convert
an assumption, warning, or future idea into a completed capability.

### Risks

Include each `ImplementationPlan.risks` entry with its severity and
mitigation when present. Include a validation warning here only when its own
text explicitly describes a residual risk; otherwise keep it under Known
limitations. If no risk is recorded, state that no implementation risk was
recorded in the supplied handoffs.

### Issue linkage

Link exactly the verified issue in both the body and `linked_issues`. When a
validated `PullRequestIssueLink` is supplied, use its `keyword_text`,
`linkage_kind`, and exact `linked_issues` unchanged, and include its evidence
in `rationale` and `validation.evidence`. Its `repository`, issue identity,
and pull-request identity must match the current composition inputs.

Without a supplied link handoff, use the default closing relationship
`Fixes owner/repository#number` and include the verified issue URL when
available. Use `Refs` only when the supplied link handoff or an explicit
applicable repository convention or instruction establishes an opt-out from
closing the issue after the pull request merges; use `Closes` or `Resolves`
when that supplied evidence selects either keyword. Never infer a second issue
from prose, a branch, a filename, or a commit message.

## Compose the title

Create one concise English, outcome-focused title from the issue title,
implementation objective, and created commit subject. Prefer the most
specific behavior supported by all available evidence. Apply an explicitly
evidenced pull-request title convention when one exists. Do not add a
`[Draft]` prefix; draft state is represented by `draft: true`.

## Produce the draft

Return exactly one English object with `schema: PullRequestDraft` and
`version: 1`.

For a usable composition:

- Set `status: draft`.
- Set `repository` from the verified issue and commit identity.
- Set `number`, `url`, and `created_at` to `null`.
- Set `title` and `body` to the composed text.
- Set `base_branch` from `ImplementationPlan.workspace.base_branch`.
- Set `head_branch` from `CommitProposal.branch`.
- Set `head_sha` from the verified `CommitProposal.commit.sha`.
- Set `draft: true`.
- Set `linked_issues` to exactly the verified issue, preserving the supplied
  `PullRequestIssueLink.linked_issues` when that handoff is present and
  validated.
- Copy `ValidationResult.status` and evidence into `validation` without
  converting readiness into authorization.
- Copy the existing task-scoped routine authorization from
  `ImplementationPlan.authorization` into `authorization` when it covers the
  same repository, issue, branch, and delivery. Do not invent it from
  readiness alone. When no such authorization is supplied, set both flags to
  `false` and report the missing source.
- Set every `verification` field to `unknown` and explain that publication
  has not occurred.
- Set `rationale` to the selected template or default structure, title
  decision, issue-link decision (including the supplied
  `PullRequestIssueLink` evidence when present), evidence limitations, and
  identity checks.

Use `status: partial` when all required identities and content are defensible
but a material, non-blocking evidence gap remains, such as an unavailable
issue body. Use `status: blocked` when a required handoff, identity, verified
commit, readiness condition, or mandatory convention is missing or
contradictory. A blocked result must not contain an invented title, body,
issue link, branch, SHA, or repository.

## Output contract

```yaml
schema: PullRequestDraft
version: 1
status: draft
repository: owner/repository
number: null
url: null
title: "Add the documented workflow"
body: |
  ## Problem / issue context

  The issue requests a documented workflow for the repository.

  ## Solution summary

  Add the workflow documentation described by the implementation plan.

  ## Key changes

  - Added `docs/workflow.md`.
  - Completed the documented implementation step.

  ## Tests and validations

  - `repository-docs`: pass — evidence supplied by `ValidationResult`.
  - No test-specific execution is recorded in the supplied checks.

  ## Known limitations

  - No additional limitations were recorded in the supplied handoffs.

  ## Risks

  - No implementation risk was recorded in the supplied handoffs.

  ## Issue linkage

  Fixes owner/repository#123
linked_issues:
  - repository: owner/repository
    number: 123
base_branch: main
head_branch: agent/document-workflow
head_sha: 0123456789abcdef0123456789abcdef01234567
draft: true
validation:
  result_status: passed
  evidence:
    - handoff:ValidationResult.readiness.draft_pr_preparation_allowed
    - handoff:ValidationResult.checks[repository-docs]
authorization:
  push_authorized: true
  draft_pull_request_authorized: true
  source: task_intent
  task_scope: "owner/repository issue 123"
  evidence: "The current task authorization covers routine draft pull-request delivery."
verification:
  repository_match: unknown
  base_branch_match: unknown
  head_branch_match: unknown
  head_sha_match: unknown
  draft_state_match: unknown
  title_match: unknown
  body_match: unknown
  evidence:
    - Pull-request publication has not occurred.
created_at: null
rationale: >-
  Used the default required-section structure because no repository pull-request
  template was supplied. No validated opt-out was supplied, so the issue link
  uses the default Fixes relationship; identity and head-SHA checks are
  supported by the supplied handoffs.
```

For a blocked result, preserve the contract shape, use `status: blocked`,
empty required strings and lists where evidence is unavailable, set
`number`, `url`, `head_sha`, and `created_at` to `null`, set both
authorization flags to `false`, and explain the concrete failure in
`rationale` and `validation.evidence`. Never fabricate a pull-request URL or
number, and never add a `recommended_next_skill` field because it is not part
of `PullRequestDraft`.

## Failure checks

Block or return partial evidence for:

- missing, malformed, or unsupported required handoffs;
- a blocked or identity-incomplete issue;
- false or unavailable `ValidationResult.readiness.draft_pr_preparation_allowed`;
- a validation status other than `passed`;
- a commit proposal that is not `created`, lacks a verified SHA, or has
  missing committed scope;
- mismatched repository, issue, base branch, head branch, or head SHA;
- missing evidence for a required body topic or an unresolved mandatory
  pull-request convention;
- an issue link that cannot be verified; or
- a supplied `PullRequestIssueLink` that is not `linked`, identifies another
  issue, or contains a mismatched repository, branch, or keyword decision; or
- confidential data in any proposed title, body, or evidence.

Do not turn a blocked or partial result into `draft` merely because a
plausible title or body can be guessed. Do not push, create, publish, or
verify a pull request in this Skill.
