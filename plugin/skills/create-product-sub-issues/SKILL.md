---
name: create-product-sub-issues
description: Publish one exact approved ProductSubIssueDrafts v2 set as GitHub sub-issues through lossless IssueDraft v2 adapters, preserving parent identity, priority, labels, hard dependencies, retry identity, and partial-failure evidence without silently changing the canonical payload.
---

# Create Product Sub-Issues

Publish one fully approved product plan as GitHub sub-issues. The canonical
publishable payload is always the exact ProductSubIssueDrafts v2 handoff
produced by compose-product-sub-issues. ProductPlannerRun v2 carries the
approval and lifecycle state for that set; it never supplies a second title or
body source.

This Skill owns batch preflight, duplicate/retry checks, create continuation,
relationship finalization, and publication evidence. It delegates each
individual external issue write to
[create-github-issue](../create-github-issue/SKILL.md) through an internal,
lossless IssueDraft v2 adapter. The adapter is not an independently approved
product-plan payload and must never be accepted as the source of truth.

## Boundaries

- Match questions, explanations, and status updates to the conversation
  language.
- Keep GitHub titles, bodies, labels, and persisted handoffs in English unless
  the user explicitly overrides the artifact language.
- Require ProductPlannerRun v2 with
  authorization.exact_payload: true, exact_set: true,
  publication_authorized: true, and a canonical_set_digest matching the
  supplied ProductSubIssueDrafts v2 identity.
- Require the supplied canonical set to be ProductSubIssueDrafts version 2,
  canonicalization version 1, algorithm sha256, and a recomputed matching
  lowercase digest. A digest's existence never implies approval.
- Require exact repository and parent issue identity, the exact eligible unit
  IDs and set size, and a non-parent target for every adapter.
- Reject all legacy v1 draft-set or planner-run payloads. Never silently
  convert, merge, or infer a v2 approval from them.
- Copy canonical title, body, and exact labels.add, labels.remove, and
  labels.preserve values without normalization or rewriting.
- Never overwrite, close, relabel, or replace the parent issue. Do not change
  issue state, assignees, milestones, projects, issue type, comments, or
  unrelated metadata.
- Announce the batch immediately before the first external write. This is an
  execution announcement, not a new approval prompt.
- Do not roll back a successful create and do not stop remaining creates after
  one failure.
- Apply github-evidence.mdc, github-safety.mdc, and interactive-approval.mdc.
- Never read or expose secrets, credentials, private keys, .env contents, or
  unnecessary issue comments.

## Input contract

The required inputs are:

    product_planner_run:
      schema: ProductPlannerRun
      version: 2
      status: publication_handed_off | partial
    canonical_drafts:
      schema: ProductSubIssueDrafts
      version: 2
      status: composed | partial
      canonical_identity:
        schema: ProductSubIssueDrafts
        version: 2
        canonicalization_version: 1
        algorithm: sha256
        digest: <64 lowercase hexadecimal characters>
        unit_ids: [unit-export-csv]

Validate before any write:

- The run, canonical source, and verified target identify one identical
  owner/repository and parent issue number and URL.
- The Planner canonical_set equals the supplied draft-set identity in schema,
  version, canonicalization version, algorithm, digest, unit IDs, and set size.
- Recomputing the digest over the supplied canonical draft fields produces
  the stored digest. Sort draft records by unit_id; recursively sort object
  keys; preserve authored array order; serialize compact UTF-8 JSON; exclude
  status, failure, timestamps, mappings, approval flags, and diagnostic-only
  source metadata.
- exact_payload, exact_set, and publication_authorized are all true, and
  canonical_set_digest equals the recomputed digest. Do not accept drafts_ready
  as a publication handoff: that state requires all three flags false and a
  null approval digest.
- Every canonical unit ID is unique and appears exactly once in the eligible
  set. The approved set size and IDs match the Planner record exactly.
- Every draft has exact labels.add, labels.remove, and labels.preserve lists and
  a sub_issue_of parent relationship. No draft has a publication target or
  adapter issue number equal to the parent.
