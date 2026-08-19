---
name: inspect-pr-checks
description: Inspect one GitHub pull request's status checks, CI results, and explicitly retrieved required checks, classify them as pass, fail, pending, skipped, or missing, and return evidence-backed failure summaries. Use automatically when a workflow needs current pull-request check or CI state; never invent requirements, make merge decisions, rerun checks, modify GitHub, or change local files.
---

# Inspect Pull-Request Checks

Inspect exactly one live GitHub pull request and return a version-1
[`PullRequestCheckInspection`](../../shared/schemas/PullRequestCheckInspection.yaml)
handoff. Combine the pull request's check rollup with check-run and commit-status
evidence for the recorded head SHA, then resolve required checks only from
retrieved branch-protection or applicable-ruleset responses.

This Skill is diagnostic and read-only. It reports what GitHub exposes; it does
not decide whether a pull request may merge. Waiting and rerunning checks
belong to `wait-required-checks` and `rerun-required-checks`.

## Boundaries

- Read GitHub and supplied handoffs only. Never edit pull requests, issues,
  comments, branches, rulesets, branch protection, or local files.
- Do not rerun workflows, request a review, submit a review, merge, mark a
  pull request ready, or repair a failed check.
- Never infer a required check from a workflow file, repository convention,
  branch name, pull-request text, check frequency, or a check's display name.
  A required check must be present in retrieved branch-protection or applicable
  ruleset evidence.
- Preserve the exact repository, pull-request number, base branch, and head SHA.
  Do not guess identity from the current checkout, remote, branch, issue text,
  or most recently viewed pull request.
- Preserve raw GitHub status and conclusion values when they are available.
  Do not turn an unsupported state into a pass, fail, pending, skipped, or
  missing result.
- Keep `missing` distinct from unavailable requirement evidence. Emit a
  missing check only when a retrieved requirement has no exact check or
  commit-status match for the recorded head SHA.
- Failure summaries must be concise and sanitized. Never return tokens,
  credentials, private keys, `.env` values, complete logs, or unnecessary CLI
  output.
- Do not automatically invoke `load-pull-request`, `load-pr-discussions`,
  `MergeReadiness`, or any other Skill. A recommended downstream workflow is
  advisory only.

## Input contract

Accept either:

```yaml
repository: owner/repository
number: 123
```

or one GitHub pull-request URL from which the exact repository and positive
pull-request number can be parsed. The repository must contain one non-empty
owner and repository name. Reject zero, negative, decimal, non-numeric, or
ambiguous pull-request numbers.

An optional version-1 `LoadedPullRequest` handoff may provide identity and a
candidate head SHA. Validate it before use, but refresh the live pull-request
payload and use the returned head SHA as the source of truth. If supplied
identity conflicts with the explicit input, return `blocked` with
`failure.code: invalid_pull_request_number` or `api_failure`; never silently
select one identity.

If the repository or pull-request number is missing, ask one concise identity
question. If it remains unavailable, return `blocked` with
`failure.code: missing_identity` and do not perform a guessed lookup.

## Evidence model

Use these evidence layers and keep their availability separate:

1. The exact pull-request payload from `gh pr view`, including the canonical
   URL, base branch, head SHA, and `statusCheckRollup`.
2. Check runs and commit statuses for that exact head SHA.
3. Required-status evidence from the base branch's branch protection and
   applicable active rulesets.
4. Check-run output summaries and annotations, or a tightly limited failed-log
   excerpt when no safer summary is available.

Record the command or API endpoint, relevant field, and retrieved identifier in
each evidence value. An empty list means a source was successfully retrieved
and contained no entries. A `null` field or an entry in `unavailable_fields`
means that the requested evidence was not available. Do not turn either into a
requirement or a passing result.

Use `requirements.status: known` only when every requested requirement source
was retrieved. Use `partial` when at least one source was retrieved and
another was unavailable. Use `unavailable` when no requirement source could be
used. A successfully retrieved source with no required checks has status
`empty`; this is different from an unavailable source.

## Workflow

1. **Validate identity and authentication.** Normalize only the supplied
   `owner/repository` and pull-request number. Run `gh auth status` when
   authentication is not already known to be available, and do not copy
   sensitive authentication output into the handoff.

2. **Load the exact pull request.** Use the supplied repository and number:

   ```text
   gh pr view <number> --repo <owner>/<repo> --json number,url,baseRefName,headRefOid,statusCheckRollup
   ```

   Preserve the canonical URL, base branch, and head SHA. If this primary
   request fails, return `blocked` and do not substitute another pull request.

