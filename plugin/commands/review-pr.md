---
name: review-pr
description: Review one verified GitHub pull request with evidence-backed, policy-aware findings and separately authorized publication.
---

# Review one pull request

Keep this command as a thin entry point. It resolves one target, starts the
owning Agent, and displays that Agent's result; review analysis and publication
remain owned by `review-agent` and its Skills.

1. Resolve exactly one repository and pull request from verified metadata.
   Treat text after `/review-pr` as `$ARGUMENTS`.
2. Start `review-agent` with the verified target and `$ARGUMENTS` or the current
   review request. The Agent owns the evidence pipeline and the
   `ReviewDecision` handoff.
3. Display the Agent's findings, user or policy decisions, exact
   `ReviewDecision`, draft or publication status, blockers, and evidence. Do not
   publish a second review or perform any pull-request follow-up from the
   command.
