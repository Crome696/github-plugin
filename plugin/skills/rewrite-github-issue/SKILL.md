---
name: rewrite-github-issue
description: Draft one concise English GitHub issue specification from a complete ProductInterview v2 with goals, non-goals, acceptance criteria, and label hygiene for task-scoped publication. Use automatically after the canonical interview; use rewrite-issue for a direct text-only rewrite and compose-product-sub-issues for the complete set of atomic sub-issue drafts.
---

# Rewrite GitHub Issues

Turn an underspecified GitHub issue into a validated, actionable specification
without silently inventing product decisions.

This Skill is the behavioral source of truth for the rewrite-drafting stage
of `issue-agent` mode `refine`. `conduct-product-interview` owns the only
adaptive product interview and produces the required version-2
`ProductInterview`.
`identify-product-capabilities` owns the hierarchical Capability Map when a
version-1 `ProductCapabilityMap` is supplied.
`decompose-product-capabilities` owns the atomic units when a version-1
`ProductCapabilityDecomposition` is supplied.
`assess-issue-atomicity` owns the classification of those units when a
version-1 `IssueAtomicityAssessment` is supplied.
`build-product-dependency-graph` owns evidenced product and mandatory
technical dependencies when a version-1 `ProductDependencyGraph` is
supplied.
`prioritize-product-issues` owns confirmed MoSCoW ranking when a version-1
`ProductIssuePrioritization` is supplied. This Skill prepares the exact
revision handoff; the Agent selects the mode, owns the surrounding
orchestration, and hands publication to `create-github-issue`. It drafts one
selected slice only; `compose-product-sub-issues` owns the separate
composition of a complete sub-issue draft set.

## Guardrails

- Match chat, questions, and explanations to the user's conversation language.
- Write the issue title, body, labels, and other durable GitHub artifacts in
  English unless the user explicitly requests another language for that
  artifact.
- Require one matching `ProductInterview` version 2. Consume its
  `confirmed_decisions` as the only product-decision source for the rewrite.
  Keep `assumptions`, `accepted_uncertainties`, and `open_questions` from
  being treated as locked requirements. A `blocked` or `needs_clarification`
  interview does not authorize a rewrite.
- When a version-1 `ProductCapabilityMap` is supplied, consume it as optional
  grouping output. Draft only the selected independently valuable capability
  slice unless a version-1 `ProductCapabilityDecomposition` is also supplied.
  Keep unselected capabilities as explicit non-goals or follow-up,
  and do not pack them into one compound rewrite. A `blocked` map does not
  authorize a rewrite. A `partial` map continues only when remaining gaps
  cannot change the selected slice.
- When a version-1 `ProductCapabilityDecomposition` is supplied, consume it
  as optional atomic-unit output. Draft only the selected unit. Keep
  unselected units as explicit non-goals or follow-up, and do not pack them
  into one compound rewrite. A `blocked` decomposition does not authorize a
  rewrite. A `partial` decomposition continues only when remaining gaps
  cannot change the selected slice.
- When a version-1 `IssueAtomicityAssessment` is supplied, consume it as
  optional atomicity output. Draft only a selected unit classified
  `atomic-enough`. If the selected unit is `too-large` or
  `over-fragmented`, show the `better_cut` and do not draft a compound or
  technical-only issue. A `blocked` assessment does not authorize a rewrite.
  A `partial` assessment continues only when remaining gaps cannot change
  the selected slice.
- When a version-1 `ProductDependencyGraph` is supplied, consume it as
  optional dependency output. Record evidenced `blocks`, `requires`,
  `enables`, and `related` relations for the selected unit. Do not pack
  sibling units into one rewrite, and do not choose the selected slice
  solely from technical graph order. A `blocked` graph does not authorize
  a rewrite. A `partial` graph continues only when remaining gaps cannot
  change the selected slice.
- When a version-1 `ProductIssuePrioritization` is supplied, consume it as
  optional ranking output. Draft only the confirmed `selected_unit_id`, or
  one eligible unit whose class the user explicitly chose for this run.
  An unconfirmed `recommended_class` does not authorize a rewrite. A
  `blocked` ranking does not authorize a rewrite. A `partial` ranking
  continues only when remaining gaps cannot change the selected slice.
- When a ProductInterview is missing, incomplete, unsupported, or mismatched,
  return the typed [`ProductInterviewPrerequisite`](../../shared/schemas/ProductInterviewPrerequisite.yaml)
  and do not use a ProductAssessment as a replacement interview.
- Use [rewrite-issue](../rewrite-issue/SKILL.md) for a direct text-only rewrite
  that returns the rewritten issue and a change summary without an interview,
  approval gate, or publication handoff.
- Do not edit GitHub from this Skill. Hand an exact, validated `IssueDraft`
  with task-scoped authorization to
  [create-github-issue](../create-github-issue/SKILL.md) for publication.
- When used by `issue-agent` in `refine` mode, start from its verified
  `LoadedIssue` or an explicitly verified repository and issue target passed by
  the Agent. Never infer that identity from the open workspace, current branch,
  search results, or issue text, and return an edit-mode handoff for that same
  issue.
- For an approved partial field update or metadata-only change, use
  [update-github-issue](../update-github-issue/SKILL.md) instead of producing
  a full rewrite.
- Never silently change labels. Propose label additions or removals and apply
  only the approved changes.
- Apply [`product-decomposition-policy.mdc`](../../rules/product-decomposition-policy.mdc).
  Do not rewrite a too-large product issue into one still-compound
  specification. Propose nearly atomic sub-issues and refine only the selected
  slice.

