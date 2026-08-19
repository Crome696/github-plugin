---
name: check-open-review-threads
description: Check exactly one pull request for current open review threads and return evidence-backed required problems, optional discussions, resolved threads, outdated threads, and unknown states for merge-readiness workflows. Use automatically when a workflow needs a focused, read-only review-thread gate; never infer actionability, merge requirements, resolution, or addressed status, and never modify GitHub or local files.
---

# Check Open Review Threads

Check exactly one live pull request and return a version-1
[`OpenReviewThreadAssessment`](../../shared/schemas/OpenReviewThreadAssessment.yaml)
handoff. This is a focused, read-only merge-readiness component. It reports
thread facts and evidence; it does not decide whether code is correct, publish
a review, or authorize a merge.

## Boundaries

- Read GitHub and supplied read-only handoffs only. Never edit a pull request,
  review, comment, thread, branch, repository, or local file.
- Never reply to, resolve, reopen, dismiss, minimize, or publish discussion
  content. Never merge, rebase, rerun checks, or resolve conflicts.
- Preserve the exact repository, pull-request number, canonical URL, and
  current head SHA. Reject conflicting identity or stale SHA evidence.
- Treat GitHub's `is_resolved` and `is_outdated` values as authoritative.
  Never infer resolution or addressed status from replies, commits, timestamps,
  or wording.
- Do not infer that every open thread is required, actionable, valid, or
  merge-blocking. Keep optional and uncertain classifications explicit.
- Do not expose credentials, tokens, private keys, `.env` contents, or raw
  sensitive logs.

## Input contract

Accept either:

```yaml
repository: owner/repository
number: 123
```

or one exact GitHub pull-request URL. The repository must contain one non-empty
owner and repository name; the number must be a positive integer. Do not guess
identity from the current checkout, branch, remote, issue, or most recently
viewed pull request.

An optional version-1 `LoadedPullRequestDiscussions` handoff may provide the
thread source. Validate its repository, number, canonical URL, retrieval
status, and head relationship. A partial, stale, conflicting, or unavailable
source cannot support `clear` when it could hide open threads.

Optional `ClassifiedReviewFindings`, `FeedbackResolutionValidation`, or
project-backed requirement evidence may support classification only when the
source identifies the same pull request and current head SHA. They do not
override GitHub thread state.

## Thread semantics

For each retrieved thread:

- `state: open` only when `is_resolved: false`.
- `state: resolved` only when `is_resolved: true`.
- `state: unknown` when resolution is null or unavailable. Do not count it as
  open or resolved, but report it as an uncertainty.
- Preserve `is_outdated` separately. An outdated thread may still be open; it
  is not automatically resolved or addressed.
- Classify an open thread as `required_problem` only when current evidence
  explicitly establishes an actionable requirement, such as a current
  request-for-changes finding, an applicable project-backed rule, or verified
  feedback-resolution evidence identifying an outstanding correction.
- Classify an open thread as `optional_discussion` only when evidence supports
  that it is a suggestion or optional discussion and no requirement conflicts.
- Use `uncertain` when actionability, requirement status, current relevance, or
  evidence is ambiguous. Use `not_assessed` for resolved or unknown threads
  whose classification is not applicable.

Do not call an outdated thread addressed merely because its location is no
longer in the current diff. Preserve its state and explain the missing
verification evidence.

## Workflow

1. Validate the exact identity and supplied handoff metadata. If identity is
   unavailable, return `blocked` with `failure.code: missing_identity`.
2. Verify the pull request and current head:

   ```text
   gh pr view <number> --repo <owner>/<repo> --json number,url,headRefOid,state
   ```

   A missing or conflicting pull request returns `blocked`; a changed head
   invalidates supplied SHA-bound evidence.
3. Use a complete `LoadedPullRequestDiscussions` source when supplied. If it is
   absent or unusable, retrieve the exact pull request's review-thread
   connection with pagination. Retrieve every page of both threads and nested
   comments; never treat the first 100 entries as complete.
4. Preserve each thread's ID, location, current and original commit metadata
   where available, first and latest comment identity, comment count, exact
   bodies, and source references. Sanitize secrets without rewriting ordinary
   discussion text.
5. Partition threads into open, resolved, and unknown from `is_resolved`, and
   track outdatedness independently. Keep resolved and outdated entries in the
   output for auditability.
6. Apply the narrow classification rules above using only supplied,
   SHA-matched evidence. Keep missing, ambiguous, or unavailable evidence in
   `uncertainties`, not in `required_problem`.
7. Return `needs-attention` only for at least one current,
   evidence-backed `required_problem`; return `clear` when complete evidence
   finds no such problem, including when only optional discussions remain.
   Return `blocked` when identity or required discussion evidence is
   unavailable, conflicting, stale, or incomplete enough to make the result
   unreliable.
8. Return exactly one complete `OpenReviewThreadAssessment` object tied to the
   current head SHA, followed by a concise conversation-language summary.

## Evidence requirements

Every required or optional classification must include:

- the smallest verified thread location or `pull-request/<number>`;
- the GitHub thread and comment IDs or URLs;
- the observed request or discussion content;
- the evidence establishing required, optional, or uncertain status;
- a confidence level and the current head SHA where relevant.

Keep source status distinct:

- `[]` means the source loaded and contained no entries;
- `null` or `unavailable_fields` means the field was unavailable;
- `partial` means the exact PR was verified but a required page or field could
  not be retrieved;
- `blocked` means the exact identity or primary source could not be verified.

## Output requirements

Return [`OpenReviewThreadAssessment`](../../shared/schemas/OpenReviewThreadAssessment.yaml)
with exact PR identity, current `head_sha`, every retrieved thread state,
required and optional classifications, resolved and outdated audit entries,
summary counts, source evidence, uncertainties, and failure data when needed.

Never include a merge command, merge authorization, rebase instruction,
resolution action, publication payload, or claim that GitHub was changed.
