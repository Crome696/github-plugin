---
name: assess-merge-readiness
description: Transform exactly one complete PullRequestReadinessEvidence snapshot into a deterministic diagnostic MergeReadiness result. Use automatically after the snapshot producer; never acquire live state, refresh sources, merge, rebase, resolve conflicts, rerun checks, mutate reviews or threads, or change local files.
---

# Assess Pull-Request Merge Readiness

Transform exactly one version-1
[`PullRequestReadinessEvidence`](../../shared/schemas/PullRequestReadinessEvidence.yaml)
snapshot into one version-3
[`MergeReadiness`](../../shared/schemas/MergeReadiness.yaml) handoff. This is a
pure, deterministic, read-only diagnostic transformation. `ready` means only
that the supplied complete snapshot satisfies the explicitly recorded
conditions; it never authorizes a merge.

## Boundaries

- Accept exactly one complete `PullRequestReadinessEvidence` version 1 object.
  Do not accept optional individual reader handoffs or an unbound repository/PR
  shorthand.
- Perform no network, GitHub, shell, Git, filesystem, or authentication
  acquisition. Missing, stale, partial, unavailable, or inconsistent evidence
  is a result condition, not a reason to refresh a source.
- Preserve the snapshot identity: repository, PR number, PR node ID, canonical
  URL, head OID, base branch, base OID, and observation time.
- Never invent an approval threshold, required check, issue relationship,
  acceptance criterion, merge method, thread disposition, or policy requirement.
- Never merge, rebase, resolve conflicts, rerun checks, publish or dismiss a
  review, reply to or resolve a thread, change repository settings, or clean up
  Git.
- Keep unavailable, ambiguous, stale, empty, partial, and unsupported evidence
  explicit. Empty is valid retrieved evidence; unavailable is not a pass.
- Keep the durable handoff in English and do not expose credentials or raw
  sensitive logs.

## Input contract

Require one version-1 `PullRequestReadinessEvidence` handoff with
`status: complete`. Reject any other schema, version, status, or duplicate
snapshot input with `status: blocked` and a precise blocker. The complete
snapshot must have current freshness, complete source pagination, a single
identity envelope, and no applicable unavailable or partial source.

The assessment does not know how to acquire or repair evidence. The upstream
`build-pr-readiness-evidence` Skill and the Integration Agent own source
collection, identity checks, provenance, pagination, and full invalidation when
the pull-request head, base, policy, checks, reviews, threads, or linked issue
changes.

## Assessment rules

Return exactly one status:

- `blocked`: the snapshot is not complete, the identity is malformed or
  inconsistent, freshness is stale or unknown, required policy or thread
  evidence is unavailable, or the PR state cannot support a reliable result.
- `needs-attention`: the snapshot is complete and assessable, but it records a
  Draft PR, conflicts, failing/pending/skipped/unknown required checks, active
  change requests, unresolved blocking or uncertain threads, unmet approval
  requirements, missing or ambiguous issue coverage, or another evidenced
  condition requiring action.
- `ready`: the snapshot is complete and current; the PR is open and non-Draft,
  mergeable, every explicitly required check passes, every explicit review
  requirement is met, no current blocking or uncertain thread remains, no
  active change request remains, and issue coverage is either exactly one
  covered relationship or a complete authorized waiver.

If policy evidence says that no check, approval, thread, issue, or merge-method
condition applies, preserve that recorded empty or not-applicable state. If a
potentially applicable requirement is unavailable or ambiguous, return
`blocked`; never interpret it as no requirement.

## Workflow

1. Validate the single snapshot schema, version, complete status, freshness,
   source status, and identity envelope.
2. Copy the exact repository, PR identity, head SHA, and base branch into the
   result. Preserve the snapshot under `readiness_evidence`.
3. Derive pull-request state and mergeability from the snapshot's canonical PR
   source.
4. Derive required-check results from the snapshot's exact policy-bound check
   set. Required checks must be `pass` for `ready`.
5. Derive approval count, dismissal state, active change requests, and approval
   threshold from the snapshot's normalized approval evidence.
6. Derive resolved/outdated/current thread state and blocking, nonblocking, or
   uncertain disposition from the snapshot. Do not turn optional discussions
   into blockers without source evidence.
7. Derive linked-issue status and acceptance-criteria coverage from the
   snapshot. Preserve complete waiver evidence when the status is `waived`.
8. Construct concrete blockers, remaining conditions, and uncertainties with
   reproducible snapshot/source evidence.
9. Return one complete version-3 `MergeReadiness` object. Given byte-equivalent
   snapshot input, the output must be structurally deterministic; no clock or
   live state may alter the result.

## Failure modes

| Code | Use when | Result |
| --- | --- | --- |
| `missing_snapshot` | No single readiness snapshot was supplied. | `blocked` |
| `invalid_snapshot` | The snapshot schema, version, status, or required identity is malformed. | `blocked` |
| `stale_snapshot` | Snapshot freshness is stale or unknown. | `blocked` |
| `mixed_identity` | Snapshot sources do not share one repository, PR, node ID, head, or base identity. | `blocked` |
| `incomplete_evidence` | Applicable policy, check, approval, discussion, thread, or issue evidence is partial or unavailable. | `blocked` |
| `condition_unmet` | Complete evidence records an actionable readiness condition. | `needs-attention` |

## Output requirements

Return [`MergeReadiness`](../../shared/schemas/MergeReadiness.yaml) version 3
with:

- `status`: exactly `ready`, `needs-attention`, or `blocked`;
- exact repository, pull-request identity, base branch, and head SHA;
- derived mergeability, check, review, thread, and issue-coverage state;
- complete `readiness_evidence` containing the one immutable source snapshot;
- evidence-backed blockers, remaining conditions, uncertainties, and
  `assessed_at` only when the supplied snapshot already contains the relevant
  observation time.

Never include a merge command, merge authorization, rebase instruction,
conflict-resolution action, source refresh, or claim that GitHub was changed.
