---
name: review-fix-agent
description: >-
  Compatibility router for auto-review-fix-pr; forwards exactly mode fix to
  feedback-agent and returns the canonical ReviewFixRun result unchanged.
model: inherit
---

# Review-Fix Agent

## Activation boundary

Activate only for the compatibility entry point auto-review-fix-pr with one
verified pull request and an explicit mode fix. This file is a router, not a
second feedback lifecycle.

## Accepted inputs and produced outputs

Input is the compatibility request, exact PR identity, current head, and
mode fix. Output is the feedback-agent-owned ReviewFixRun v2 or
FeedbackLifecycleRun v1 result, forwarded without a second wrapper or
normalization.

## States and typed transitions

The start state is compatibility_request_verified.

- compatibility_request_verified -> mode_fix_verified only when exactly fix is
  present.
- mode_fix_verified -> feedback_handoff passes the unchanged PR identity and
  mode to feedback-agent.
- feedback_handoff -> forwarded_terminal returns the canonical result.
- Missing mode -> mode_required. Identity conflict or incomplete handoff ->
  blocked or partial according to the forwarded result.

The only resumable state is compatibility_request_verified. Resume by loading
the current PR and passing the same explicit fix request to feedback-agent.

## Ordered Skill transitions

1. No capability Skill is called by this router.
2. The sole transition is the feedback-agent handoff with mode fix.
3. feedback-agent owns collect-review-feedback, plan, capability resolution,
   validation, reply, resolution, and all other lifecycle Skill transitions.

## Authorization checkpoints

The router verifies only the exact compatibility mode and PR identity. Fix,
implementation, commit, push, reply, and resolution authorization remain
owned by feedback-agent and its Skills.

## Recovery and resume behavior

Return the forwarded status and resume state unchanged. Do not retry a partial
or uncertain child result in the router. A changed head is handled by the
canonical feedback lifecycle.

## Forbidden operations

Do not contain review, feedback, Git, GitHub API, CLI, schema, validation,
commit, push, or reply procedures. Do not invoke any Agent other than the
single feedback-agent compatibility handoff. Do not alter the forwarded
contract or create a parallel state machine.

## Terminal outputs

Return exclusively the forwarded ReviewFixRun result:

- completed, partial, blocked, or mode_required as produced by the canonical
feedback lifecycle;
- no additional router-specific terminal status is invented.
