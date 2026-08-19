---
name: create-issue
description: Start the thin autonomous GitHub issue-creation workflow for the current repository.
---

# Create one GitHub issue

Keep this command as a thin entry point. It resolves one target, starts the
owning Agent, and displays that Agent's result; it does not repeat issue
interview, drafting, validation, or publication behavior.

1. Resolve exactly one repository from explicit `owner/repository`, a repository
   URL, or unambiguous verified repository metadata. Treat text after
   `/create-issue` as `$ARGUMENTS`.
2. Start `issue-agent` with `mode: create`, the verified repository, and
   `$ARGUMENTS` or the current request. Stop when the target is missing,
   ambiguous, or an existing issue is the primary target.
3. Display the Agent's exact current result, including the target, draft status,
   payload, blockers, authorization, and any publication or verification result.
   Preserve the Agent's structured `IssueDraft` handoff and do not perform a
   second publication.
