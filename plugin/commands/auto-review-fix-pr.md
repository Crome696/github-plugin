---
name: auto-review-fix-pr
description: Start the thin review-fix compatibility workflow for one verified GitHub pull request.
---

# `auto-review-fix-pr`

`/auto-review-fix-pr` is a thin entry point for one verified GitHub pull
request. It resolves exactly one repository and pull-request number or URL,
starts the canonical `feedback-agent` with `mode: fix`, and displays the
version-2 `ReviewFixRun` compatibility projection of its version-1
`FeedbackLifecycleRun` result.

The fix handoff is `PullRequestFixPlan v1` with `source_kind: review`;
`ReviewFixRun` remains only the compatibility projection.

The Command contains no review, plan, implementation, Git, or GitHub write
procedure. It never publishes a review, changes a thread, creates a second
pull request, marks Ready-for-Review, rebases, merges, force-pushes, deletes,
or cleans up. The legacy review-fix entry remains a compatibility identity;
`feedback-agent` owns the lifecycle state and decisions.
