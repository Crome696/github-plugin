---
name: analyze-pr-diff
description: Analyze one GitHub pull-request diff for correctness, architecture, security, performance, maintainability, tests, documentation, and scope, returning evidence-backed findings and separate uncertainties. Use automatically when a user or workflow requests a pull-request diff review; never publish comments or reviews, make merge decisions, or change GitHub or local files.
---

# Analyze Pull-Request Diffs

Analyze exactly one pull request's live unified diff and return a version-1
[`PullRequestDiffAnalysis`](../../shared/schemas/PullRequestDiffAnalysis.yaml)
handoff. This Skill is a diagnostic review; it does not decide whether a pull
request may merge.

## Boundaries

- Read GitHub and explicitly supplied repository evidence only. Never edit
  pull requests, issues, comments, branches, rulesets, files, or Git state.
- Never publish a comment or review, request changes, approve a pull request,
  merge, mark a draft ready, rerun checks, resolve discussions, or invoke a
  publication workflow.
- Preserve the exact repository, pull-request number, canonical URL, base
  revision, and head SHA. Do not infer identity from the current checkout,
  branch, issue text, commit message, or most recently viewed pull request.
- `LoadedPullRequest` is an optional identity and metadata snapshot. Validate
  it, but refresh live pull-request metadata and the diff because the snapshot
  contains file metadata rather than a complete patch.
- Do not automatically invoke a sibling Skill. Use relevant skills, rules,
  agents, tools, or domain guidance only when the current host session
  explicitly exposes them and they apply to the changed paths. Record each
  capability's availability and actual use in `capabilities_applied`; never
  invent, install, authenticate, configure, or hard-code a capability from
  another plugin.
- Keep newly authored handoff and report text in English. Keep conversational
  explanations in the user's language. Preserve short exact source excerpts
  only when required as evidence.
- Redact tokens, credentials, private keys, `.env` values, personal data, full
  logs, and unnecessary command output from the handoff.

## Input contract

Accept either:

```yaml
repository: owner/repository
number: 123
```

or one GitHub pull-request URL from which the exact repository and positive
pull-request number can be parsed. An optional version-1 `LoadedPullRequest`
handoff may provide the same identity and a candidate head SHA:

```yaml
loaded_pull_request:
  schema: LoadedPullRequest
  version: 1
  status: loaded | partial | blocked
```

Validate every supplied handoff before using it. If explicit identity conflicts
with the handoff, return `blocked`; never silently select one source. Reject
zero, negative, decimal, non-numeric, or ambiguous pull-request numbers.

If identity is missing, ask one concise identity question. If it remains
unavailable, return `blocked` with `failure.code: missing_identity` and do not
perform a guessed lookup.

## Evidence and certainty

Use these evidence layers and keep their availability distinct:

1. The exact pull-request metadata retrieved for the supplied repository and
   number, including canonical URL, title, body, base branch and SHA, and head
   SHA.
2. The live unified patch retrieved for that exact pull request.
3. Read-only repository files or task context only when their repository and
   revision match the verified pull request or they are explicitly supplied.
4. Relevant host-provided skills and rules, recorded with their availability
   and usage rather than treated as repository facts.

Record the command or endpoint and the relevant identifier in each evidence
value. Prefer:

```text
gh pr view <number> --repo <owner>/<repo> --json number,url,title,body,baseRefName,baseRefOid,headRefName,headRefOid
gh pr diff <number> --repo <owner>/<repo>
```

Use the returned head SHA as the source of truth. Do not report a successful
analysis when metadata and the patch refer to different pull requests or
revisions. An empty changed-file list means the diff was retrieved and has no
entries; an unavailable field means the source did not provide it.

Distinguish:

- **Evidence-backed finding:** an observed behavior or material deficiency
  supported by the diff or explicitly supplied repository evidence.
- **Uncertainty:** a hypothesis, missing context, unavailable capability, or
  conclusion that requires a fact not present in the sources.

Do not convert an uncertainty into a finding merely to fill a category.

## External capability use

