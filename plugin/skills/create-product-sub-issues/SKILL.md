---
name: create-product-sub-issues
description: Publish a fully approved product plan as GitHub sub-issues from confirmed drafts only, preserving priority, parent relationship, and documented dependencies without silently changing titles, bodies, or labels. Create every issue before finalizing relationships, continue remaining creates after a partial failure, prevent unintended duplicates on retry, and return the unit-id to issue-number/URL mapping plus failed operations. Use automatically after exact-set approval of a ProductPlannerRun, or when a user asks to publish approved product sub-issues.
---

# Create Product Sub-Issues

Publish one fully approved product plan as GitHub sub-issues. Create only
confirmed issue drafts, keep priority, parent relationship, and documented
hard dependencies, and do not silently change titles, bodies, or labels.
Create every approved issue before finalizing relationships. Handle partial
failures without rollback, prevent unintended duplicates on retry, and return
the plan-id mapping plus failed operations.

Consume one version-1 `ProductPlannerRun` and the exact approved version-2
`IssueDraft` set. Return one version-1 `ProductSubIssuePublication`. Delegate
each create write to
[`create-github-issue`](../create-github-issue/SKILL.md). Own the batch
orchestration, duplicate preflight, and relationship finalization.

`issue-agent` remains the one-issue publisher. This Skill publishes a
multi-issue product-plan set after exact-set approval.

## Boundaries

- Match questions, explanations, and status updates to the conversation
  language.
- Keep GitHub titles, bodies, labels, and the persisted handoff in English
  unless the user explicitly overrides the artifact language.
- Require `ProductPlannerRun.authorization.publication_authorized: true`,
  `exact_payload: true`, and matching `IssueDraft` approval flags for the
  exact current set.
- Announce the batch create immediately before the first external write. This
  is an execution announcement, not a new approval prompt.
- Apply only confirmed MoSCoW classes `must`, `should`, `could`, or `later`.
  Preserve `too-large`, `over-fragmented`, and `unconfirmed` units in
  `omitted_units`.
- Copy the approved title, body, and label operations unchanged. Do not invent
  priority labels, rewrite parent text, or replace unit IDs with issue numbers.
- Never overwrite, close, relabel, or replace the parent issue.
- Never change issue state, assignees, milestones, projects, issue type,
  comments, repository settings, or unrelated metadata.
- Do not roll back a successful create. Do not stop remaining creates after one
  failure.
- Apply [`github-evidence.mdc`](../../rules/github-evidence.mdc),
  [`github-safety.mdc`](../../rules/github-safety.mdc), and
  [`interactive-approval.mdc`](../../rules/interactive-approval.mdc).
- Never read or expose secrets, credentials, private keys, `.env` contents, or
  unnecessary issue comments.

## Input contract

The required inputs are:

```yaml
product_planner_run:
  schema: ProductPlannerRun
  version: 1
  status: drafts_ready | publication_handed_off | partial
approved_set:
  - unit_id: unit-export-csv
    issue_draft:
      schema: IssueDraft
      version: 2
      status: approved
      mode: create
      approval:
        exact_payload: true
        publication_authorized: true
```

Validate before any write:

- The run identifies one `owner/repository` and one parent issue number/URL.
- Every `IssueDraft.issue.repository` matches the run repository.
- Every draft `mode` is `create`, with `issue.number` and `issue.url` null
  unless a previous verified mapping already recorded that unit.
- `approval.exact_payload` and `approval.publication_authorized` are true on
  the run and on every draft in the exact set.
- Each `unit_id` in the approved set matches exactly one run draft with
  `confirmed_class` in `must`, `should`, `could`, or `later`.
- Draft titles match the paired run draft titles exactly.
- Identities across the run, drafts, and parent URL agree.

Reject missing, malformed, unsupported-version, identity-mismatched, unapproved,
parent-overwrite, or unconfirmed inputs with `status: blocked` and no write.

## Workflow

### 1. Validate the exact set

Copy parent identity, authorization, omitted units, and source evidence into
the result without normalizing missing values.

If a required input is absent, blocked, unsupported, or identity-mismatched,
return:

- `status: blocked`
- empty `mapping`
- `failure.code` of `missing_input`, `invalid_input`, `unsupported_version`,
  `identity_mismatch`, `approval_missing`, `unconfirmed_unit`,
  `parent_overwrite_forbidden`, or `blocked_source`

Do not treat orchestration authorization as publication authorization.

### 2. Deduplicate against live GitHub

Before any create, inspect live GitHub for already published members of this
exact set:

1. When the run already records `drafts[].issue_number`, view that issue and
   reuse it only when repository, number, and exact title match.
2. List current sub-issues of the parent. Reuse a unique exact-title match.
3. If two or more live issues share the exact approved title, record
   `failed_operations` with `code: duplicate_ambiguous` for that `unit_id`.
   Do not create and do not hijack an issue.

