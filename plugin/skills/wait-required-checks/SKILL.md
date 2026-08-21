---
name: wait-required-checks
description: Wait after a verified pull-request head push and report current required-check pass, fail, pending, skipped, and missing outcomes without treating pending or unavailable policy evidence as a pass, rerunning CI, or changing GitHub.
---

# Wait Required Checks

Wait for required status checks on exactly one verified pull-request head and
return a version-1
[`RequiredCheckWait`](../../shared/schemas/RequiredCheckWait.yaml) handoff.
Compose live evidence through
[inspect-pr-checks](../inspect-pr-checks/SKILL.md) exactly once per polling
observation. `inspect-pr-checks` owns raw-state acquisition and all required-
check normalization; this Skill only applies the already-normalized result to
the deterministic wait state machine. This Skill never reruns workflows,
merges, or publishes a review.

## Boundaries

- Read GitHub through the existing inspection Skills only. Never edit pull
  requests, branches, workflows, reviews, issues, or local files.
- Never treat `pending`, `skipped`, `missing`, or unavailable/partial policy
  evidence as a pass.
- Never infer a required check from a workflow file, display name, branch
  name, or pull-request text. Required names come only from the current
  `PullRequestCheckInspection` returned by `inspect-pr-checks`.
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
and Claude MUST use the same bounded state machine. They MUST stop when the
timeout elapses. Do not call an LLM on the synchronous poll path. A hang or
unbounded wait is a failure; return `status: timeout` with `retryable: true`
rather than continuing.

## Deterministic polling helper

The polling helper is local to this Skill and is not a new Shared Contract.
Its host adapter receives exactly these inputs:

```text
expected_identity: repository, pull_request.number, base_branch, head_sha
timeout_seconds: 900
poll_interval_seconds: 30
clock.now(): monotonic timestamp
clock.sleep_until(deadline): bounded wait primitive
acquire_raw_state(): one current PR, check, status, and requirement snapshot
```

For every observation, the helper performs this fixed sequence:

1. Stop with `timeout` if the deadline has already elapsed.
2. Call `acquire_raw_state()` once.
3. Pass that raw snapshot through `inspect-pr-checks` once. The result is the
   only normalized check evidence for this observation. The compatibility
   adapter `check-required-status-checks` MUST NOT be called.
4. Compare repository, pull-request number, base branch, and head SHA with
   `expected_identity`. A changed head is terminal with
   `failure.code: head_changed`; any other identity mismatch is terminal with
   `failure.code: identity_mismatch`.
5. If requirement evidence is `partial` or `unavailable`, stop with
   `failure.code: policy_unavailable`. Never replace that state with an empty
   required-check set.
6. Copy only checks whose normalized `required` flag is `true` into
   `required_outcomes`, preserving their exact result and evidence.
7. Return `complete` when every required outcome is `pass`, or when a required
   outcome is `fail`, `missing`, or `skipped`. A known empty required set is
   complete; an unavailable or partial policy is never complete.
8. When required outcomes remain `pending`, return `timeout` at the deadline;
   otherwise call `clock.sleep_until(min(deadline, now + interval))` and begin
   the next observation.

The helper MUST not perform model dispatch, semantic reclassification, CI
reruns, or GitHub writes between observations. A fake clock and a deterministic
`acquire_raw_state()` sequence can therefore exercise the full loop without
waiting in real time.

### Deterministic verification matrix

The helper's externally verifiable scenario matrix is:

| Scenario | Required result |
| --- | --- |
| All required checks pass immediately | Terminal success; optional checks do not appear in `required_outcomes`. |
| A required check fails immediately | Terminal failure with that normalized required outcome. |
| Required checks are pending, then pass | One bounded 30-second wait per pending observation, then terminal success. |
| The fake clock reaches 900 seconds while a required check remains pending | Terminal timeout; pending is never treated as success. |
| A required check is absent from the normalized inspection | Terminal missing-check outcome; absence is never treated as success. |
| Required-check policy is unavailable or only partially evidenced | Terminal policy-unavailable outcome; incomplete policy evidence is never treated as success. |
| The observed repository, PR, base branch, or head SHA changes | Terminal identity/head-change outcome; later observations are not accepted. |
| A required check is skipped | Terminal skipped-check outcome; skipped is never treated as success. |

The repository intentionally has no local test runner or fixture workspace.
These scenarios are therefore the contract-level matrix for an external
fake-clock validation capability and must be reported with its actual result
when such a capability is available.

## Workflow

1. Validate identity and authorization. Record `wait.pending_treated_as_pass:
   false`.
2. Initialize the deterministic polling helper with the verified identity,
   bounded timeout, poll interval, injected clock, and raw-state acquirer.
3. On each observation, run `inspect-pr-checks` exactly once and use its
   `PullRequestCheckInspection` as the only check evidence.
4. Copy required checks whose `required` flag is `true` into
   `required_outcomes` with their current `pass`, `fail`, `pending`,
   `skipped`, or `missing` result. Preserve policy
   `requirements.status` as `policy_evidence.status`.
5. If policy evidence is `unavailable` or `partial`, return `partial` or
   `blocked`. Do not invent an empty required set as success.
6. If every required outcome is `pass` and policy evidence is `known`, return
   `complete`.
7. If any required outcome is `fail`, `missing`, or `skipped` after at least
   one complete inspection, return `complete` with those results so a rerun
   or fix loop can continue. Skipped required checks are not a pass.
8. If required outcomes remain `pending` when the timeout elapses, return
   `timeout`. Never coerce pending into pass.
9. Recommend `rerun-required-checks` only for failed required names with
   exact authorization. Recommend `build-ci-fix-plan` when checks remain red
   after wait. Never recommend merge.

The terminal observation's normalized `PullRequestCheckInspection` may be
carried as companion evidence to a caller that needs exact check-run
identities. If a caller refreshes it after a terminal failure, that is one
explicit post-wait inspection, not another projection in the polling loop.

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
| `head_changed` | The live pull-request head differs from the verified target. | `blocked` |
| `identity_mismatch` | Repository, pull-request number, or base branch differs from the target. | `blocked` |
| `api_failure` | Inspection could not be refreshed. | `partial` or `blocked` |