3. **Load check evidence for the recorded head.** Query both sources:

   ```text
   gh api --paginate --slurp "repos/<owner>/<repo>/commits/<head_sha>/check-runs?per_page=100" -H "Accept: application/vnd.github+json"
   gh api "repos/<owner>/<repo>/commits/<head_sha>/status?per_page=100" -H "Accept: application/vnd.github+json"
   ```

   Use `statusCheckRollup` to fill gaps or confirm the same check, not to
   invent a second check. Prefer the latest evidence for duplicate check-run
   names or commit-status contexts, preserving the source identifier and raw
   timestamps. Match check runs by their GitHub check-run identity and
   statuses by exact context; do not collapse distinct checks solely because
   their display names look similar.

4. **Retrieve branch-protection requirements.** Query the base branch:

   ```text
   gh api "repos/<owner>/<repo>/branches/<base_branch>/protection/required_status_checks" -H "Accept: application/vnd.github+json"
   ```

   Extract only the returned `contexts` and `checks` entries. Preserve the
   integration ID when GitHub returns it. A response explicitly identifying
   the branch as unprotected is an `empty` branch-protection source. A
   permission, authentication, server, or otherwise ambiguous response is
   `unavailable`; do not interpret a generic 404 as proof that no requirement
   exists.

5. **Retrieve applicable rulesets.** Load the repository ruleset inventory and
   details:

   ```text
   gh api --paginate --slurp "repos/<owner>/<repo>/rulesets?includes_parents=true&per_page=100" -H "Accept: application/vnd.github+json"
   gh api "repos/<owner>/<repo>/rulesets/<ruleset_id>" -H "Accept: application/vnd.github+json"
   ```

   Consider only retrieved rulesets that are active, target branches, and whose
   `conditions.ref_name` include/exclude patterns apply to the pull request's
   base branch according to GitHub's ref-name matching semantics. Extract
   `rules` entries with `type: required_status_checks` and each
   `parameters.required_status_checks[].context` and `integration_id`.
   Preserve the ruleset ID, name, enforcement, branch, and endpoint as
   evidence. If the inventory or a required detail request is inaccessible,
   mark that source `unavailable` or `partial`; never infer its rules.

6. **Normalize requirements without guessing.** Deduplicate required entries
   only when their exact name and context match, retaining all source
   references. Compare a requirement to a check by exact string equality
   against the check's `context` or `name`; do not use case folding,
   substring matching, workflow-name matching, or a guessed alias.

   Set a check's `required` flag as follows:

   - `true` for an exact match to a retrieved requirement;
   - `false` only when all requirement sources are known and the check does not
     match any retrieved requirement;
   - `null` when requirement sources are partial, unavailable, or ambiguous and
     the check is not an exact required match.

   When a retrieved requirement has no exact matching check or status for the
   recorded head SHA, add one `missing_required_check` entry with
   `result: missing`, `required: true`, and evidence naming the requirement
   source and check-data endpoints. If requirement evidence is unavailable,
   do not add any missing entry.

7. **Classify each available check.** Preserve `raw_status` and
   `raw_conclusion`, then use this mapping:

   | GitHub evidence | Result |
   | --- | --- |
   | Check conclusion `success`, or commit-status state `success` | `pass` |
   | Check conclusions `failure`, `timed_out`, `action_required`, `startup_failure`, `cancelled`, or `stale`; commit-status state `failure` or `error` | `fail` |
   | Check status `queued`, `in_progress`, `waiting`, `requested`, or `pending`; null conclusion without a completed result; commit-status state `pending` | `pending` |
   | Check conclusion `skipped` or `neutral` | `skipped` |
   | Retrieved required check with no exact result for this head SHA | `missing` |

   If GitHub returns a state outside this mapping, preserve the raw value,
   list the affected check path in `unavailable_fields`, and return
   `partial`; do not assign an invented result.

8. **Summarize failures when available.** For failed check runs, prefer the
   returned `output.summary` and check-run annotations:

   ```text
   gh api --paginate --slurp "repos/<owner>/<repo>/check-runs/<check_run_id>/annotations?per_page=50" -H "Accept: application/vnd.github+json"
   ```

   If no summary or annotations are available and a GitHub Actions run ID is
   present, a read-only `gh run view <run_id> --repo <owner>/<repo> --log-failed`
   lookup may be used only to extract a short error line. Redact secrets,
   tokens, credentials, URLs with embedded credentials, environment values,
   and unrelated log output. If no safe summary is available, use
   `failure_summary: null`; do not fabricate one.

