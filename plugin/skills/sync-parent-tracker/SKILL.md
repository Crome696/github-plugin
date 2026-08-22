---
name: sync-parent-tracker
description: Reconcile one parent GitHub issue's owned child-status section from a complete ProductSubIssuePublication v2 handoff, using current child evidence, deterministic marker-safe rendering, exact body-only authorization, concurrency protection, and post-write verification. Use for the integrated post-publication phase or an explicitly authorized later rerun; never replace the parent or edit unrelated issue metadata.
---

# Sync Parent Tracker

Synchronize the owned child-status section of exactly one existing parent issue
from one complete, verified `ProductSubIssuePublication v2` handoff. The Skill
reloads the parent and every mapped child, resolves each child state from live
evidence, renders one deterministic Markdown block, and delegates at most one
body-only `IssueUpdate v1` to
[`update-github-issue`](../update-github-issue/SKILL.md). It returns a
`ParentTrackerSynchronization v1` result.

This is the only reusable entry point for a later standalone tracker rerun.
Do not introduce another Command or Agent for that purpose. The existing
`plan-product` Command displays the auxiliary result when this Skill is used
by `product-planner-agent`.

## Boundaries

- Keep the structured handoff, rendered GitHub body, and durable report in
  English. Match conversational updates to the conversation language.
- Target exactly one verified repository and one existing parent issue. Never
  infer a parent from a child title, a branch name, a current checkout, or a
  partial publication mapping.
- Accept only a complete `ProductSubIssuePublication v2` with
  `status: published`. Reject v1, legacy, partial, blocked, stale, malformed,
  contradictory, or ambiguous publication inputs before any parent write.
- Reload the parent and every mapped child on every invocation, including an
  integrated invocation immediately after publication. The publication
  mapping is the identity source; current GitHub reads are the state source.
- Never guess a child state. Missing, stale, contradictory, or non-unique
  issue/PR evidence returns a typed blocked result and performs no parent
  write.
- Manage only the exact marker-delimited tracker block. Never replace the
  parent issue, title, labels, assignees, milestone, state, comments, issue
  history, projects, relationships, or any other metadata.
- The only external update payload is a body-only `IssueUpdate v1`. Do not
  send title, labels, assignee, milestone, state, comment, or relationship
  fields to `update-github-issue`.
- Integrated synchronization requires task-bound authorization for the exact
  parent and exact complete final body. A `ProductSubIssuePublication v2`
  publication approval authorizes child publication only; it does not by
  itself authorize a later standalone body update.
- A standalone rerun requires a new exact body-update authorization after the
  current parent and child evidence have been loaded. Do not reuse the
  original publication authorization or a stale prior tracker result.
- Never retry an ambiguous external write, overwrite concurrent edits, or
  conceal a partial write. Preserve uncertainty and write effects in the
  result.
- Never read or expose credentials, tokens, private keys, `.env` contents, or
  unnecessary issue comments.

## Input contract

Require exactly one complete input:

```yaml
source_publication:
  schema: ProductSubIssuePublication
  version: 2
  status: published
  repository: owner/repository
  parent_issue:
    number: 123
    url: https://github.com/owner/repository/issues/123
  canonical_set:
    schema: ProductSubIssueDrafts
    version: 2
    canonicalization_version: 1
    algorithm: sha256
    digest: <64 lowercase hexadecimal characters>
    unit_ids: [unit-a, unit-b]
  authorization:
    source: task_intent | user_approval | repository_policy
    task_scope: "Exact approved ProductSubIssueDrafts v2 publication"
    publication_authorized: true
    exact_payload: true
    exact_set: true
    canonical_set_digest: <same digest as canonical_set.digest>
    evidence: ["Exact approved canonical draft set was published."]
  adapter:
    status: verified
    source_schema: ProductSubIssueDrafts
    source_version: 2
    target_schema: IssueDraft
    target_version: 2
    verified_units: [unit-a, unit-b]
    evidence: ["Every publication adapter was verified."]
  mapping:
    - unit_id: unit-a
      issue_number: 201
      issue_url: https://github.com/owner/repository/issues/201
      operation: created
      adapter_verified: true
  relationships:
    parent_links: []
    dependencies: []
  failed_operations: []
  omitted_units: []
  evidence: ["Publication identity and relationship evidence loaded."]
  failure: null
authorization:
  mode: integrated | standalone
  source: task_intent | explicit_user | plan_build | repository_policy | session_continuity
  task_scope: "Exact parent body tracker synchronization"
  exact_target: true
  exact_body: true
  update_authorized: true
  approved_body: <the exact complete final parent body>
```

The source publication is valid only when all of the following hold:

1. It is exactly `ProductSubIssuePublication` version 2 with
   `status: published`.
2. Its parent repository, issue number, and URL identify exactly the target
   parent. The target is not inferred from the current checkout or a child.
3. Its canonical set is `ProductSubIssueDrafts v2`, its digest is a valid
   lowercase SHA-256 identity, its unit IDs are unique, and its unit count
   matches the canonical draft set and publication mapping.
