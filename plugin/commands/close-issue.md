---
name: close-issue
description: Triage and close one verified GitHub issue without a merged pull request after exact authorization of that repository, issue, and close reason.
---

# Close one GitHub issue without a merged pull request

Keep this command as a thin entry point. It resolves one target, starts the
owning Agent, and displays that Agent's result; issue loading, close-reason
validation, and the GitHub write remain owned by `issue-close-agent` and its
Skills.

1. Resolve exactly one repository and issue from verified metadata. Treat
   text after `/close-issue` as `$ARGUMENTS`.
2. Start `issue-close-agent` with the verified target and `$ARGUMENTS` or the
   current triage-close request. The Agent owns live issue loading, close-reason
   and duplicate-target validation, authorization, and the version-1
   `IssueClosure` handoff.
3. Display the Agent's `IssueClosure` status, recorded reason, blockers, and
   verification evidence. Do not close a second issue, merge a pull request,
   or rewrite issue title or body from the command.
4. Do not treat this command invocation as close authorization. Stop when the
   repository, issue, or close reason is missing or ambiguous.
