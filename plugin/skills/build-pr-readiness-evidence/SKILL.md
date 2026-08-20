---
name: build-pr-readiness-evidence
description: Build one immutable, complete, head-bound PullRequestReadinessEvidence snapshot from dedicated pull-request, policy, checks, approval, discussion, thread, and linked-issue handoffs without network access or mutation. Use before assess-merge-readiness; never invent unavailable requirements or authorize a merge.
---

# Build Pull-Request Readiness Evidence

Build exactly one version-1
[`PullRequestReadinessEvidence`](../../shared/schemas/PullRequestReadinessEvidence.yaml)
snapshot from mutually consistent, deterministic read-only source handoffs.
This Skill is a pure normalizer and validator. It does not acquire GitHub data,
refresh a source, interpret policy in a hook, or authorize a merge.

## Boundaries

- Accept only supplied source handoffs. Never run `gh`, GraphQL, shell, Git, or
  network commands from this Skill.
- Never combine observations from different pull-request heads, base revisions,
  PR node IDs, URLs, or observation windows.
- Never invent a required check, approval threshold, thread disposition, issue
  relationship, acceptance criterion, branch-protection rule, ruleset, or merge
  method when the source is empty or unavailable.
- Preserve empty and unavailable states separately. A retrieved empty source is
  valid evidence; an unavailable source is a fail-closed condition whenever it
  is applicable to readiness.
- Keep source payloads immutable. The output may normalize field names and
  statuses, but must retain source provenance and evidence references.
- The output is diagnostic evidence only. It never authorizes merge, rebase,
  push, review, thread, issue, branch-protection, or branch-cleanup writes.
- Keep the durable handoff in English and do not expose credentials or raw
  sensitive logs.

## Required inputs

Require one identity-bearing `LoadedPullRequest` and the applicable dedicated
source handoffs:

- `LoadedPullRequest` version 1 for the canonical repository, PR number, node
  ID, URL, head OID, base branch, base OID, state, Draft state, and mergeability;
- `LoadedPullRequestDiscussions` version 2 for complete paginated reviews,
  threads, replies, conversation comments, and the discussion-source identity;
- `PullRequestCheckInspection` version 1 for the exact current check set and
  branch-protection/ruleset provenance;
- `RequiredApprovalInspection` version 1 for the current approval threshold,
  approvals, dismissals, and active change requests;
- `OpenReviewThreadAssessment` version 1 for resolved/outdated state and the
  evidence-backed blocking, nonblocking, or uncertain thread disposition;
- `LinkedIssue` version 1 and `LinkedIssueStatusAssessment` version 1 when
  issue coverage is applicable;
- the selected merge-method evidence only when readiness explicitly relies on
  an allowed-method requirement.

Do not downgrade a version-1 discussion handoff into a version-2 snapshot. A
discussion source without the identity fields required by version 2 is
incomplete and must produce a precise failure instead.

## Identity and completeness rules

1. Establish the canonical identity from `LoadedPullRequest` and copy its
   repository, positive PR number, node ID, canonical URL, head OID, base
   branch, and base OID into the snapshot envelope.
2. Require every source to expose or inherit a reproducible identity binding to
   that exact envelope. A different head, base OID, base branch, PR number,
   node ID, repository, URL, or source observation is a mixed-identity block.
3. Require every material source to preserve retrieval status, observation time,
   provenance, and pagination completeness. A partial or unavailable applicable
   source prevents `status: complete`.
4. Require policy sources to identify each applicable branch-protection or
   ruleset response. An explicitly retrieved empty policy is represented as
   `empty`; an inaccessible or ambiguous policy is `unavailable` or `partial`.
5. Require the exact required-check set and current outcomes to be tied to the
   same head OID. Preserve `pass`, `fail`, `pending`, `skipped`, and `unknown`.
6. Require current approval, dismissal, and change-request state from explicit
   policy and review evidence. Raw approval counts do not establish a policy.
7. Require fully paginated discussions. For every thread preserve resolved,
   outdated, and disposition fields; unresolved or uncertain required problems
   remain explicit rather than being inferred away.
8. Require linked-issue and acceptance-criteria evidence whenever readiness
   uses issue coverage. Preserve `covered`, `waived`, `missing`, `ambiguous`,
   `not_applicable`, and `unavailable` distinctly.
9. Mark `freshness: stale` or `freshness: unknown` when any source is older than
   the workflow's approved freshness boundary or cannot prove its observation
   time. Such a snapshot cannot be complete.

## Workflow

1. Validate all supplied schema names and versions before reading fields.
2. Build one canonical identity envelope from `LoadedPullRequest`.
3. Validate every source against the envelope and retain its provenance,
   retrieval status, page count, and unavailable reason.
4. Normalize policy, required checks, approvals, discussions, threads, linked
   issue coverage, and conditional merge-method evidence into the snapshot.
5. Return `status: complete` only when all applicable evidence is current,
   complete, paginated, identity-matched, and interpretable. Otherwise return
   `partial` or `unavailable` with one precise failure and the affected source.
6. Pass exactly this one immutable snapshot to `assess-merge-readiness`.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_identity` | The canonical PR identity is absent or malformed. | `unavailable` |
| `mixed_identity` | Any source has a different repository, PR, node ID, URL, head, or base identity. | `partial` |
| `stale_source` | A source is outside the approved freshness window or its observation time cannot be trusted. | `partial` |
| `incomplete` | Pagination, provenance, policy, checks, approvals, or thread evidence is incomplete. | `partial` |
| `unavailable_policy` | Applicable branch-protection, ruleset, required-check, or approval policy evidence is unavailable. | `unavailable` |
| `unavailable_threads` | Discussion pagination or evidence-backed thread disposition is unavailable. | `unavailable` |
| `invalid_input` | A supplied handoff has an unsupported schema version or malformed shape. | `unavailable` |

## Output requirements

Return one complete version-1 `PullRequestReadinessEvidence` object containing:

- the exact repository, PR number, PR node ID, canonical URL, head OID, base
  branch, base OID, and observation time;
- current freshness and per-source provenance;
- normalized policy and required checks;
- approval, dismissal, and change-request state;
- complete discussion pagination and per-thread state/disposition;
- linked-issue and acceptance-criteria evidence;
- conditional merge-method evidence or `merge_methods.status: not_used`;
- a precise failure object whenever the snapshot is not complete.

Never return a snapshot that silently refreshes an input, merges facts from
different heads, treats unavailable policy as empty, or claims merge
authorization.
