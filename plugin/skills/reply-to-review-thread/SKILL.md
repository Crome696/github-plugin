---
name: reply-to-review-thread
description: Drafts and publishes one factual reply to exactly one GitHub pull-request review thread, using direct user authorization, a matching target-repository AGENTS.md policy, or an exact address-pr-feedback authorization after validated follow-up, and never resolving the thread. Use automatically when the user asks to answer, respond to, or explain handling of a pull-request review thread.
---

# Reply to a Pull-Request Review Thread

Draft and optionally publish one concise, factual reply to exactly one
GitHub inline review thread. Direct invocation requires exact authorization of
the target and response. The `/address-pr-feedback` workflow may publish
autonomously only with a matching current validation and scoped authorization.

## Boundaries

- Keep the persisted handoff and GitHub-facing response in English; chat may
  follow the conversation language.
- Accept the repository, pull-request number or URL, thread ID, and parent
  comment ID only from explicit input or a verified discussion snapshot. Never
  guess an identity from the current checkout or most recently viewed PR.
- Address one thread only. Preserve the thread's exact body, location, author,
  current head SHA, resolution state, and parent comment as retrieved facts.
- Base claims only on supplied or freshly retrieved evidence: current diff
  locations, commit SHAs, test or check results, and relevant repository or
  issue requirements. Do not claim that a change, test, check, deployment, or
  reviewer intent exists without evidence.
- If no change was made, explain only the evidenced reason, such as a verified
  requirement, current behavior, or an explicit decision supplied by the user.
  If the reason is not evidenced, return a clarification or unverifiable
  blocker instead of inventing one.
- Never resolve, unresolve, dismiss, minimize, edit, or delete a thread or
  comment. Never submit a review, merge, rebase, change code, or modify Git
  state.
- Do not expose secrets, credentials, private keys, `.env` values, or
  unnecessary command output.

## Input contract

Require one version-2 `ReviewThreadReply` handoff or equivalent inputs:

```yaml
repository: owner/repository
pull_request:
  number: 123
  url: https://github.com/owner/repository/pull/123
thread:
  id: PRRT_example
  parent_comment_id: 456
head_sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
response: "Exact English response"
evidence:
  - kind: diff | commit | test | check | requirement | user_decision
    reference: "path:line, SHA, check name, or source reference"
    summary: "Observed evidence"
approval:
  exact_payload: false
  publication_authorized: false
feedback_authorization:
  mode: not_applicable
  authorized: false
```

The response must be a complete body, not merely a direction or summary. A
draft may have both approval flags false. Publication requires both flags true
for direct invocation, or a matching feedback-mode authorization identifying
the exact target, parent comment, feedback item, current head SHA, and response.
Before treating direct authorization as missing, read the applicable repository
instructions, especially the target repository's `AGENTS.md`. A clear,
scope-matched policy may authorize the exact reply, target, and publication
effect; record its source path and concise quote or paraphrase in
`approval.evidence`, set both flags to `true`, and do not wait for a chat
approval. If no matching policy exists, require the exact user approval. A
policy must explicitly cover a resolved or outdated thread if it is to
authorize replying despite that state. Do not infer authorization from a
general request, a previous reply, a resolved finding, or a readiness state.

Block before any write when identity, parent relationship, current head, or
response evidence is missing; the thread is not retrievable; the pull request
is closed or merged; the payload is stale or ambiguous; or the response
contains an unsupported claim. A resolved or outdated thread is a separate
state gate: do not publish to it unless the exact user authorization or
matching repository policy identifies that thread state and authorizes
replying despite it. Never infer that authorization from the reply text or
from a prior publication authorization.

## Draft workflow

1. Validate the explicit repository and pull-request identity. Load the exact
   pull request and its discussion snapshot, or the exact thread through the
   GitHub API. Confirm that the supplied thread and parent comment belong to
   that pull request. Record the retrieved `is_resolved` and `is_outdated`
   state as context; do not infer either state from the latest reply.
2. Inspect the thread's latest actionable feedback and determine whether the
   supplied evidence demonstrates that it was addressed, intentionally left
   unchanged, or remains unverifiable. Keep these outcomes distinct.
3. Compose one professional response:
   - state what was done, or that no change was made;
   - cite the smallest useful changed path/line, commit, test, check, or
     explicit decision;
   - state remaining limitations or ask for clarification when evidence is
     insufficient;
   - do not state or imply that the thread is resolved.
4. Return a `draft` `ReviewThreadReply` with the exact response and evidence.
   Present the exact target, parent comment, head SHA, response, and evidence
   to the user for approval unless a matching target-repository policy or
   feedback-mode authorization is already present.

## Publication workflow

For direct invocation, continue only after the user has explicitly approved the
exact response and publication or a matching target-repository `AGENTS.md`
policy has authorized them. In `/address-pr-feedback` mode, continue only
after the matching `FeedbackResolutionValidation` is current and `validated`,
the item is `addressed`, all applicable checks and tests pass at the current
head, and the exact feedback-mode authorization is present.

1. Reload the exact pull request and thread immediately before writing. Verify
   repository, PR number and URL, open/non-merged state, current head SHA,
   thread ID, parent comment ID, and that the parent still belongs to the
   target thread. Recheck `is_resolved` and `is_outdated`; if either changed
   since approval, return `blocked` unless the approval explicitly covers the
   new state. If the head or parent relationship changed, return `blocked`;
   do not silently rewrite or retarget the response.
2. State the exact target and effect: publish one reply to the specified
   review-thread parent comment, without resolving or otherwise changing the
   thread.
3. Publish only the approved body as a reply to the approved parent comment.
   The REST equivalent is:

   ```text
   gh api repos/<owner>/<repo>/pulls/<number>/comments \
     -f body='<approved body>' -F in_reply_to=<parent-comment-id>
   ```

   Do not use a top-level issue comment or a new review as a substitute.
4. Fetch the resulting comment once and verify repository, pull request,
   comment ID/URL, parent relationship, exact body, author, and current head
   evidence when available. Verify that no thread-resolution mutation was
   requested or performed.
5. Return `published` only when the reply is confirmed. If GitHub reports a
   result but verification is incomplete, return `partial`. If a write may
   have happened and its result is ambiguous, perform one read-only lookup
   before any further action and return `partial` if it remains uncertain.
   Return `blocked` when no write occurred.

## Output

Return exactly one updated `ReviewThreadReply` handoff. For a successful
publication, include the verified response body, comment URL and ID, parent
comment ID, target PR, publication timestamp, current head evidence, and
verification evidence. For `blocked` or `partial`, preserve the exact
approved response and record the precise missing, stale, unavailable, or
ambiguous evidence. In the conversation, return the published answer itself
and its verified URL; never claim publication without verification.

## Final checklist

- [ ] Exactly one repository, pull request, thread, and parent comment verified.
- [ ] Response contains only evidence-backed claims and explicit limitations.
- [ ] Exact response and publication were separately authorized by the user or
      a matching target-repository `AGENTS.md` policy, or the exact
      feedback-mode authorization is present.
- [ ] Current head and parent relationship were refreshed immediately before write.
- [ ] The API operation created a reply, not a top-level comment or review.
- [ ] Published body, parent, target, URL, and ID were verified.
- [ ] No thread resolution or other unrelated mutation occurred.