Before reviewing, inspect the capabilities already available in the host
session. Apply a relevant review, security, testing, performance,
documentation, or repository-rule capability when it is available and
applicable to the changed paths. Record:

- its exact exposed name and type;
- whether it was available;
- whether its guidance was applied;
- the bounded purpose for which it was used; and
- the evidence showing why it was relevant.

An unavailable capability is a limitation, not proof of a defect. Do not
reference another plugin's files or assume a framework, language, test
strategy, domain rule, or security requirement that the evidence does not
establish.

## Workflow

### 1. Validate identity and source

Validate the repository, pull-request number, URL parsing, optional
`LoadedPullRequest` version, and any identity agreement. Load the exact live
metadata, then retrieve the live diff. Preserve `base_branch`, `base_sha`, and
`head_sha` without normalization beyond mapping field names.

If the metadata request fails, return `blocked` with no fabricated findings. If
metadata succeeds but the diff or a material enrichment is unavailable, return
`partial` or `blocked` according to whether a reliable category analysis is
still possible, preserve `source.unavailable_fields`, and explain the
limitation in `uncertainties`.

### 2. Establish review scope

Use the pull-request title, body, explicit task context, and linked issue
handoffs only when they were retrieved or supplied. Compare the changed paths
and behavior with that evidence for the `scope` category. Do not infer scope
from a branch name, commit message, arbitrary URL, label, or conventional
expectation.

### 3. Evaluate all eight categories

Evaluate every category and include all eight values in
`categories_evaluated`, even when a category has no finding:

- `correctness`: control flow, state transitions, edge cases, error paths,
  data transformations, and observable behavior.
- `architecture`: module boundaries, dependency direction, cohesion,
  coupling, abstraction fit, and compatibility with evidenced repository
  structure.
- `security`: input validation, authentication, authorization, injection,
  secret handling, data exposure, unsafe deserialization, path or request
  boundaries, and logging. Report only concrete evidence.
- `performance`: algorithmic complexity, repeated I/O, allocations,
  concurrency, caching, and hot-path work when the diff or supplied context
  supports the impact. Do not invent scale or benchmarks.
- `maintainability`: duplication, clarity, cohesion, error handling,
  consistency, dead paths, and future change cost when materially affected.
- `tests`: regression coverage for changed behavior and whether available
  tests verify the relevant failure and success paths. Do not call missing
  tests a defect without a concrete behavior and verification gap.
- `documentation`: changed public contracts, user-visible behavior,
  configuration, migration, or operational documentation that the evidence
  shows must be updated. Do not require documentation by convention alone.
- `scope`: additions or behavior outside the explicit pull-request or task
  scope. If scope evidence is absent, record an uncertainty instead.

### 4. Produce findings

Create a finding only for a material, actionable problem or a concise
evidence-backed review note. Use `blocker`, `major`, `minor`, or `nit` based on
impact rather than preference:

- `blocker`: the change cannot safely be accepted or verified as written.
- `major`: a material defect, security risk, compatibility problem, or missing
  verification affects the changed behavior.
- `minor`: a non-blocking but actionable defect or maintainability risk.
- `nit`: a small, evidence-backed improvement that does not affect behavior.

Every finding must have `status: proposed`, a unique `F-001`-style ID,
category, confidence, evidence, impact, recommendation, and verification.
Anchor `location` to the smallest relevant changed hunk:

- use `side: RIGHT` and new-file line numbers for added or modified behavior;
- use `side: LEFT` for deleted behavior;
- use repository-relative paths and one-based line numbers;
- use `null` line values only when the relevant evidence cannot be anchored,
  and explain why in `evidence`.

High confidence means the problem follows directly from the observed code or
retrieved contract. Medium confidence means limited context is involved but
the evidence supports the conclusion. Low-confidence hypotheses belong in
`uncertainties` unless the actionable risk is independently evidenced.
Do not add `inline_comment` or a replacement suggestion: this Skill never
prepares a publication payload.

### 5. Record uncertainties separately

Use `U-001`-style entries for missing context, unsupported runtime behavior,
unavailable source fields, or capability limitations. Include the category,
available evidence, the exact limitation, confidence, and a concrete
verification step. Keep uncertainties out of `findings` and do not describe
them as confirmed defects.