- No separate IssueDraft collection is supplied as a product-plan source.
  Any IssueDraft v2 object created later is an internal adapter and is checked
  against its canonical draft before delegation.

Reject missing, malformed, unsupported, legacy, identity-mismatched,
digest-mismatched, set-mismatched, unapproved, parent-overwrite, or ambiguous
inputs with status: blocked and no external write.

## Workflow

### 1. Validate the canonical set and approval

Copy the canonical identity, exact approved unit IDs, parent identity, omitted
units, and source evidence into the result without normalizing authored
publishable values. Preserve the Planner approval evidence and digest.

If a required input is absent, blocked, legacy, unsupported, or mismatched,
return:

- status: blocked;
- empty mapping, relationships.parent_links, and
  relationships.dependencies;
- adapter.status: blocked when an adapter result is recorded;
- a specific failure code such as missing_input, unsupported_version,
  legacy_input, identity_mismatch, canonical_set_mismatch, set_mismatch,
  approval_missing, adapter_mismatch, or parent_overwrite_forbidden.

Do not treat orchestration authorization, drafts_ready, or the existence of a
digest as publication authorization.

### 2. Deduplicate and validate retry mappings

Before any create, inspect live GitHub for already published members of this
exact canonical set:

1. A previous mapping may be reused only when its repository, canonical
   unit_id, exact title, and canonical-set digest all match the current
   payload, and the live issue number and URL verify.
2. Otherwise inspect current child issues and reuse only one unique exact-title
   match with matching repository and canonical unit identity.
3. If two or more live issues share an exact approved title, record
   duplicate_ambiguous for that unit. Do not create or hijack an issue.
4. A stale mapping, changed title/body/labels, changed unit set, or changed
   digest is not reusable. Fail closed for that unit and preserve the retry
   evidence.

Do not treat a title-only match with an unknown canonical identity as an exact
match.

### 3. Build and verify one lossless adapter per unit

For each eligible canonical draft, construct an internal adapter payload only
after Planner approval and canonical digest verification have passed:

    schema: IssueDraft
    version: 2
    status: approved
    mode: create
    issue:
      repository: owner/repository
      number: null
      url: null
    title: <exact canonical draft title>
    body: <exact canonical draft body>
    labels:
      add: <exact canonical labels.add>
      remove: <exact canonical labels.remove>
      preserve: <exact canonical labels.preserve>
    approval:
      exact_payload: true
      publication_authorized: true

Derive issue.repository from the verified parent identity. Keep the issue
number and URL null before creation. Set adapter approval only from the
already verified Planner approval; never infer it from the digest.

Verify before delegation that the adapter title, body, and all three label
lists are value-for-value equivalent to the canonical draft. A failed
comparison is adapter_mismatch and blocks that write. The adapter contains no
independently authored product-plan decisions.

### 4. Create every remaining approved issue

Announce the batch:

    Publishing N approved canonical sub-issues in owner/repository for parent issue 123.
    The canonical digest is <digest>. Do not overwrite the parent. Relationship
    writes wait until every create has been attempted.

For each remaining unit, invoke
[create-github-issue](../create-github-issue/SKILL.md) once with the verified
lossless IssueDraft v2 adapter. Do not add priority labels, rewrite parent
text, or substitute issue numbers for unit IDs.

If one create is partial or blocked, preserve the result in failed_operations
with phase: create, keep successful creates, and continue all remaining
approved units. Never roll back a successful create. Capture returned issue
numbers and URLs from live GitHub evidence only.

### 5. Finalize relationships after every create attempt

Start relationship writes only after every approved unit has been created,
reused, or recorded as a failed create. Parent links and hard dependencies
are therefore never started while an unattempted create remains.

For each mapped issue, verify the child identity and add it as a sub-issue of
the parent when not already linked. Already linked pairs are reused. Units
without a verified mapping are skipped; API or feature gaps are
parent_link_failure.

