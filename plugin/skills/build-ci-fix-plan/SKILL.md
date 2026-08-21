---
name: build-ci-fix-plan
description: Build one host-neutral version-1 PullRequestFixPlan with source_kind ci from current failed required checks after interactively confirming which failures to fix on the existing pull-request head.
---

# Build CI-Fix Plan

Build exactly one version-1 `PullRequestFixPlan` with `source_kind: ci` for
one verified pull request whose required checks remain red after wait and any
authorized rerun. This Skill is read-only: it never edits files, reruns
checks, attaches a worktree, commits, pushes, publishes a review, merges,
marks Ready-for-Review, or cleans up.

The confirmation is host-neutral chat or an equivalent policy gate and must
work on Cursor, Codex, and Claude without a host-specific Plan UI.

## Inputs and candidate rules

Required inputs are `LoadedPullRequest` v1, `PullRequestCheckInspection` v1,
and `RequiredCheckWait` v1 for the same repository, pull request, base
identity, and current head SHA. An optional `RequiredCheckRerun` records one
just-completed authorized rerun. Block on missing, stale, partial,
contradictory, or unavailable identity or policy evidence.

Set the common contract's top-level discriminator to `source_kind: ci`.
Represent every remaining failed or missing required check as a
`candidate_kind: required_check_failure` and preserve its check name(s), wait
references, rerun references, run IDs, failure evidence, required flag, and
reassessment requirement. Do not flatten wait or rerun evidence into a
generic review candidate. Optional checks, pending checks, skipped checks
unless proven required and failed closed, resolved checks, and unauthorized
names are never fix candidates.

Incomplete or uncertain items remain `clarify` and cannot become mandatory.
Every candidate records a stable ID, source references, problem and failure
evidence, impact, bounded correction, success criteria, scope, risk, and
decision state. `validation.reassessment_required` and the source variant's
`reassessment_required` remain true whenever current checks must be reloaded
after a fix or push.

## Interactive confirmation

Present candidates in deterministic order and request exactly one decision:

- `fix` — add the candidate ID to `selection.mandatory_item_ids`;
- `skip` — add it to `selection.excluded_item_ids` with a reason; or
- `clarify` — add it to `selection.clarify_item_ids`, preserve the unresolved
  question, and stop before implementation.

Use a target-repository policy only when it clearly authorizes the exact
decision and scope; otherwise ask the user. Never infer `fix` from severity,
a failed check, or a model recommendation. Reuse prior decisions only when
repository, PR, base, head, check name, problem core, and scope match exactly.

## Output and verification

Return one `PullRequestFixPlan v1` with `source_kind: ci`, exact
repository/PR/base/head identity, tagged check-failure candidates, selection,
path scope, implementation steps, capabilities, workspace, authorization,
blockers/questions, tests/checks, reassessment, risks, rollback, metadata, and
failure state.

Authorization may cover waiting, exact required-check reruns, existing-head
worktree attachment/reuse, one local commit, and one non-force push. Explicitly
exclude review publication, thread reply/resolve, second PR creation,
Ready-for-Review, rebase, merge, force-push, deletion, cleanup, and
default-branch writes. Optional checks never become mandatory authorization or
validation requirements.

Status is `confirmed` only when decisions are resolved and no blocker or
`clarify` item remains; otherwise use `partial` or `blocked`. An empty
mandatory set is a valid confirmed plan and means reassess checks without a
delivery. A legacy `CiFixPlan v1` can enter only through the common contract's
explicit lossless adapter; missing fields, stale check evidence, mixed heads,
optional-to-required drift, or a source-kind conflict produce `blocked`.

Before returning, validate the common v1 schema, exact identity, source-kind
and candidate-variant mapping, lossless wait/rerun/failure evidence, absence
of clarify or unclear candidates from the mandatory set, scope traceability,
reassessment requirement, authorization limits, forbidden-operation list, and
explicit limitations. Recommend `create-worktree` only for a confirmed plan
with mandatory IDs. Never claim implementation, commit, push, or completion.
