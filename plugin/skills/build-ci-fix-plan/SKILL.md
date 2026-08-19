---
name: build-ci-fix-plan
description: Build one host-neutral version-1 CiFixPlan from current failed required checks after interactively confirming which failures to fix on the existing pull-request head.
---

# Build CI-Fix Plan

Build exactly one version-1 `CiFixPlan` for one verified pull request whose
required checks remain red after wait and any authorized rerun. This Skill is
read-only: it never edits files, reruns checks, attaches a worktree, commits,
pushes, publishes a review, merges, or marks Ready-for-Review.

The confirmation is host-neutral chat or an equivalent policy gate and must
work on Cursor, Codex, and Claude without a host-specific Plan UI.

## Inputs and candidate rules

Required inputs are `LoadedPullRequest` version 1, `PullRequestCheckInspection`
version 1, and `RequiredCheckWait` version 1 for the same repository, pull
request, and current head SHA. An optional `RequiredCheckRerun` may record a
just-completed authorized rerun. Block on missing, stale, partial,
contradictory, or unavailable identity or policy evidence.

Keep only current failed or missing **required** checks. Exclude optional
checks, pending checks (they are wait outcomes, not fix candidates), skipped
checks unless the inspection proves they are required and failed closed,
resolved checks, and unauthorized names. Incomplete or uncertain items remain
`clarify` and cannot become mandatory.

Each candidate records a stable ID, source `required_check` or `wait_outcome`,
check name, observed failure, impact, correction, success criterion, scope,
risk, and decision state.

## Interactive confirmation

Present candidates in deterministic order and request exactly one decision:

- `fix` — add the candidate to `mandatory_item_ids`;
- `skip` — add it to `excluded_item_ids` with a reason; or
- `clarify` — preserve the unresolved question and stop before implementation.

Use a target-repository policy only when it clearly authorizes the exact
decision and scope; otherwise ask the user. Never infer `fix` from severity,
a failed check, or a model recommendation. Reuse prior decisions only when
repository, PR, head, check name, problem core, and scope match exactly.

## Output and verification

Return one `CiFixPlan` with exact PR/head identity, candidate decisions,
mandatory/excluded IDs, blockers/questions, path scope, implementation steps,
capabilities, existing-head worktree operation, tests/checks, reassessment
requirement, risks, and task identity `pr:<number>`.

Authorization may cover wait, exact required-check rerun, existing-head
worktree attachment/reuse, one local commit, and one non-force push.
Explicitly exclude review publication, thread reply/resolve, second PR
creation, Ready-for-Review, rebase, merge, force-push, deletion, cleanup, and
default-branch writes.

Status is `confirmed` only when decisions are resolved and no blocker or
`clarify` remains; otherwise use `partial` or `blocked`. An empty mandatory
set is a valid confirmed plan and means reassess checks without delivery.

Before returning, validate the version-1 schema, exact identity, candidate
decision mapping, absence of `clarify` in mandatory IDs, scope traceability,
`pr:<number>` authorization, forbidden-operation list, and explicit
limitations. Recommend `create-worktree` only for a confirmed plan with
mandatory IDs. Never claim implementation, commit, push, or completion.