### 6. Summarize and recommend

Summarize the reviewed scope, the most important proposed findings, and
material limitations without making a merge decision. Recommend at most one
next Skill:

- `inspect-pr-checks` when check or required-check evidence is needed;
- `load-pr-discussions` when existing review context is needed to avoid
  duplicate or already-resolved findings;
- `none` when no downstream workflow is justified.

The recommendation is advisory and must not invoke the Skill automatically.

## Output contract

First give a concise summary in the conversation language. Then return exactly
one English `PullRequestDiffAnalysis` version-1 handoff:

```yaml
status: analyzed
repository: octo-org/widgets
pull_request:
  number: 42
  url: https://github.com/octo-org/widgets/pull/42
base_branch: main
base_sha: 1111111111111111111111111111111111111111
head_sha: 2222222222222222222222222222222222222222
source:
  diff_source: live_diff
  loaded_pull_request_status: not_supplied
  evidence:
    - "gh pr view ... returned the canonical URL and headRefOid 2222..."
    - "gh pr diff ... returned the unified patch for pull request 42"
  unavailable_fields: []
categories_evaluated:
  - correctness
  - architecture
  - security
  - performance
  - maintainability
  - tests
  - documentation
  - scope
capabilities_applied:
  - name: security-review-guidance
    type: rule
    availability: available
    applied: true
    usage: "Checked changed request handling for input and authorization boundaries."
    evidence: "The host session exposed the guidance for the changed API path."
findings:
  - id: F-001
    status: proposed
    category: correctness
    severity: major
    confidence: high
    location:
      path: src/loader.ts
      start_line: 48
      end_line: 49
      side: RIGHT
      commit_sha: 2222222222222222222222222222222222222222
    evidence: "The added branch returns before the required error callback when the response has no items."
    impact: "Empty responses are reported as successful and downstream state remains stale."
    recommendation: "Handle the empty response through the same error or state-reset path as other invalid responses."
    verification: "Add a regression test for an empty response and verify the callback and state transition."
    references:
      - "diff:src/loader.ts:48-49"
uncertainties:
  - id: U-001
    category: performance
    statement: "The new lookup may add repeated network requests on a hot path."
    evidence: "The diff adds a request inside an existing iteration."
    limitation: "No request-volume or call-frequency evidence was supplied."
    confidence: low
    verification: "Measure calls for a representative batch and inspect the caller's invocation rate."
    location:
      path: src/loader.ts
      start_line: 52
      end_line: 52
      side: RIGHT
summary: "The diff was reviewed across all eight categories. One correctness issue is proposed; performance impact remains uncertain because runtime-volume evidence is unavailable."
recommended_next_skill: none
failure: null
analyzed_at: "2026-08-10T07:00:00Z"
```

Use `failure: null` only for `analyzed`. For `partial` or `blocked`, use the
failure codes from the schema, preserve known identity and source evidence,
and never fabricate findings or category conclusions.

## Failure handling

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | Repository or pull-request number is unavailable. | Ask one identity question or return `blocked`; do not guess. |
| `invalid_pull_request_number` | The number is zero, negative, decimal, non-numeric, or ambiguous. | `blocked`; do not query another pull request. |
| `invalid_input` | A supplied URL, handoff, or field has an invalid shape. | `blocked`; preserve no guessed values. |
| `unsupported_version` | A supplied handoff is not `LoadedPullRequest` version 1. | `blocked`; request a compatible handoff or identity. |
| `blocked_source` | Exact pull-request metadata cannot be loaded. | `blocked`; return no fabricated findings. |
| `diff_unavailable` | The exact live patch cannot be retrieved. | `blocked` unless a reliable analysis source was explicitly supplied; preserve the failure. |
| `incomplete_source` | A material field, repository context, or capability is unavailable after the diff was loaded. | `partial`; identify the affected category and uncertainty. |
| `analysis_failure` | An unexpected failure prevents reliable analysis. | `blocked` or `partial`; sanitize the message and operation. |
