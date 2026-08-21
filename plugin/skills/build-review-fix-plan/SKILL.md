---
name: build-review-fix-plan
description: Build one host-neutral version-1 PullRequestFixPlan with source_kind review from current pull-request findings and open feedback after interactively confirming mandatory fixes.
---

# Build Review-Fix Plan

Build exactly one version-1 `PullRequestFixPlan` with
`source_kind: review` for one verified pull request. This Skill is read-only:
it never edits files, attaches a worktree, commits, pushes, publishes a
review, changes a discussion, creates a pull request, rebases, merges, or
cleans up.

The confirmation is host-neutral chat or an equivalent policy gate and must
work on Cursor, Codex, and Claude without a host-specific Plan UI.

## Inputs and candidate rules

Required inputs are `LoadedPullRequest` v1, `ClassifiedReviewFindings` v1,
and `ClassifiedReviewFeedback` v1 for the same repository, pull request,
base identity, branch, and current head SHA. Prior plans and repository policy
are optional. Block on missing, stale, partial, contradictory, or unavailable
identity or evidence.

Set the common contract's top-level discriminator to `source_kind: review`.
Preserve review findings as `candidate_kind: review_finding`, including every
location, severity, confidence, source reference, evidence, and success
criterion. Preserve open review feedback as
`candidate_kind: review_feedback`, including feedback IDs, resolution-group
IDs, affected areas, dependencies, non-goals, and external handoffs. Do not
flatten either variant into the other. Required-check evidence may be
retained as supporting source evidence, but this builder does not turn it into
a `required_check_failure` candidate.

Keep only current diff findings with a smallest correct location, observable
impact, evidence-backed severity/confidence, and actionable correction, plus
open feedback explicitly in scope. Exclude resolved, outdated, addressed,
duplicate, optional, and unsupported items. Deduplicate by problem core and
causal mechanism while preserving every source reference. Incomplete or
uncertain items remain `clarify` and cannot become mandatory.

Every candidate records a stable ID, the tagged candidate kind, source
references, observed problem, evidence, impact, correction, decision state,
scope, risk, and its source-specific payload. The plan's PR, base, head,
scope, workspace, and authorization all bind to the same current head SHA.

## Interactive confirmation

Present candidates in deterministic order and request exactly one decision:

- `fix` — add the candidate ID to `selection.mandatory_item_ids`;
- `skip` — add it to `selection.excluded_item_ids` with a reason; or
- `clarify` — add it to `selection.clarify_item_ids`, preserve the unresolved
  question, and stop before implementation.

Use a target-repository policy only when it clearly authorizes the exact
decision and scope; otherwise ask the user. Never infer `fix` from severity,
confidence, a failed check, a model recommendation, or a prior approval.
Reuse prior decisions only when repository, PR, base, head, problem core, and
scope match exactly. New items require a new decision; fixed items require
current resolution evidence.

## Output and verification

Return one `PullRequestFixPlan v1` with `source_kind: review`, exact
repository/PR/base/head identity, tagged candidate decisions, selection,
common path scope, implementation steps, capabilities, workspace,
authorization, blockers/questions, tests/checks, re-review requirement,
risks, rollback, metadata, and failure state. Set
`validation.re_review_required` from the supplied review evidence. Keep
`validation.reassessment_required` false unless the source evidence
explicitly requires it.

Authorization may cover only the explicitly permitted existing-head worktree
operation, one local commit, and one non-force push. Explicitly exclude review
publication, thread reply/resolve, second PR creation, Ready-for-Review,
rebase, merge, force-push, deletion, cleanup, and default-branch writes.

Status is `confirmed` only when decisions are resolved and no blocker or
`clarify` item remains; otherwise use `partial` or `blocked` as applicable.
An empty mandatory set is a valid confirmed plan and means re-review without
delivery. A legacy `ReviewFixPlan v1` can enter only through the common
contract's explicit lossless adapter; missing fields, stale evidence, mixed
heads, or a source-kind conflict produce `blocked`.

Before returning, validate the common v1 schema, exact identity, source-kind
and candidate-variant mapping, lossless source evidence, absence of clarify or
unclear candidates from the mandatory set, scope traceability, authorization
limits, forbidden-operation list, and explicit limitations. Recommend
`create-worktree` only for a confirmed plan with mandatory IDs. Never claim
implementation, commit, push, or completion.
