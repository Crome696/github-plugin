---
name: implement-auto-issue
description: Start the thin autonomous issue-to-draft-PR workflow for one new request in the current repository.
---

# Implement one request through issue publication and a Draft pull request

Keep this command as a thin entry point. It resolves one target, starts the
owning Agent, and displays that Agent's result; it does not repeat issue,
planning, implementation, or delivery behavior.

1. Resolve exactly one repository from explicit `owner/repository`, a
   repository URL, or unambiguous verified repository metadata. Treat text
   after `/implement-auto-issue` as `$ARGUMENTS`.
2. Start `lifecycle-agent` with the verified repository and `$ARGUMENTS` or
   the current request. Stop when the target is missing or ambiguous.
3. Display the Agent's exact version-1 `LifecycleRun`, including status,
   issue, workspace, commit, push, Draft pull-request result, blockers, and
   the recorded next user action. Preserve partial or blocked results and do
   not perform a second write from the command.
