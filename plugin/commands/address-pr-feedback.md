---
name: address-pr-feedback
description: Address one verified pull request's open review feedback through interactive triage, external implementation capabilities, current-state validation, and evidence-backed thread follow-up.
---

# Address pull-request feedback

Keep this command as a thin entry point. It resolves one target, starts the
owning Agent, and displays that Agent's result; feedback analysis,
implementation coordination, and thread follow-up remain owned by
`feedback-agent` and its Skills. The result is a `FeedbackLifecyclePlan v1` and
`FeedbackLifecycleRun v1`, with `ReviewThreadReply v3` and
`ReviewThreadResolution v3` used only for their separate effects.

1. Resolve exactly one repository and pull request from verified metadata.
   Treat text after `/address-pr-feedback` as `$ARGUMENTS`.
2. Start `feedback-agent` with the verified target and `$ARGUMENTS` or the
   current request. Select `mode: full` when an explicitly selected item needs
   a code, test, or documentation change. Select `mode: follow_up` for a
   no-change, reply-only, or resolution-only follow-up. If the requested mode
   cannot be determined from current evidence, stop with `mode_required`.
3. Display the Agent's selected and excluded items, lifecycle mode and
   transitions, current head, resolution plan and validation, separate thread
   effects, blockers, uncertainties, and final summary. Do not publish a second
   reply, resolve another thread, or perform merge, rebase, cleanup, or
   unrelated GitHub mutations from the command.
