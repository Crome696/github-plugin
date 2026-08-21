---
name: auto-ci-fix-pr
description: Start the thin CI-fix workflow for one verified GitHub pull request.
---

# `auto-ci-fix-pr`

`/auto-ci-fix-pr` is a thin entry point for one verified GitHub pull
request. It resolves exactly one repository and pull-request number or URL,
starts `ci-fix-agent`, and displays its version-1 `CiFixRun` result.

The planning handoff used by the run is `PullRequestFixPlan v1` with
`source_kind: ci`; required-check, wait, rerun, failure, and reassessment
evidence remain tagged in that common contract.

The Command contains no wait, rerun, planning, implementation, Git, or
GitHub write procedure. It never publishes a review, changes a thread,
creates a second pull request, marks Ready-for-Review, rebases, merges,
force-pushes, deletes, or cleans up. Green required checks are not merge or
Ready-for-Review authorization.
