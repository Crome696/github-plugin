---
name: publish-draft-pr
description: Publish one issue-linked GitHub Draft pull request from a prepared implementation worktree after validation.
---

# Publish one validated implementation as a Draft pull request

Keep this command as a thin entry point. It resolves one target, starts the
owning Agent, and displays that Agent's result; delivery and publication remain
owned by `delivery-agent` and its Skills.

1. Resolve exactly one repository, existing issue, and prepared worktree from
   verified metadata. Treat text after `/publish-draft-pr` as `$ARGUMENTS`.
2. Start `delivery-agent` with the verified target and matching handoffs,
   including `ImplementationPlan`, `BranchWorkspace`, `LoadedIssue`,
   `WorkingTreeInspection`, version-2 `ValidationResult`, and `CommitProposal`
   when supplied. The Agent owns exact scope and explicit evidence validation
   and the delivery sequence.
3. Display the Agent's current handoffs and final report, including the exact
   scope, evidence requirements, validation results, blockers, authorizations, commit, push, issue
   link, and Draft pull-request result. Do not perform a second write or any
   hard operation from the command.
