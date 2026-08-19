---
name: wait-required-checks
description: Wait after a verified pull-request head push and report current required-check pass, fail, pending, skipped, and missing outcomes without treating pending or unavailable policy evidence as a pass, rerunning CI, or changing GitHub.
---

# Wait Required Checks

Wait for required status checks on exactly one verified pull-request head and
return a version-1
[`RequiredCheckWait`](../../shared/schemas/RequiredCheckWait.yaml) handoff.
Compose live evidence by running
[inspect-pr-checks](../inspect-pr-checks/SKILL.md) then
[check-required-status-checks](../check-required-status-checks/SKILL.md) on
each poll. This Skill never reruns workflows, merges, or publishes a review.

## Boundaries

- Read GitHub through the existing inspection Skills only. Never edit pull
  requests, branches, workflows, reviews, issues, or local files.
- Never treat `pending`, `skipped`, `missing`, or unavailable/partial policy
  evidence as a pass.
- Never infer a required check from a workflow file, display name, branch
  name, or pull-request text. Required names come only from the projected
  `PullRequestCheckInspection`.
- Optional checks remain diagnostic and MUST NOT enter `required_outcomes`.
- Do not authorize merge or Ready-for-Review from green required checks.
- Preserve the exact repository, pull-request number, base branch, and head
  SHA. Do not guess identity from the current checkout.
- Keep structured fields in English. Explanations may use the conversation
  language.

## Input

Require:

1. A verified repository and positive pull-request number, or one GitHub
   pull-request URL from which those values parse uniquely.
2. The current head SHA after a verified push, or a version-1
   `LoadedPullRequest` / `BranchPush` whose head SHA matches live GitHub.
3. Task-scoped wait authorization for `pr:<number>` from `/auto-ci-fix-pr` or
   an equivalent explicit invocation.

Reject missing identity with `status: blocked` and
`failure.code: missing_identity`.

## Wait mapping

Default bounded wait:

- `timeout_seconds: 900`
- `poll_interval_seconds: 30`

Host mapping is an implementation choice inside this envelope. Cursor, Codex,
and Claude MAY poll by repeating the inspection Skills and sleeping between
polls. They MUST stop when the timeout elapses. Do not call an LLM on the
synchronous poll path. A hang or unbounded wait is a failure; return
`status: timeout` with `retryable: true` rather than continuing.

## Workflow

1. Validate identity and authorization. Record `wait.pending_treated_as_pass:
   false`.
2. On each poll, run `inspect-pr-checks` then `check-required-status-checks`.
   Use the latest `PullRequestCheckInspection` as the only check evidence.
3. Copy required checks whose `required` flag is `true` into
   `required_outcomes` with their current `pass`, `fail`, `pending`,
   `skipped`, or `missing` result. Preserve policy
   `requirements.status` as `policy_evidence.status`.
4. If policy evidence is `unavailable` or `partial`, return `partial` or
   `blocked`. Do not invent an empty required set as success.
5. If every required outcome is `pass` and policy evidence is `known`, return
   `complete`.
6. If any required outcome is `fail`, `missing`, or `skipped` after at least
   one complete inspection, return `complete` with those results so a rerun
   or fix loop can continue. Skipped required checks are not a pass.
7. If required outcomes remain `pending` when the timeout elapses, return
   `timeout`. Never coerce pending into pass.
8. Recommend `rerun-required-checks` only for failed required names with
   exact authorization. Recommend `build-ci-fix-plan` when checks remain red
   after wait. Never recommend merge.

## Output

Return one version-1 `RequiredCheckWait`. `failure` is `null` only for
`complete` with no operational error. Timeout, partial policy evidence, and
identity failures keep structured `failure` evidence.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository, pull-request number, or head SHA is absent. | `blocked` |
| `policy_unavailable` | Branch-protection or ruleset evidence is unavailable. | `partial` or `blocked` |
| `timeout` | Required checks remain pending after the bounded wait. | `timeout` |
| `api_failure` | Inspection could not be refreshed. | `partial` or `blocked` |
