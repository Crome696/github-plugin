---
name: ready-pr
description: Mark one verified GitHub Draft pull request Ready-for-Review after independent authorization of its exact identity, unique linked issue, and typed reviewer set, then request only that set through a separate exact POST.
---

# Mark one Draft pull request Ready for Review

Keep this command as a thin entry point. It resolves one target, starts the
owning Agent, and displays that Agent's result; Ready-for-Review analysis and
the GitHub write remain owned by `pr-ready-agent` and its Skills.

1. Resolve exactly one repository and pull request from verified metadata.
   Treat text after `/ready-pr` as `$ARGUMENTS`.
2. Start `pr-ready-agent` with the verified target and `$ARGUMENTS` or the
   current Ready-for-Review request. The Agent owns unique-issue verification,
   optional reviewer proposals, authorization, and the version-1
   `PullRequestReady` handoff.
3. Display the Agent's `PullRequestReady` status, reviewer set, blockers, and
   verification evidence. Do not mark a second pull request ready, request
   additional reviewers, or perform merge or review follow-up from the command.
