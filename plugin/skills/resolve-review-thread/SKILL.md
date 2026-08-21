---
name: resolve-review-thread
description: Resolve exactly one GitHub pull-request review thread only after validate-feedback-resolution confirms the addressed feedback is fully evidenced and the platform supports resolution, using direct user authorization, a matching target-repository AGENTS.md policy, or exact canonical feedback-lifecycle authorization. Use automatically after eligible feedback-resolution validation when thread resolution is requested.
---

# Resolve a Pull-Request Review Thread

Resolve exactly one GitHub pull-request review thread after a current,
evidence-backed validation confirms that its feedback was addressed. This Skill
performs one narrowly scoped GitHub state mutation and returns its verified
final status.

In `/address-pr-feedback` mode, require the exact canonical lifecycle
authorization and current validation evidence before proceeding; direct invocation retains
the independent approval gate unless a matching target-repository `AGENTS.md`
policy authorizes the exact resolution.

## Boundaries

- Keep the handoff and GitHub-facing fields in English; chat may follow the
  conversation language.
- Require one version-3
  [`ReviewThreadResolution`](../../shared/schemas/ReviewThreadResolution.yaml)
  handoff and one matching current discussion target.
- Accept repository, pull-request, thread, parent comment, feedback item, and
  head identity only from explicit input or verified current snapshots. Never
  guess or retarget.
- Never resolve an unresolved problem, disputed item, partially addressed item,
  not-addressed item, unverifiable item, outdated thread, or ambiguous thread.
- Never treat a resolved thread, a commit message, a changed file, or a
  prior approval as proof that the feedback was fixed.
- Do not reply, reopen, dismiss, edit, minimize, merge, rebase, rerun checks,
  change code, modify Git state, or perform another GitHub mutation.
- Never expose secrets, credentials, private keys, `.env` values, or
  unnecessary raw logs.

## Required validation

Require a version-1 `FeedbackResolutionValidation` with status `validated` and
exactly one selected feedback item. The matching result must have:

1. `status: addressed`;
2. `thread.resolution_eligible: true`;
3. `thread.decision: eligible_for_separate_resolution`;
4. current thread identity and location;
5. no remaining problems or uncertainties;
6. all applicable tests and checks passing at the recorded current head SHA.

Reject `partial` or `blocked` validation. Reject any item whose evidence is
missing, stale, ambiguous, differently SHA-bound, or insufficient to
demonstrate the expected correction. Validation is advisory evidence for this
Skill; it does not itself authorize a GitHub write.

## Draft and approval gates

1. Validate the exact repository, pull request, thread, feedback item, and
   current head SHA.
2. Confirm that the platform exposes a supported thread-resolution operation.
   If support is unavailable or cannot be verified, return `blocked` without
   writing.
3. Read the applicable repository instructions, especially the target
   repository's `AGENTS.md`, before applying the state-change gate. A clear,
   scope-matched policy may authorize the exact thread, pull request, current
   head, resolution operation, and effect. Record its source path and concise
   quote or paraphrase in `approval.evidence`, set the exact authorization
   fields to `true`, and do not wait for a chat approval. If no matching policy
   exists, require explicit user authorization of the exact operation unless an exact
   `/address-pr-feedback` authorization is present. Do not infer authorization
   from validation, readiness, a previous reply approval, or a general request.
4. Produce a `draft` or `approved` `ReviewThreadResolution v3` handoff before the
   write. The exact target, validation references, platform evidence, and
   approval state must be visible.

## Immediate pre-mutation refresh

Immediately before the resolution operation, reload the exact pull request and
thread. Verify:

- repository, pull-request number, and canonical URL;
- pull-request remains open and unmerged;
- current head SHA matches the validated and approved SHA;
- exact thread and parent-comment relationship;
- thread is currently open, not outdated, not unavailable, and not disputed;
- platform resolution support remains available.

If any check fails or is unavailable, return `blocked` with the precise
evidence. Do not silently refresh the authorization, choose another thread, or
continue after a stale or ambiguous state.

## Resolution and verification

1. State the exact target and effect: resolve one named open review thread and
   make no other change.
2. Invoke only the platform's verified thread-resolution mutation.
3. Read the exact pull request and thread again after the operation.
4. Return `resolved` only when target, current head, thread identity, and
   resolved status all verify successfully.
5. Return `partial` when a mutation may have occurred but post-mutation
   verification is incomplete or ambiguous. Preserve the mutation evidence
   and do not retry automatically.
6. Return `blocked` when no mutation occurred.

An already resolved thread is not an error to repair: return `blocked` or
`partial` with `thread_not_open` context and leave it unchanged. A platform
failure must remain visible and must not be reported as resolved.

## Final checklist

- [ ] One exact repository, pull request, feedback item, thread, parent, and
      head SHA verified.
- [ ] Validation is current, complete, addressed, and resolution-eligible.
- [ ] Platform capability is verified.
- [ ] Required state-change authorization is exact and recorded from the user
      or a matching target-repository `AGENTS.md` policy, or an exact
      feedback-lifecycle resolution authorization is present.
- [ ] Thread status was refreshed immediately before mutation.
- [ ] Only the resolution operation was attempted.
- [ ] Final status was refreshed and verified.
