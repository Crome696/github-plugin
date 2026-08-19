---
name: reprioritize-issues
description: Start the thin open-issue reprioritization workflow that assigns unique consecutive P-number title prefixes to every currently open GitHub issue in one repository after exact ranked-set authorization.
---

# Reprioritize open GitHub issue titles

Keep this command as a thin entry point. It resolves one repository, starts
the owning Agent, and displays that Agent's result; it does not repeat
inventory, ranking, or title-write behavior.

1. Resolve exactly one repository from explicit `owner/repository`, a
   repository URL, or unambiguous verified repository metadata. Treat text
   after `/reprioritize-issues` as `$ARGUMENTS`.
2. Start `issue-reprioritize-agent` with the verified repository and
   `$ARGUMENTS` or the current request. Stop when the target is missing or
   ambiguous.
3. Display the Agent's exact version-1 `IssueReprioritization`, including
   status, ranking identity, per-issue title results, blockers, and the
   recorded next user action. Preserve partial or blocked results and do not
   perform a second write from the command.
4. Do not treat this command invocation as ranked-set or title-write
   approval. Do not change issue bodies, labels, or state, and do not start
   another Agent.