Record reused issues in `mapping` with `operation: reused`.

### 3. Create every remaining approved issue

Announce the batch:

```text
Publishing N approved sub-issues in owner/repository for parent issue 123.
Do not overwrite the parent. Relationship writes wait until every create has
been attempted.
```

For each remaining `unit_id`, apply
[`create-github-issue`](../create-github-issue/SKILL.md) once with the exact
approved `IssueDraft`. Do not alter title, body, or labels. Do not add
priority labels that the draft did not already approve.

If one create is `partial` or `blocked`, preserve that result in
`failed_operations` with `phase: create`, keep successful creates, and continue
the remaining units. Never roll back.

Capture the returned issue number and URL from CLI evidence only. Do not
fabricate identifiers.

### 4. Finalize relationships after every create attempt

Start this phase only after every approved unit has been created, reused, or
recorded as a failed create.

**Parent links.** For each mapped issue, read its numeric `id` and add it as a
sub-issue of the parent when the pair is not already linked:

```text
gh issue view <child-number> --repo <owner>/<repo> --json id,number,url,title
gh api repos/<owner>/<repo>/issues/<parent-number>/sub_issues -f sub_issue_id=<id>
```

Already linked pairs are `status: reused`. Skip units with no verified mapping
(`status: skipped`). API or feature gaps become `failed_operations` with
`phase: parent_link` and `code: parent_link_failure`.

**Hard dependencies.** Use only documented `blocks` and `requires` from the
run draft `traceability.hard_predecessors` or the matching graph evidence. A
`requires` edge from the current unit to B, or a `blocks` edge from B to the
current unit, makes the current issue `blocked_by` B:

```text
gh api repos/<owner>/<repo>/issues/<current-number>/dependencies/blocked_by -f issue_id=<predecessor-id>
```

Do not emit inverse edges. Do not treat `enables` or `related` as blockers.
Skip a dependency when either side lacks a verified mapping. Already linked
hard dependencies are `reused`.

Do not edit titles, bodies, or labels while linking relationships.

### 5. Select status

- `published` — every approved confirmed unit is in `mapping` as `created` or
  `reused`, every parent link is `linked` or `reused`, every hard dependency is
  `linked` or `reused`, `failed_operations` is empty, and `failure` is null.
- `partial` — at least one external create or relationship write occurred, but
  a later create, link, or verification did not complete.
- `blocked` — no external write occurred.

A retry of the same repository, parent, and exact set reuses verified mapping
entries and only attempts missing creates and missing links.

## Output contract

First give a concise summary in the conversation language. Then return one
English version-1 `ProductSubIssuePublication` using the fields from
[`ProductSubIssuePublication`](../../shared/schemas/ProductSubIssuePublication.yaml):

```yaml
schema: ProductSubIssuePublication
version: 1
status: published
repository: octo-org/widgets
parent_issue:
  number: 123
  url: https://github.com/octo-org/widgets/issues/123
authorization:
  source: user_approval
  publication_authorized: true
  exact_payload: true
  exact_set: true
mapping:
  - unit_id: unit-export-csv
    issue_number: 201
    issue_url: https://github.com/octo-org/widgets/issues/201
    operation: created
relationships:
  parent_links:
    - unit_id: unit-export-csv
      status: linked
  dependencies: []
failed_operations: []
omitted_units: []
failure: null
```

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_input` | The run or exact approved draft set is absent. | `blocked`; write nothing. |
| `invalid_input` | Required fields, mode, or types are malformed. | `blocked`. |
| `unsupported_version` | A required handoff is not the supported version. | `blocked`. |
| `identity_mismatch` | Run, drafts, or parent URLs disagree. | `blocked`. |
| `approval_missing` | Exact-set or payload authorization is absent. | `blocked`. |
| `unconfirmed_unit` | A requested unit lacks a confirmed class. | Omit or `blocked` when no eligible draft remains. |
| `parent_overwrite_forbidden` | The request would edit or replace the parent. | `blocked`. |
| `duplicate_ambiguous` | Exact title matches more than one live issue. | Do not create; record the failed operation. |
| `create_failure` | `create-github-issue` returned partial or blocked. | Continue remaining creates; keep the mapping. |
| `parent_link_failure` | The sub-issue API failed or is unavailable. | Keep created issues; mark the link failed. |
| `dependency_failure` | A hard-dependency write failed or is unavailable. | Keep created issues; mark the dependency failed. |
| `verification_failure` | Live title, repository, or URL does not match. | Do not treat the unit as published. |
| `blocked_source` | The run cannot establish parent identity. | `blocked`. |

A failure message must not expose tokens, credentials, private keys, `.env`
contents, personal data, or unnecessary raw command output.
