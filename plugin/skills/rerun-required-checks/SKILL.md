---
name: rerun-required-checks
description: Rerun only exactly authorized failed required pull-request checks and verify new live run identities; never rerun optional checks, invent requirements, merge, or change local files.
disable-model-invocation: true
---

# Rerun Required Checks

Rerun exactly the authorized required status checks for one verified
pull-request head and return a version-1
[`RequiredCheckRerun`](../../shared/schemas/RequiredCheckRerun.yaml) result.
[inspect-pr-checks](../inspect-pr-checks/SKILL.md) remains read-only. This
Skill is the only GitHub write that may request a check rerun.

## Boundaries

- Operate on one exact pull request and current head SHA. Never search for a
  likely pull request.
- Rerun only check names that are both required in the current
  `PullRequestCheckInspection` and listed in
  `authorization.exact_check_names`. Unauthorized, optional, aliased, or
  case-folded names fail closed with no GitHub write.
- Never infer a required check from a workflow file, job display name, or
  branch name.
- Never merge, publish a review, request reviewers, mark Ready-for-Review,
  rebase, force-push, or edit local files.
- Do not retry an ambiguous write. Verify new run or job identities after the
  write. Missing or unchanged identities are `partial` or `blocked`.
- Keep structured fields in English.

## Required handoffs

Before any write require:

1. A version-1 `LoadedPullRequest` whose repository, number, URL, and head
   SHA match the selected pull request.
2. A version-1 `PullRequestCheckInspection` for that same head, produced
   directly by `inspect-pr-checks` (or one explicit post-wait refresh), with
   `requirements.status: known`.
3. An optional current `RequiredCheckWait` for the same head showing failed
   required outcomes. If absent, the inspection's failed required checks are
   the candidate set.
4. A version-1 `RequiredCheckRerun` intent with `status: approved`,
   `authorization.rerun_authorized: true`, and
   `authorization.exact_check_names` equal to `requested_checks`.

Authorization may come from the explicitly invoked `/auto-ci-fix-pr`
task-scoped record or a matching target-repository `AGENTS.md` policy that
names this repository, pull request, head SHA, rerun operation, and exact
check names. Routine delivery, review-fix, merge readiness, or green CI
never authorizes a rerun.

## Workflow

1. Validate identity. Stop when the live head SHA does not match the
   authorized head.
2. Resolve each requested name to an exact required check with a current
   failed check-run or commit-status identity. Reject optional checks and
   names with no exact required match.
3. Announce the exact GitHub effect, then rerun only those matched jobs or
   workflow runs through the authenticated GitHub CLI, for example
   `gh api --method POST repos/<owner>/<repo>/actions/jobs/<job_id>/rerun`
   or the equivalent failed-job rerun for a verified workflow run ID taken
   from the inspection. Do not rerun an entire repository workflow set.
4. Refresh live check evidence with `inspect-pr-checks` (invoked by the
   caller or immediately after the write for verification) and confirm each
   executed name has a new run or job identity. Record previous and new IDs.
5. Return `verified` when every authorized name has a new identity,
   `no-op` when GitHub shows the requested failed required runs already
   rerunning for the same head, `partial` when some writes succeeded and
   verification is incomplete, and `blocked` when no write occurred.

## Output

Return one version-1 `RequiredCheckRerun`. Preserve requested versus
authorized names. `verification.optional_checks_excluded` MUST be `true`.
Recommend `wait-required-checks` next. Never recommend merge.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository, pull request, or head SHA is absent or conflicting. | `blocked`; no write |
| `unauthorized_rerun` | Exact names or rerun authorization are missing. | `blocked`; no write |
| `optional_check` | A requested name is not an exact required check. | `blocked`; no write |
| `identity_mismatch` | Live head or run identity does not match the authorized target. | `blocked` or `partial` |
| `api_failure` | GitHub rejected or did not confirm the rerun. | `partial` or `blocked` |