## Workflow

### 1. Inspect the issue and repository

For a standalone invocation, identify the repository and issue number from an
explicit `owner/repository` plus issue number or a canonical GitHub issue URL.
If the target cannot be determined, return a blocked result with the required
source identity. When invoked by `issue-agent` in `refine` mode, consume the
verified `LoadedIssue` or explicit target supplied by the Agent; do not use the
open workspace or current branch as an identity fallback.

Read the issue before drafting:

```text
gh issue view <number> --repo <owner>/<repo> --json title,body,labels,state,comments,url
```

Read only the thin repository context needed to understand the issue, usually
the README, relevant architecture or contribution docs, and nearby code. Do
not turn a simple issue rewrite into a broad repository audit.

When `issue-agent` refine mode or the caller supplies a version-2
`ProductInterview` for the same issue, use it as the locked interview record
and consume it as the mandatory source for step 2. When a version-1
`ProductCapabilityMap` is supplied for that
issue, use it to select the independently valuable slice to draft. When a
version-1 `ProductCapabilityDecomposition` is supplied for that issue, draft
only the selected atomic unit. When a version-1 `IssueAtomicityAssessment`
is supplied for that issue, draft only a selected unit classified
`atomic-enough`. When a version-1 `ProductDependencyGraph` is supplied for
that issue, record its evidenced dependencies for the selected unit and
do not rank slices by technical order. When a version-1
`ProductIssuePrioritization` is supplied for that issue, draft only the
confirmed `selected_unit_id` or an explicitly chosen eligible unit; do
not treat an unconfirmed recommendation as the selected slice. When the
ProductInterview is missing, incomplete, unsupported, or mismatched, return
the typed [`ProductInterviewPrerequisite`](../../shared/schemas/ProductInterviewPrerequisite.yaml)
and do not use a ProductAssessment or live issue text as a replacement
interview.

### 2. Consume the canonical decisions

Require a complete `ProductInterview` version 2. If that record is
`needs_clarification` or `blocked`, do not draft until a complete interview
arrives. Map only `confirmed_decisions` into the rewrite. Preserve
`assumptions`, `accepted_uncertainties`, and `open_questions` as non-confirmed
context.

Do not ask questions in this Skill. The canonical interview has already
handled these topics:

- Problem, outcome, and actors
- Use cases and current versus target behavior
- Business rules, variants, and edge cases
- Priorities, dependencies, and constraints
- Explicit out-of-scope work
- Acceptance criteria and verification
- Labels when the user requested label planning

Do not re-extract decisions from the live issue or ProductAssessment when that
would create a second elicitation path. If a decision is absent from
`confirmed_decisions`, keep it out of locked requirements and preserve the
canonical open or accepted-uncertainty record.

### 3. Lock and summarize the decisions

Before drafting, summarize the decisions in the user's conversation language.
Separate:

- Locked requirements
- Future context that explains the direction but is not part of this issue
- Explicit non-goals
- Assumptions that remain unconfirmed
- Open points that remain unresolved
- Explicitly accepted uncertainties, which remain non-requirements

If a remaining assumption or open point would materially change the rewrite,
return the canonical interview status or prerequisite instead of asking about
it here. Do not draft while a material product gap remains unaccepted and
undocumented.

### 4. Draft the English issue

Use an outcome-focused imperative title. Structure the body with the sections
that apply:

```markdown
## Summary

What should change and why.

## Product context (future — not in scope here)

Relevant future direction that constrains this work.

## Goals (this issue)

- Concrete deliverables

## Non-goals (this issue)

- Explicitly excluded work

## Suggested layout or implementation notes

Relevant structure, boundaries, or conventions.

## Acceptance criteria

- [ ] Observable condition that proves completion

## Tech decisions (locked)

- Decision and rationale where useful
```

Keep the issue specific enough to implement and review, but do not add
scaffolding, APIs, libraries, or platform variants that the user did not
choose. Mark future work as future context rather than mixing it into the
acceptance criteria.

### 5. Validate the exact draft and carry task authorization

Show the proposed title, body, and label changes. For a material rewrite, use
Plan mode when the host workflow requires a plan and use its completed Build as
the validated scope.

If that Build contains the exact title, complete body, and label operations,
set `approval.exact_payload: true`. Otherwise, validate the complete current
payload against the locked requirements and source issue, then set the same
flag. Continue without asking for a redundant chat confirmation. If the user
changes a material requirement, request a newly generated canonical
`ProductInterview` and re-run the comparison and quality checks before handing
off; retain the same task authorization when the issue and repository remain
unchanged.

When the invocation requests publication, set
`approval.publication_authorized: true`, record `source: task_intent`,
`task_scope`, and concise evidence. When it requests drafting only, keep the
publication flag false and do not hand off to a write workflow. The downstream
Skill still performs exact identity, payload, safety, write, and verification
checks.

### 6. Hand off the validated draft

Return the version 2 `IssueDraft` with the exact title, body, label operations,
verified repository, task authorization evidence, and the appropriate mode:

```text
no issue number -> mode: create
issue number -> mode: edit
```

Do not add a number or URL in create mode before publication. The
`create-github-issue` Skill writes the validated payload with `gh` and
performs post-publication verification without a redundant routine gate.

### 7. Keep publication separate

This Skill reports the approved handoff, not a published issue. Do not claim a
URL, external effect, or verification result until
`create-github-issue` has completed its own write and verification workflow.