Use only documented blocks and requires edges from the canonical draft's hard
predecessor/successor sections and matching graph evidence. Do not turn
enables or related into blockers, emit inverse edges, or mutate titles,
bodies, or labels while linking. Missing mappings skip a dependency; failed
relationship writes remain in failed_operations.

### 6. Select status and retry

- published means every approved unit is mapped as created or reused, every
  adapter is verified, every parent link and hard dependency is linked or
  reused, failed_operations is empty, and failure is null.
- partial means at least one external create or relationship write occurred,
  but a later create, link, or verification did not complete. Preserve every
  success, failure, and retry mapping.
- blocked means no external write occurred.

On retry, reuse only mappings whose repository, canonical unit identity, exact
title, and canonical-set digest still match. Recompute the digest before every
retry and block before any write on a changed payload or approval identity.

## Output contract

First give a concise summary in the conversation language. Then return one
English version-2 ProductSubIssuePublication using the fields from
[ProductSubIssuePublication](../../shared/schemas/ProductSubIssuePublication.yaml):

    schema: ProductSubIssuePublication
    version: 2
    status: published
    repository: octo-org/widgets
    parent_issue:
      number: 123
      url: https://github.com/octo-org/widgets/issues/123
    canonical_set:
      schema: ProductSubIssueDrafts
      version: 2
      canonicalization_version: 1
      algorithm: sha256
      digest: <approved digest>
      unit_ids: [unit-export-csv]
    authorization:
      source: user_approval
      task_scope: octo-org/widgets issue 123 product planning
      publication_authorized: true
      exact_payload: true
      exact_set: true
      canonical_set_digest: <approved digest>
    adapter:
      status: verified
      source_schema: ProductSubIssueDrafts
      source_version: 2
      target_schema: IssueDraft
      target_version: 2
      verified_units: [unit-export-csv]
      evidence:
        - The adapter preserved the canonical title, body, and label operations.
    mapping:
      - unit_id: unit-export-csv
        issue_number: 201
        issue_url: https://github.com/octo-org/widgets/issues/201
        operation: created
        adapter_verified: true
    relationships:
      parent_links:
        - unit_id: unit-export-csv
          status: linked
      dependencies: []
    failed_operations: []
    omitted_units: []
    evidence: []
    failure: null

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| missing_input | The Planner run or canonical draft set is absent. | blocked; write nothing. |
| invalid_input | Required fields, exact labels, identity, or types are malformed. | blocked. |
| unsupported_version | A required handoff is not the supported version. | blocked. |
| legacy_input | A v1 draft-set or Planner-run payload is supplied. | blocked; never convert it. |
| identity_mismatch | Run, canonical source, or parent URLs disagree. | blocked. |
| canonical_set_mismatch | Planner identity and supplied canonical identity differ. | blocked. |
| set_mismatch | Unit IDs or set size differ from the approved set. | blocked. |
| approval_missing | Exact payload, exact set, digest-bound approval, or publication authorization is absent. | blocked. |
| adapter_mismatch | The IssueDraft v2 adapter is not lossless. | blocked; do not write that unit. |
| unconfirmed_unit | A requested unit lacks a confirmed class. | Omit or blocked when no eligible draft remains. |
| parent_overwrite_forbidden | The request would edit or replace the parent. | blocked. |
| duplicate_ambiguous | More than one live issue is an exact-title candidate. | Do not create; record the failed operation. |
| create_failure | create-github-issue returned partial or blocked. | Continue remaining creates; keep successes. |
| parent_link_failure | The sub-issue relationship write failed or is unavailable. | Keep created issues; mark the link failed. |
| dependency_failure | A hard-dependency relationship write failed or is unavailable. | Keep created issues; mark the dependency failed. |
| verification_failure | Live repository, title, URL, mapping, or adapter evidence does not match. | Do not treat the unit as published. |
| blocked_source | The run cannot establish parent identity. | blocked. |

A failure message must not expose tokens, credentials, private keys, .env
contents, personal data, or unnecessary raw command output.