4. Every approved unit is mapped exactly once. A duplicate unit, duplicate
   issue mapping, omitted unit, stale mapping, or mapping to the parent blocks
   the run.
5. `adapter.status` is `verified`, the source and target adapter identities
   are the supported v2 contracts, and every mapped unit is in
   `verified_units`.
6. `failed_operations` and `omitted_units` are empty.
7. Every parent link and every hard dependency required by the canonical
   draft set is verified as linked or reused. Missing relationship evidence is
   incomplete publication evidence, not permission to continue.

Recompute or verify the canonical digest using the same canonicalization
rules as `ProductSubIssuePublication v2`. Do not accept a digest merely
because it is present. Preserve the publication's exact source identity and
evidence in the result.

If any input is missing, legacy, unsupported, incomplete, stale, contradictory,
or ambiguous, return a `ParentTrackerSynchronization v1` result with
`status: blocked`, `operation.status: not_started`,
`operation.external_write: false`, a specific failure code, and no parent
write. A `partial` source publication is never treated as `published`; a
`partial` synchronization result is reserved for an attempted or uncertain
parent write whose final effect or verification is incomplete.

## Live evidence and child-state resolution

Read the exact repository, parent issue, and every mapped child with the
narrowest available GitHub capability. Typical reads are:

```text
gh repo view <owner/repository> --json nameWithOwner,url,defaultBranchRef
gh issue view <parent-number> --repo <owner/repository> --json number,url,title,body,state,updatedAt,labels,assignees,milestone,comments
gh issue view <child-number> --repo <owner/repository> --json number,url,state,updatedAt,title
gh pr list --repo <owner/repository> --state all --search "<child issue reference>" --json number,url,state,mergedAt,baseRefName,baseRefOid,mergeCommit,closingIssuesReferences
```

Use a host capability with equivalent exact fields when the CLI is not the
available transport. Record the source, target, retrieval time, and observed
value without copying sensitive diagnostics.

For each mapped child, resolve exactly one of these states:

- `open`: the current child issue is open.
- `merged`: the current child issue is closed and one current, unambiguous,
  causally linked, verified merge PR is established. The merge evidence must
  include the exact repository, PR number and URL, `state: merged`, merge
  timestamp, base branch and base identity, and merge commit SHA. The PR's
  relationship to this exact child must also be current and unambiguous.
- `closed`: the current child issue is closed and current evidence is
  sufficient to establish closure without a verified causal merge PR.

Do not turn a closed issue into `merged` because a PR mentions the issue, has a
similar title, is temporally nearby, or is merely in the same repository. Do
not turn unavailable PR evidence into `closed` when the issue/PR relationship
itself is ambiguous. A missing, stale, conflicting, or non-unique observation
returns `blocked` with `child_state_unavailable` or
`child_state_ambiguous`, whichever is narrower, and performs no parent write.

## Deterministic owned-section rendering

The owned section uses exactly these markers, each on its own line:

```text
<!-- github-plugin:parent-tracker:start -->
<!-- github-plugin:parent-tracker:end -->
```

Render the complete section exactly as follows, with one row per mapped unit:

```markdown
<!-- github-plugin:parent-tracker:start -->
## Child issue status

| Unit | Issue | URL | State |
| --- | --- | --- | --- |
| <unit_id> | #<number> | <exact issue URL> | open |
<!-- github-plugin:parent-tracker:end -->
```

Rendering rules are normative:

- Sort rows numerically by GitHub issue number, then lexicographically by
  `unit_id` as a stable tie-breaker.
- Use only `unit_id`, issue number, exact current issue URL, and resolved
  current state from the verified child observations. Do not render titles,
  guessed states, stale URLs, or publication order.
- Preserve the parent's existing line-ending convention. If the body is new
  or has no identifiable convention, use LF. The rendered block itself uses
  the chosen convention consistently.
- No markers means append one owned section to the existing body, preserving
  all existing bytes and the selected line-ending convention.
- Exactly one correctly ordered, non-nested marker pair means replace only
  the bytes from the start marker through the end marker, inclusive.
- A missing counterpart, duplicate marker, reversed marker order, nested
  marker, marker on a line with other content, or any other malformed pair
  returns `blocked` with `malformed_owned_section` and performs no write.
- Bytes outside the owned block remain byte-for-byte unchanged. Never trim,
  normalize, reflow, or otherwise rewrite surrounding parent content.
- If the complete calculated body equals the live parent body, return
  `status: no-op` and `operation.status: no_op` without calling GitHub.

The preview must contain the exact full final body, the marker version, row
order, baseline `updatedAt`, and the preservation comparison for bytes outside
the owned block. The preview is not an authorization substitute.

## Authorization and bounded update

Before an external write, require an approved `ParentTrackerSynchronization`
input with all of these exact gates:

- `authorization.exact_target: true` identifies the verified repository,
  parent number, and parent URL;
- `authorization.exact_body: true` and `authorization.approved_body` equal the
  complete rendered final body byte-for-byte;