9. **Return one complete handoff.** Return exactly one version-1
   `PullRequestCheckInspection` object. Use `inspected` only when the primary
   check data and all requested requirement sources were retrieved. Use
   `partial` when the primary data exists but a requirement, annotation, or
   state-classification enrichment is unavailable. Use `blocked` when the
   primary pull-request identity or payload cannot be loaded. Add a concise
   conversation-language summary after the structured English handoff without
   replacing it.

## Output contract

Return [`PullRequestCheckInspection`](../../shared/schemas/PullRequestCheckInspection.yaml)
with:

- `status`: `inspected`, `partial`, or `blocked`.
- `pull_request`, `repository`, `base_branch`, and `head_sha`: the exact
  inspected identity.
- `requirements`: whether requirement evidence is known, partial, or
  unavailable, with reproducible evidence.
- `requirement_sources`: branch-protection and ruleset responses, including
  empty and unavailable sources.
- `required_checks`: only explicitly retrieved required names and their source
  evidence.
- `checks`: available check and status evidence with `pass`, `fail`,
  `pending`, `skipped`, or `missing` result, raw values, requirement flag,
  URLs, timestamps, and sanitized failure summary.
- `summary`: counts for every result and required-result subset.
- `unavailable_fields`: dot paths for missing or failed enrichments.
- `failure`: `null` for complete inspection; otherwise a structured
  evidence-backed failure.
- `inspected_at`: retrieval timestamp.

Do not add merge recommendations, review decisions, required-approval
interpretations, rerun instructions, or authorization to this handoff.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository or pull-request number is absent and cannot be clarified. | `blocked`; do not run a guessed lookup. |
| `invalid_pull_request_number` | The supplied number is not a positive integer or conflicts with a supplied identity. | `blocked`; preserve known identity only. |
| `repository_not_found` | The exact repository is malformed or cannot be resolved. | `blocked`; do not substitute another repository. |
| `pull_request_not_found` | The exact repository exists but the requested pull request does not. | `blocked`; do not return a similarly numbered pull request. |
| `inaccessible` | GitHub returns a permission failure for the requested repository, pull request, check, or rule source. | `blocked` for primary data, otherwise `partial`; preserve unavailable fields. |
| `auth_unavailable` | `gh` is not authenticated for the required host. | `blocked`; do not request or print credentials. |
| `requirement_unavailable` | Primary pull-request and check data loaded, but branch-protection or ruleset evidence could not be retrieved. | `partial`; do not emit missing checks from absent requirements. |
| `api_failure` | Network, server, rate-limit, malformed-response, unsupported-field, or other unexpected request failure. | `blocked` for primary data, otherwise `partial`; identify the affected operation. |

Map errors to the narrowest supported code. Preserve a generic or ambiguous
404 as unavailable unless the response explicitly establishes that the source
has no configuration. Never convert an unavailable requirement source into an
empty requirement list.

## Compact example

```yaml
schema: PullRequestCheckInspection
version: 1
status: inspected
repository: octo-org/widgets
pull_request:
  number: 42
  url: https://github.com/octo-org/widgets/pull/42
base_branch: main
head_sha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
requirements:
  status: known
  evidence:
    - "GET repos/octo-org/widgets/branches/main/protection/required_status_checks: contexts[0].context=build"
requirement_sources:
  - source: branch_protection
    status: loaded
    branch: main
    ruleset_id: null
    ruleset_name: null
    enforcement: null
    endpoint: https://api.github.com/repos/octo-org/widgets/branches/main/protection/required_status_checks
    required_checks:
      - name: build
        context: build
        integration_id: null
        evidence:
          - "required_status_checks.contexts[0]"
    evidence:
      - "Branch protection returned one required context for main."
    unavailable_reason: null
required_checks:
  - name: build
    context: build
    sources: [branch_protection]
    evidence: ["Exact branch-protection context match."]
checks:
  - name: build
    context: build
    result: pass
    required: true
    source: check_run
    raw_status: completed
    raw_conclusion: success
    details_url: https://github.com/octo-org/widgets/actions/runs/100
    workflow_name: CI
    run_id: "100"
    started_at: "2026-08-09T18:00:00Z"
    completed_at: "2026-08-09T18:05:00Z"
    failure_summary: null
    evidence: "GET repos/octo-org/widgets/commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/check-runs: check_run.id=100"
summary:
  total: 1
  pass: 1
  fail: 0
  pending: 0
  skipped: 0
  missing: 0
  required_pass: 1
  required_failed: 0
  required_pending: 0
  required_skipped: 0
  required_missing: 0
unavailable_fields: []
failure: null
inspected_at: "2026-08-09T18:06:00Z"
```
