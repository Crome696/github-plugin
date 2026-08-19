---
name: build-review-fix-plan
description: Build one host-neutral version-1 ReviewFixPlan from current pull-request findings and open feedback after interactively confirming mandatory fixes.
---

# Build Review-Fix Plan

Build exactly one version-1 `ReviewFixPlan` for one verified pull request.
This Skill is read-only: it never edits files, attaches a worktree, commits,
pushes, publishes a review, changes a discussion, creates a pull request,
rebases, merges, or cleans up.

The confirmation is host-neutral chat or an equivalent policy gate and must
work on Cursor, Codex, and Claude without a host-specific Plan UI.

## Inputs and candidate rules

Required inputs are `LoadedPullRequest` version 1,
`ClassifiedReviewFindings` version 1, and `ClassifiedReviewFeedback` version 1
for the same repository, pull request, branch, and current head SHA. Prior
plans and repository policy are optional. Block on missing, stale, partial,
contradictory, or unavailable identity or evidence.

Keep only current diff findings with a smallest correct location, observable
impact, evidence-backed severity/confidence, and actionable correction, plus
open feedback and explicitly required failed checks. Exclude resolved,
outdated, addressed, duplicate, optional, and unsupported items. Deduplicate
by problem core and causal mechanism while preserving sources. Incomplete or
uncertain items remain `clarify` and cannot become mandatory.

Each candidate records a stable ID, source references, location or check,
observed behavior, impact, severity, confidence, correction, success
criterion, scope, risk, and decision state.

## Interactive confirmation

Present candidates in deterministic order and request exactly one decision:

- `fix` — add the candidate to `mandatory_item_ids`;
- `skip` — add it to `excluded_item_ids` with a reason; or
- `clarify` — preserve the unresolved question and stop before implementation.

Use a target-repository policy only when it clearly authorizes the exact
decision and scope; otherwise ask the user. Never infer `fix` from severity,
confidence, a failed check, a model recommendation, or a prior approval.
Reuse prior decisions only when repository, PR, head, problem core, and scope
match exactly. New items require a new decision; fixed items require current
resolution evidence.

## Output and verification

Return one `ReviewFixPlan` with exact PR/head identity, candidate decisions,
mandatory/excluded IDs, blockers/questions, path scope, implementation steps,
capabilities, existing-head worktree operation, tests/checks, re-review
requirement, risks, rollback, metadata, and task identity `pr:<number>`.

Authorization may cover only existing-head worktree attachment/reuse, one
local commit, and one non-force push. Explicitly exclude review publication,
thread reply/resolve, second PR creation, Ready-for-Review, rebase, merge,
force-push, deletion, cleanup, and default-branch writes.

Status is `confirmed` only when decisions are resolved and no blocker or
`clarify` remains; otherwise use `partial` or `blocked` as applicable. An
empty mandatory set is a valid confirmed plan and means re-review without
delivery.

Before returning, validate the version-1 schema, exact identity, candidate
decision mapping, absence of `clarify` in mandatory IDs, scope traceability,
`pr:<number>` authorization, forbidden-operation list, and explicit
limitations. Recommend `create-worktree` only for a confirmed plan with
mandatory IDs. Never claim implementation, commit, push, or completion.
