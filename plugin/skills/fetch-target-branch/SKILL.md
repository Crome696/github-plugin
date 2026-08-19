---
name: fetch-target-branch
description: Fetches and verifies one explicitly selected remote target branch, returning its current commit for workspace preparation without overwriting local work or performing rebase, merge, reset, checkout, or worktree operations. Use automatically before creating a workspace when the target base branch must be refreshed.
---

# Fetch Target Branch

Refresh exactly one verified remote target branch and return its current full
commit SHA as a version-1
[`TargetBranchFetch`](../../shared/schemas/TargetBranchFetch.yaml) handoff.
This is the only Git-state mutation permitted by this Skill.

## Boundaries

- Require explicit `repository`, `remote_name`, `target_branch`, and a
  repository checkout or version-1 `RepositoryContext`.
- Require separate exact authorization for the exact repository, remote, branch,
  and fetch operation. The authorization may be explicit user approval or a
  clearly applicable target-repository `AGENTS.md` policy. Routine
  implementation authorization does not imply this fetch authorization.
- Never modify files, the index, `HEAD`, local branches, worktrees, remotes, or
  configuration.
- Never run rebase, merge, reset, checkout, switch, restore, clean, push,
  commit, branch creation/deletion, or worktree operations.
- Never fetch all remotes, all branches, tags, or an inferred substitute such
  as `main`, `master`, another remote, or the current local branch.
- Never expose credentials, tokens, private keys, `.env` contents, or
  credential-bearing URLs. Record only sanitized repository identity and URLs.
- Do not invoke another Skill automatically. A recommended next Skill is
  advisory only.

## Input validation

1. Validate the contract version of every supplied handoff.
2. Require a canonical `owner/repository`, a named configured remote, and a
   non-empty branch name without ambiguous ref syntax or placeholders.
3. Resolve the checkout's canonical root and verify it belongs to the expected
   repository. Compare the selected remote's sanitized fetch and push
   identities to the expected repository; do not infer identity from the remote
   name.
4. Derive exactly:
   - `remote_ref`: `refs/heads/<target_branch>`
   - `tracking_ref`: `refs/remotes/<remote_name>/<target_branch>`
5. Before asking for authorization, inspect the target and applicable
   repository instructions, especially the target repository's `AGENTS.md`,
   with:

   `git -C <checkout> ls-remote --heads <remote_name> <remote_ref>`

   A missing target branch is distinct from a fetch or verification failure.

## Evidence rules

Use reproducible evidence references:

- `input:<field>` for explicit input;
- `handoff:<Contract>.<field>` for supplied contract data;
- `git:<command>` for sanitized Git output;
- `repository:<path>` for canonical checkout and identity evidence.

Treat unavailable, truncated, or failed output as unknown, never as a pass.
Normalize repository identities from HTTPS and SSH forms and remove credentials,
ports, query strings, and fragments from recorded URLs. Preserve full commit
SHAs in the handoff.

## Fetch workflow

1. Validate the input and remote/repository mapping.
2. Observe the remote branch SHA with `git ls-remote`. If the branch is absent,
   return `blocked` with `branch_missing` and do not fetch.
3. Present the exact mutation: update only
   `refs/remotes/<remote_name>/<target_branch>` in the verified checkout from
   the named remote branch. If `AGENTS.md` clearly authorizes this exact
   repository, remote, branch, and fetch operation, record its source path and
   concise quote or paraphrase in `authorization.evidence` and continue without
   a chat approval. Otherwise wait for affirmative user approval.
4. Execute only the narrow refspec, equivalent to:

   `git -C <checkout> fetch --no-tags <remote_name> +<remote_ref>:<tracking_ref>`

   Do not use a wildcard refspec. The leading `+` updates only the selected
   remote-tracking ref and does not rewrite a local branch or working tree.
5. Re-read the remote SHA and resolve the tracking SHA with:

   `git -C <checkout> rev-parse --verify <tracking_ref>^{commit}`

6. Set `status: verified` only when the final remote and tracking SHAs are
   full, non-null, and equal. If the fetch may have completed but final
   verification is incomplete, return `partial`; otherwise return `blocked`.
7. Return exactly one `TargetBranchFetch` handoff. Downstream workspace
   creation may use only its verified `tracking_sha` as the base revision.

## Output contract

Return one English version-1 object with:

- `status`, `repository`, `remote`, `branch_name`, `remote_ref`, and
  `tracking_ref`;
- full `remote_sha` and `tracking_sha`;
- exact user or repository-policy authorization evidence under `authorization`;
- fetch result, narrow refspec, completion time, and sanitized command evidence;
- repository, branch, tracking-ref, and SHA verification outcomes;
- `failure: null` only for `verified`;
- at most one advisory `recommended_next_skill`.

Never claim a current target commit when the final SHA is unavailable,
ambiguous, or does not match.

## Failure modes

- `invalid_input`: missing or unsupported values;
- `repository_mismatch` or `remote_mismatch`: selected checkout or remote does
  not identify the expected repository;
- `branch_missing`: the named remote branch was not observed;
- `authorization_missing`: exact user or repository-policy fetch authorization is absent;
- `fetch_failed`: the narrow fetch failed;
- `sha_mismatch` or `verification_failed`: final identity or commit evidence
  cannot be trusted.
