# `auto-review-fix-pr`

`/auto-review-fix-pr` is a thin entry point for one verified GitHub pull
request. It resolves exactly one repository and pull-request number or URL,
starts `review-fix-agent`, and displays its version-1 `ReviewFixRun` result.

The Command contains no review, plan, implementation, Git, or GitHub write
procedure. It never publishes a review, changes a thread, creates a second
pull request, marks Ready-for-Review, rebases, merges, force-pushes, deletes,
or cleans up.
