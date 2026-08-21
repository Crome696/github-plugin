---
name: plan-product
description: Start the thin product-planning workflow that turns one parent GitHub issue into a prioritized graph of nearly atomic product sub-issues.
---

# Plan product sub-issues for one parent GitHub issue

Keep this command as a thin entry point. It resolves one repository and parent
issue, starts the owning Agent, and displays that Agent's result; it does not
repeat product analysis, interview, mapping, decomposition, graphing,
prioritization, drafting, or publication behavior.

1. Resolve exactly one repository and one positive parent issue number from
   explicit `owner/repository`, an issue URL, or unambiguous verified issue
   metadata. Treat text after `/plan-product` as `$ARGUMENTS`.
2. Start `product-planner-agent` with the verified repository and parent issue
   identity, and `$ARGUMENTS` or the current request. Stop when the target is
   missing, ambiguous, malformed, or conflicting.
3. Display the Agent's exact version-2 `ProductPlannerRun` together with the
   immutable version-2 `ProductSubIssueDrafts` canonical identity, including
   parent identity, issue structure, dependency order, parallel groups,
   confirmed priorities, open decisions, exact titles, bodies, label
   operations, digest, blockers, authorization, and any publication or
   verification result. Preserve partial or blocked results and do not perform
   a second write from the command.
4. Do not treat this command invocation as overall-plan or publication
   approval. Do not build a technical implementation plan, create a worktree,
   commit, or pull request.
