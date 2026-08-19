---
name: compose-review
description: Composes an exact, non-publishing ReviewDecision draft from explicitly confirmed classified pull-request findings, where confirmation comes from the user or a matching target-repository AGENTS.md policy, grouping blockers, required changes, and optional suggestions with concrete evidence and expected corrections. Use automatically when review findings have been explicitly confirmed for review drafting.
---

# Compose Pull-Request Review

Compose exactly one English version-1
[`ReviewDecision`](../../shared/schemas/ReviewDecision.yaml) handoff from one
validated set of explicitly confirmed classified findings. This is a composition-only
step. It prepares a precise review draft and never publishes or authorizes the
review event.

## Boundaries

- Read only the supplied `ClassifiedReviewFindings` handoff, the confirmation
  record, and optional corroborating `LoadedPullRequest` identity evidence.
- Require explicit confirmation for every included finding. Confirmation may
  come from the user or a clearly applicable target-repository `AGENTS.md`
  policy that covers the exact finding-decision class and pull-request scope.
  Never include unconfirmed, rejected, dismissed, suppressed, or
  discussion-only findings.
- Never invent a finding, evidence, location, impact, correction, verification,
  repository, pull-request number, URL, or head SHA.
- Never edit files, Git state, branches, worktrees, issues, pull requests,
  checks, reviews, comments, or discussions.
- Never publish a review, request changes, approve, merge, mark a draft ready,
  or grant event authorization.
- Keep durable handoff and review text in English. Conversation summaries may
  follow the user's language.
- Do not expose secrets, tokens, private keys, `.env` values, personal data, or
  unnecessary command or log output.

## Input contract

Require:

1. One version-1 `ClassifiedReviewFindings` handoff with status `classified` or
   `partial`.
2. One explicit confirmation record identifying the exact pull request,
   head SHA, finding IDs, and confirmation decision for each included finding.
   Record whether the source is the user or the target repository's
   `AGENTS.md`, including the policy path and concise quote when policy-backed.
3. Every included finding must be active, have `needs_discussion: false`, and
   contain evidence, a repository-relative location, impact, recommendation,
   and verification.

An optional version-1 `LoadedPullRequest` may corroborate repository, pull
request number, URL, and head SHA. It is identity evidence only. Require exact
identity agreement and preserve unavailable fields instead of guessing.

Before treating confirmation as absent, read the applicable repository
instructions, especially the target repository's `AGENTS.md`. A clear,
scope-matched policy may confirm the exact finding decisions without a chat
prompt; record its source path and concise quote or paraphrase in the
confirmation evidence and later `ReviewDecision.approval.confirmation_source`.
If no matching policy exists, require the exact user confirmation. Policy does
not replace finding evidence, location, impact, recommendation, verification,
or the rule that uncertain findings remain out of a change request.

Block when the source is missing, blocked, unsupported, malformed, identity
conflicts exist, confirmation is absent or ambiguous, or an included finding
lacks actionable evidence. Return `partial` only when the confirmed subset is
usable and the omitted or unavailable source context is recorded.

## Grouping and wording

Use these review sections, in this order:

1. `Blockers` for confirmed `blocker` findings.
2. `Required changes` for confirmed `major` and `minor` findings.
3. `Optional suggestions` for confirmed `suggestion` findings.

Omit empty sections. For every included finding, write a concise change
request containing:

- the finding ID and affected path and line;
- observed evidence and concrete impact;
- the expected correction from the finding's recommendation;
- the verification needed to demonstrate the correction.

Use neutral, direct, solution-oriented language. Describe observed behavior,
not speculation. Preserve inline locations when valid; use a general summary
entry when an inline location is unavailable rather than manufacturing a line.
The review event is `REQUEST_CHANGES` when at least one blocker or required
change is included; otherwise use `COMMENT` for suggestions only.

## Workflow

1. Validate contract version, status, pull-request identity, head SHA, finding
   shape, and the exact confirmation record.
2. Select only the explicitly confirmed, active, non-discussion findings.
3. Preserve selected IDs and source references in the `findings` list.
4. Group and compose the exact English review body.
5. Create inline comments only from verified finding locations, preserving
   `finding_id`, path, line, side, body, and any evidence-backed suggestion.
6. Set `status: draft`, `approval.exact_payload: false`, and
   `approval.explicit_event_authorization: false`.
7. Leave publication fields null and verification outcomes `unknown`.
8. Verify every included request has evidence and an expected correction, no
   unconfirmed ID appears, the event matches the selected severities, and the
   target and head SHA are unchanged.

## Output contract

First give a concise summary in the conversation language. Then return exactly
one English version-1 `ReviewDecision` handoff:

```yaml
schema: ReviewDecision
version: 1
status: draft
repository: octo-org/widgets
pull_request:
  number: 42
  url: https://github.com/octo-org/widgets/pull/42
head_sha: "2222222222222222222222222222222222222222"
proposed_event: REQUEST_CHANGES
summary: |
  ## Blockers
  - **F-001 — src/loader.ts:48-49**
    Evidence: Empty responses return before the required error callback.
    Expected correction: Route empty responses through the error or reset path.
    Verification: Add and run the empty-response regression test.
findings:
  - id: F-001
    included: true
approval:
  exact_payload: false
  explicit_event_authorization: false
  approved_by: null
  approved_at: null
  evidence: "confirmation: explicitly confirmed finding set; source recorded in confirmation_source"
  confirmation_source: "user or target-repository AGENTS.md evidence"
inline_comments:
  - finding_id: F-001
    path: src/loader.ts
    line: 48
    side: RIGHT
    body: "Empty responses return before the required error callback. Route this path through the error or reset handling described in the finding."
    suggestion: null
publication:
  review_id: null
  review_url: null
  published_event: unknown
  published_head_sha: null
  published_at: null
verification:
  target_match: unknown
  event_match: unknown
  summary_match: unknown
  inline_comments_match: unknown
  head_sha_match: unknown
  evidence: []
failure: null
```

The handoff is a draft only. The `submit-pr-review` Skill is the only later
workflow allowed to publish it, and it must separately receive authorization
for the exact payload and event from the user or a matching target-repository
`AGENTS.md` policy, recheck the live pull-request head and inline locations,
and preserve the approved review without silent changes.
