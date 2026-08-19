---
name: prepare-issue
description: Prepare one verified existing GitHub issue for an autonomous implementation handoff without implementing changes.
---

# Prepare one existing GitHub issue for implementation handoff

Keep this command as a thin entry point. It resolves one target, starts the
owning Agent, and displays that Agent's result; it does not repeat planning or
workspace behavior.

1. Resolve exactly one repository and existing issue from explicit
   `owner/repository`, a repository URL, or verified issue metadata. Treat text
   after `/prepare-issue` as `$ARGUMENTS`.
2. Start `preparation-agent` with the verified repository, issue identity, and
   `$ARGUMENTS` or the current request. The Agent owns the
   `ImplementationPlan` and `BranchWorkspace` handoffs.
3. Display the complete current `ImplementationPlan` and `BranchWorkspace`,
   including status, evidence, capabilities, validation, workspace identity,
   blockers, and authorization. Preserve partial or blocked results and do not
   create a second workspace or invoke another Agent.
