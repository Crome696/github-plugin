---
name: propose-pr-reviewers
description: Propose an optional, evidence-backed reviewer set for one open Draft pull request from existing review requests, CODEOWNERS matches on the changed diff, and scope-matched repository-policy names, without treating CODEOWNERS as merge policy or writing to GitHub. Use automatically when preparing a Ready-for-Review decision; an empty reviewer set is valid.
---

# Propose Pull-Request Reviewers

Compose optional reviewer suggestions for exactly one open Draft pull request
and return a version-1
[`PullRequestReady`](../../shared/schemas/PullRequestReady.yaml) handoff in
`status: draft`. This Skill is read-only. It never marks a pull request ready,
requests reviewers, or infers merge-required CODEOWNERS policy.

## Boundaries

- Read GitHub, the pull-request diff paths, `CODEOWNERS` files, and applicable
  repository instructions only. Never write GitHub, Git, or local files.
- Treat `CODEOWNERS` matches as **suggestions**, never as required-approval
  or merge-policy evidence. Do not change
  [`check-required-approvals`](../check-required-approvals/SKILL.md).
- An empty `reviewers.add` and empty `reviewers.proposed` set is valid.
- Do not invent users, teams, or policy names. Record the evidence source for
  every proposed reviewer.
- Do not mark the pull request ready, request reviewers, edit metadata, publish
  a review, merge, rebase, or create a second pull request.
- Keep the structured handoff in English. Conversation summaries may use the
  conversation language.

## Input contract

Require one version-1 [`LoadedPullRequest`](../../shared/schemas/LoadedPullRequest.yaml)
for the exact repository and pull-request number. Accept an optional version-1
[`LinkedIssue`](../../shared/schemas/LinkedIssue.yaml) and optional changed-path
evidence from [`PullRequestDiffAnalysis`](../../shared/schemas/PullRequestDiffAnalysis.yaml)
or the loaded pull request's file list.

Reject or return `blocked` when repository identity or the pull-request number
is missing, ambiguous, or inconsistent. Do not search for a likely pull request.

## Procedure

1. Confirm the live pull request is the supplied identity. Record current
   `review_requests` as `reviewers.already_requested`.
2. Collect suggestion sources without executing them as requests:
   - existing pending `review_requests`;
   - `CODEOWNERS` owners whose patterns match changed paths from the supplied
     diff or file list, when that file is present and readable;
   - reviewer logins or teams named by a clearly scope-matched target-repository
     `AGENTS.md` policy for this repository and pull request.
3. Deduplicate by `kind` and `login`. Do not add a reviewer who is already in
   `already_requested` to `reviewers.add` unless the later authorization
   explicitly keeps them.
4. Set `reviewers.proposed` with a `source` of `existing_request`, `codeowners`,
   or `repository_policy`. Leave `reviewers.add` empty in the draft; the Agent
   copies the confirmed subset into `add` only after exact authorization.
5. Copy repository, pull-request identity, and `expected_head_sha` from the
   loaded pull request. Set `draft_state.before` from `is_draft`. Set
   `authorization` flags to `false` and `status: draft`.
6. When a unique linked issue is supplied, copy it into `linked_issue` with
   `unique: true`. Otherwise set `unique: false` only when identity fields are
   still known; missing uniqueness is a later `mark-pr-ready` blocker, not a
   reason to invent an issue.

## Output

Return the complete version-1 `PullRequestReady` draft. Pending CI, missing
CODEOWNERS, or an empty suggestion set are warnings in `reviewers.sources`,
not blockers. Do not set `status: approved`.
