---
name: integrate-pr
description: Integrate one verified GitHub pull request through readiness, policy-aware base refresh and rebase, post-rebase validation, separately authorized merge, issue-closure verification, and independently authorized cleanup.
---

# Integrate one pull request

Keep this command as a thin entry point. It resolves one target, starts the
owning Agent, and displays that Agent's result; readiness, rebase, merge,
closure, and cleanup remain owned by `integration-agent` and its Skills.

1. Resolve exactly one repository and open pull request from verified metadata.
   Treat text after `/integrate-pr` as `$ARGUMENTS`.
2. Start `integration-agent` with the verified target and `$ARGUMENTS` or the
   current integration request. The Agent owns the `MergeReadiness` and
   `PullRequestIntegration` handoffs.
3. Display the complete lifecycle result, including current revisions,
   readiness, blockers, independent authorizations, issue-closure evidence,
   cleanup outcomes, and limitations. The Agent checks the target repository's
   `AGENTS.md` before approval requests. Do not execute a second hard operation
   or invoke another Agent from the command.