- `authorization.update_authorized: true` and the source/evidence cover this
  exact body-only parent update;
- integrated mode binds the authorization to the current task and verified
  publication; standalone mode records its own fresh authorization; and
- no authorization field grants title, label, assignee, milestone, state,
  comment, history, or relationship mutation.

If exact authorization is absent, return `status: draft` for a proposal-only
preview with `operation.status: not_started` when the request is otherwise
well-formed. If the input claims to be approved but any exact gate is false,
return `status: blocked` with `failure.code: approval_missing` and no write.

Immediately before delegation, reload the exact parent and compare its
repository, issue number, URL, `updatedAt`, full body, and captured metadata
with the preview baseline. If `updatedAt` or body bytes changed, return
`status: blocked`, `failure.code: edit_conflict`,
`operation.status: not_started`, and do not overwrite the concurrent edit.

Delegate only this lossless body-only handoff:

```yaml
schema: IssueUpdate
version: 1
status: approved
issue:
  repository: owner/repository
  number: 123
  url: https://github.com/owner/repository/issues/123
patch:
  body: <exact complete rendered parent body>
approval:
  exact_payload: true
  update_authorized: true
  source: task_intent | explicit_user | plan_build | repository_policy | session_continuity
  task_scope: "Exact parent body tracker synchronization"
  evidence: "Exact parent identity and exact complete body are approved."
baseline:
  title: <live title>
  body: <live body from the immediate pre-write read>
  state: <live state>
  labels: [<live labels>]
  assignees: [<live assignees>]
  milestone: <live milestone or null>
  updated_at: <live updatedAt>
```

The downstream `update-github-issue` Skill must use no patch field other than
`body`. Its own live re-read and post-write verification remain authoritative.
Do not perform a second parent write in this Skill.

## Operation and verification result

Return exactly one English `ParentTrackerSynchronization v1` result. The
result preserves the source publication, parent baseline, all child
observations, rendered owned section, exact authorization, and all write and
verification evidence.

Use these statuses:

- `draft`: complete preview with no exact write authorization; no write.
- `approved`: exact body and target authorization verified before dispatch;
  include the planned operation and do not claim an external effect yet.
- `no-op`: the complete final body already equals the live body; no write.
- `updated`: one body-only update was dispatched and exact post-write and
  preservation checks passed.
- `partial`: a body update occurred or may have occurred but final effect,
  metadata preservation, or post-write verification is incomplete.
- `blocked`: no parent write occurred because an input, evidence,
  authorization, marker, concurrency, or capability precondition failed.

Use these operation statuses independently of the top-level result:

```text
not_started | no_op | updated | partial
```

Post-write verification must prove:

- the live parent repository, issue number, and URL are exact;
- the final body contains exactly the approved owned section and the exact
  expected rows;
- all bytes outside the owned block are unchanged from the immediate
  pre-write baseline;
- the parent's title, labels, assignees, milestone, state, comments, and
  other captured metadata remain unchanged; and
- the `IssueUpdate v1` result and live read agree about the actual effect.

If a write failed before any external effect, return `blocked`. If the write
may have occurred or one part of verification is uncertain, return `partial`
and do not retry automatically.

## Failure modes

| Code | Meaning | Result |
| --- | --- | --- |
| `missing_input` | The publication, parent identity, child mapping, or authorization structure is absent. | `blocked`; no write. |
| `unsupported_version` | A required handoff is not the supported version. | `blocked`; no write. |
| `legacy_input` | A v1 or otherwise legacy publication or authorization is supplied. | `blocked`; never adapt it. |
| `publication_incomplete` | The publication is not `published`, the digest/set differs, an adapter is unverified, a unit is omitted/duplicated, or relationships are incomplete. | `blocked`; no write. |
| `identity_mismatch` | Repository, parent, child, unit, or URL identities conflict. | `blocked`; no write. |
| `mapping_incomplete` | A canonical unit is missing, duplicated, or mapped more than once. | `blocked`; no write. |
| `child_state_unavailable` | A current child issue or required merge evidence cannot be loaded. | `blocked`; no write. |
| `child_state_ambiguous` | More than one issue/PR candidate or contradictory current evidence prevents a state decision. | `blocked`; no write. |
| `malformed_owned_section` | Markers are missing as a pair, duplicated, reversed, nested, or not line-delimited. | `blocked`; no write. |
| `approval_missing` | Exact target, exact body, or body-update authorization is absent. | `draft` for an unapproved proposal; otherwise `blocked`. |
| `edit_conflict` | Parent `updatedAt` or body changed after preview and before delegation. | `blocked`; no write. |
| `api_failure` | A read or delegated update failed. | `blocked` if no effect; `partial` if effect is possible. |
| `verification_incomplete` | A dispatched write cannot be fully verified. | `partial`; never retry automatically. |

Every non-success result records the phase, external-write state, exact
available evidence, preservation state, and whether a new explicitly
authorized rerun is safe. Never claim `updated` from a publication result,
from a successful delegation alone, or from a stale parent read.
