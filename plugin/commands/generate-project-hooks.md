---
name: generate-project-hooks
description: Start the thin project-hook generation workflow for the current repository.
---

# Generate project hooks

Keep this Command as a thin Cursor entry point. It resolves one target, starts
`host-hooks-agent`, and displays that Agent's result; it does not ask the host
selection question, run the generator itself, or repeat the Skill procedure.

1. Resolve exactly one repository from the current workspace or an unambiguous
   explicit repository path. Treat text after `/generate-project-hooks` as
   `$ARGUMENTS`; it may identify the target path but is never a host selector.
2. Start `host-hooks-agent` with the verified target repository and
   `$ARGUMENTS`.
3. Display the Agent's complete result, including the interactive host
   selection, target, status, written paths, unchanged paths, blocked paths,
   and limitations.
4. Do not commit, modify GitHub, create gate snapshots, invoke another Agent,
   or perform a second projection.
