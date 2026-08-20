---
name: submit-pr-review
description: Publishes one exactly authorized ReviewDecision to an exact GitHub pull request as a comment, approval, or request for changes, using explicit user approval or a matching target-repository AGENTS.md policy, rechecking the live pull-request head and inline locations immediately before publication and returning verified review findings. Use automatically when an exact ReviewDecision has been authorized for publication.
---

# Submit Pull-Request Review

Publish exactly one approved version-1
[`ReviewDecision`](../../shared/schemas/ReviewDecision.yaml) to its verified
GitHub pull request. This is the only review-publication step. It may publish
the approved `COMMENT`, `APPROVE`, or `REQUEST_CHANGES` event and nothing else.

## Boundaries

- Require exact authorization of the exact payload and the exact event. Treat
  `approval.exact_payload` and `approval.explicit_event_authorization` as
  independent gates; both must be `true`. The authorization may be an explicit
  user approval or a clearly applicable target-repository `AGENTS.md` policy.
- Never silently edit, reorder, omit, reword, downgrade, relocate, or
  otherwise normalize the approved summary, findings, event, target, head SHA,
  or inline comments.
- Never merge, mark a pull request ready, rebase, force-push, edit code, reply
  to discussions, resolve threads, or modify issues, branches, or worktrees.
- Keep durable review payloads and returned handoffs in English. Conversation
  summaries may follow the user's language.
- Never expose secrets, tokens, private keys, `.env` values, personal data, or
  unnecessary command output.

## Input contract

Require exactly one version-1 `ReviewDecision` with `status: approved`,
repository, pull-request number and URL, expected `head_sha`, proposed event,
exact summary, complete finding list, inline comments, and approval evidence.
Also require the matching version-1 `ClassifiedReviewFindings`,
`DeduplicatedReviewFindings`, and exact confirmation record for the same
repository, pull request, head SHA, and included finding IDs. Both approval
flags must be true and must identify the exact target and payload. Do not
infer approval from a prior draft, a general implementation request, or
readiness.

Block before any write when the handoff is missing, malformed, blocked, has
conflicting identity, has an unsupported event, lacks either approval flag, or
contains a finding or inline comment without the required evidence. Preserve
the supplied payload exactly in a blocked or partial result.

Before requesting either approval flag or the finding confirmation record, read
the applicable repository instructions, especially the target repository's
`AGENTS.md`. A policy may authorize review publication, the selected event, and
the included finding decisions only when it clearly identifies this repository,
pull request scope, publication operation, event or finding-decision class, and
any applicable target restrictions. When it matches, set both approval flags to
`true`, preserve the policy source path and concise quote or paraphrase in
`approval.evidence`, and record the finding-set source in
`approval.confirmation_source`; do not wait for another chat approval. If the
policy covers publication but not finding decisions, retain the separate
finding confirmation gate. If no clear policy applies, require the exact user
approvals. A policy never replaces current head, location, evidence,
deduplication, blocker-support, hook, or secret checks.

## Pre-publication freshness gate

Immediately before publishing:

1. Load the exact repository and pull request from GitHub.
2. Verify the pull request number, canonical URL/repository, base and head
   identity, expected `head_sha`, and an allowed open state. Do not publish to
   a closed or merged pull request.
3. Verify that the approved summary, event, findings, and inline comments still
   match the submitted handoff. The live pull request is freshness evidence,
   not permission to alter the approved payload.
4. For every inline comment, verify its path, side, and line against the
   current pull-request diff at the current head SHA. A missing, moved, deleted,
   ambiguous, or otherwise stale position is a hard block for the publication;
   do not move it to a nearby line or convert it to a general comment.

If the head SHA or any location is stale, return `status: blocked` with the
exact stale path/line and current SHA evidence. If a publication request may
have reached GitHub but its result is uncertain, perform one read-only
verification before any further action, then return `partial` if identity,
event, content, or head verification remains incomplete. Never retry an
ambiguous write blindly.

## Deterministic pre-publication Hook gate

After the live preflight passes and immediately before the GitHub write, write
exactly one local version-1
[`PreReviewSubmitGate`](../../shared/schemas/PreReviewSubmitGate.yaml) to
`.cursor/hooks/state/pre-review-submit.json`. Create the ignored state
directory only when it does not exist. The snapshot must preserve the exact
repository, worktree, approved `ReviewDecision`, complete
`ClassifiedReviewFindings`, complete `DeduplicatedReviewFindings`, exact user
confirmation record, and current freshness evidence.

