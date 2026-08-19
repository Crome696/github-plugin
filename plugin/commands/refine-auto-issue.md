---
name: refine-auto-issue
description: Start the thin autonomous refine-to-draft-PR workflow for one existing GitHub issue in the current repository.
---

# Refine one existing issue and deliver a Draft pull request

Keep this command as a thin entry point. It resolves one target, starts the
owning Agent, and displays that Agent's result; it does not repeat issue,
planning, implementation, or delivery behavior.

1. Resolve exactly one repository and positive issue number from explicit
   `owner/repository`, an issue URL, or unambiguous verified issue metadata.
   Treat text after `/refine-auto-issue` as `$ARGUMENTS`.
2. Start `lifecycle-agent` with `entry_phase: issue_refine`, the verified
   repository and issue identity, and `$ARGUMENTS` or the current request.
   Stop when the target is missing, ambiguous, malformed, or conflicting.
3. Display the Agent's exact version-1 `LifecycleRun`, including status,
   issue, workspace, commit, push, Draft pull-request result, blockers, and
   the recorded next user action. Preserve partial or blocked results and do
   not perform a second write from the command.
