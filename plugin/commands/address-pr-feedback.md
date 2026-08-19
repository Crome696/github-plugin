---
name: address-pr-feedback
description: Address one verified pull request's open review feedback through interactive triage, external implementation capabilities, current-state validation, and evidence-backed thread follow-up.
---

# Address pull-request feedback

Keep this command as a thin entry point. It resolves one target, starts the
owning Agent, and displays that Agent's result; feedback analysis,
implementation coordination, and thread follow-up remain owned by
`feedback-agent` and its Skills.

1. Resolve exactly one repository and pull request from verified metadata.
   Treat text after `/address-pr-feedback` as `$ARGUMENTS`.
2. Start `feedback-agent` with the verified target and `$ARGUMENTS` or the
   current request. The Agent owns feedback triage, resolved-candidate
   analysis, validation, and eligible thread handoffs.
3. Display the Agent's selected and excluded items, current head, resolution
   plan and validation, thread effects, blockers, uncertainties, and final
   summary. Do not publish a second reply, resolve another thread, or perform
   merge, rebase, cleanup, or unrelated GitHub mutations from the command.