The freshness section must contain:

- one `findings` entry with the current head SHA and `valid: true` for every
  included finding; and
- one `inline_comments` entry with the current head SHA and `valid: true` for
  every exact inline path, line, and side that passed the current-diff
  preflight.

Parse the snapshot again and verify its identity before continuing. Never use
an old, partial, or mismatched snapshot as evidence. The local snapshot is
read-only hook input and does not grant publication authority.

Apply the shared [`cli-transport-file-lifecycle` Rule](../../rules/cli-transport-file-lifecycle.mdc)
and prepare one temporary JSON payload from the approved decision without
rewriting its body, event, commit SHA, or inline-comment content. The exact
payload bytes, the one direct API invocation, and its handled result belong to
one `try/finally` lifecycle; cleanup is guaranteed before later read-only
verification:

```json
{
  "commit_id": "<ReviewDecision.head_sha>",
  "body": "<ReviewDecision.summary>",
  "event": "<ReviewDecision.proposed_event>",
  "comments": [
    {
      "path": "<approved path>",
      "line": 42,
      "side": "RIGHT",
      "body": "<approved inline-comment body>"
    }
  ]
}
```

The internal `finding_id` remains in the handoff and gate for identity
verification; the GitHub review API payload contains the approved path, line,
side, and body projection one-to-one. Do not add fields, comments, suggestions,
or locations that are not already represented by the approved payload.

Invoke only the canonical publication command:

```text
gh api --method POST --input <temporary-payload-file> repos/<owner>/<repository>/pulls/<number>/reviews
```

Do not use `gh pr review`, short method flags, alternate endpoints, shell
pipelines, inline fields, or another review write. The host-specific
`pre-review-submit` Hook runs for the command, verifies the exact payload,
finding evidence, locations, deduplication, recorded finding confirmation,
blocker support, and current pull-request identity, and fails closed on missing,
stale, ambiguous, or structurally invalid evidence. It does not reanalyze the
diff or change the approved review.

The temporary JSON file is deleted by the shared lifecycle after the direct
API call returns, including non-zero exit, timeout, parse failure, or handled
exception. A cleanup warning is sanitized and separate from the review
publication result.

## Publication

After all gates pass, publish one GitHub pull-request review using only the
approved event, summary, and verified inline comments. Use the platform's
review API or equivalent operation that preserves the exact payload. Do not
split one approved review into multiple reviews or substitute a different
comment operation.

`COMMENT` publishes an informational review, `APPROVE` publishes an approval,
and `REQUEST_CHANGES` requests changes. Do not derive or change the event from
finding severity during submission; composition owns that decision.

## Post-publication verification

Read the resulting review once and verify:

- repository, pull-request number, and review URL;
- published event;
- published head SHA;
- exact summary;
- exact finding and inline-comment set, including path, line, side, and body.

Return `status: published` only when all required verification checks pass.
Return `partial` when GitHub reports a result but one or more checks cannot be
verified. Return `blocked` when no write occurred because a precondition
failed. Preserve the exact approved `findings` and record every stale,
unavailable, timeout, or verification detail in `failure` or
`verification.evidence`.

## Output

Return exactly one updated version-1 `ReviewDecision` handoff. Preserve the
approved payload and approval evidence; populate publication and verification
fields only from observed GitHub results. Include the published review ID and
URL and the published finding IDs. The conversation summary should state the
result, event, target, head SHA, and published findings, or the precise reason
publication was blocked/partial.

## Final checklist

- [ ] Exact target and expected head SHA were verified immediately before write.
- [ ] Pull request was open and not merged.
- [ ] Every inline location was valid at the current head; no stale line was moved.
- [ ] A current `PreReviewSubmitGate` was written and re-read successfully.
- [ ] Exact payload and event authorization were both present from the user or
      a matching target-repository `AGENTS.md` policy.
- [ ] The canonical `gh api --method POST --input` command was used; no review
      publication bypass was used.
- [ ] Only the approved review event was published.
- [ ] No merge, code fix, discussion mutation, or other side effect occurred.
- [ ] The resulting review and every published finding were verified.
