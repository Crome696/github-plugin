---
name: refine-issue
description: Refine one existing GitHub issue into a clear, complete, implementation-ready specification, then update it autonomously within the verified task scope.
---

# Refine one GitHub issue

Keep this command as a thin entry point. It resolves one target, starts the
owning Agent, and displays that Agent's result; it does not repeat issue
loading, analysis, interview, comparison, validation, or publication behavior.

1. Resolve exactly one repository and positive issue number from explicit
   `owner/repository`, an issue URL, or unambiguous verified issue metadata.
   Treat text after `/refine-issue` as `$ARGUMENTS`.
2. Start `issue-agent` with `mode: refine`, the verified repository and issue
   identity, and `$ARGUMENTS` or the current request. Stop when the target is
   missing, ambiguous, malformed, or conflicting.
3. The Agent owns the loaded-issue `conduct-product-interview` version-2
   prerequisite; downstream structuring and rewriting remain deterministic.
   Display the Agent's exact current result, including the target, final
   payload, comparison, blockers, authorization, and any publication or
   verification result. Preserve the Agent's structured `IssueDraft` handoff
   and do not perform a second overwrite.
