---
name: compose-commit-message
description: Compose an evidence-backed English Git commit proposal from a verified issue, ImplementationPlan or ReviewFixPlan or CiFixPlan, repository conventions, validated working-tree changes, and an existing task-scoped delivery authorization. Use automatically when a validated implementation is ready for commit preparation; never stage or create a commit.
---

# Compose Commit Message

Compose exactly one version-1
[`CommitProposal`](../../shared/schemas/CommitProposal.yaml) from validated
implementation evidence. The proposal describes the actual repository change,
its purpose, and its exact file scope. It never invents authorization. When a
valid task-scoped delivery authorization is supplied, it records that existing
authorization so the later local commit can run without a redundant chat gate.
The `create-commit` Skill still owns the Git write and verification.

## Boundaries

- Read only supplied version-1 handoffs, bounded non-secret diff evidence,
  repository files, `RepositoryConventions`, and read-only Git metadata.
- Never run `git add`, `commit`, `push`, `reset`, `restore`, `clean`, `checkout`,
  `switch`, `rebase`, `merge`, hooks, formatters, installers, tests, or other
  change-producing commands.
- Never edit files, the index, branches, worktrees, Git administrative state,
  or GitHub resources.
- Do not invoke another Skill automatically. A suggested next step is
  advisory and never creates a delivery authorization.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive diff hunks.
- Keep the structured handoff and authored commit text in English. Do not
  translate source evidence or invent missing content.

## Required input

Accept exactly one expected implementation result with these version-1
handoffs:

1. `ValidationResult` with `readiness.commit_preparation_allowed: true`.
2. `WorkingTreeInspection` with `status: inspected`, or `status: partial` with
   a trusted repository, branch, identity, and usable file inventory.
3. Either `ImplementationPlan` with the objective, scope, and implementation
   evidence for the change, or `ReviewFixPlan` with the confirmed review-fix
   scope, implementation steps, and validation evidence.
4. A task-scoped delivery authorization from the current task context,
   `ImplementationPlan.authorization`, or applicable repository policy when
   autonomous routine delivery is enabled.

The validation result must be internally usable for commit preparation. A
missing result, unsupported version, blocked result, false
`commit_preparation_allowed`, or unresolved identity is a blocker. Do not
replace a missing worktree identity with the current checkout, a branch name,
or a value inferred from a path.

Accept these optional inputs when supplied:

- `LoadedIssue` or `IssueAnalysis` for verified issue wording and issue
  identity.
- `RepositoryConventions` for the repository's `commits` conventions.
- `ChangeClassification` and `UnrelatedChangeDetection` for supporting
  purpose, scope, and necessary-side-effect evidence.
- an authorization source and task identity for recording session continuity;
  accepted sources are `task_intent`, `plan_build`, `repository_policy`, and
  `session_continuity`.

Validate every supplied handoff before using it. Accept only version 1,
preserve its status and unavailable evidence, and keep the effective
repository and branch identity consistent across the inputs. An optional
issue, convention, classification, or detection handoff may be unavailable;
record that limitation and do not fill it with guesses.

## Evidence rules

Use concise, reproducible references in `rationale` and
`validation.evidence`, such as:

- `handoff:ValidationResult.readiness.commit_preparation_allowed`
- `handoff:WorkingTreeInspection.files.added`
- `handoff:WorkingTreeInspection.files.modified`
- `handoff:WorkingTreeInspection.files.deleted`
- `handoff:WorkingTreeInspection.files.renamed`
- `handoff:ImplementationPlan.objective` or
  `handoff:ReviewFixPlan.pull_request.title`
- `handoff:ImplementationPlan.implementation_steps[<id>]` or
  `handoff:ReviewFixPlan.implementation_steps[<id>]`
- `handoff:LoadedIssue.title` or `handoff:LoadedIssue.number`
- `handoff:RepositoryConventions.conventions[<index>]`
- `handoff:ChangeClassification.changes[<path>]`
- `handoff:UnrelatedChangeDetection.findings[<path>]`
- `git:diff:<path>` for bounded, non-secret change evidence

Describe a convention as `mandatory`, `observed`, or `fallback`. Treat an
explicit applicable instruction or authoritative configuration as mandatory.
Treat repeated repository history or documentation patterns as observed.
Use the concise English imperative subject fallback only when no applicable
commit convention is evidenced. Never present that fallback as a repository
requirement.

## Compose the file scope

1. Use `WorkingTreeInspection.files` as the authoritative scope source.
2. Populate `CommitProposal.files.added` from `files.added`, which already
   includes untracked paths that would become additions.
3. Populate `files.modified` from `files.modified` and `files.deleted` from
   `files.deleted`.
4. Preserve repository-relative paths, remove duplicates, and keep
   case-sensitive path spelling as supplied by the trusted handoff.
5. Record every rename in the rationale using its destination and source.
   `CommitProposal.files` has no rename field, so place the destination in the
   corresponding `added` or `modified` list only when the inspection's
   classification supports that mapping; never silently discard the source
   path or invent a classification.
6. Do not include paths found only in the plan, issue, branch name, or
   `ChangeClassification` when they are absent from the inspection.
7. Treat non-empty `files.unmerged` or an unexpected state that undermines
   scope trust as a blocker. Do not compose a commit for an empty clean tree;
   an empty commit is not a valid proposal.

The proposal scope is an intended scope. It may record permission to stage and
commit only when the supplied delivery authorization covers the same verified
repository, task, branch, worktree, and current scope. Validation readiness
alone never authorizes a commit.

## Compose the message

1. Determine the actual change from the bounded diff evidence, plan objective,
   implementation steps, and classified paths. Prefer the most specific
   behavior or artifact that the evidence supports.
2. Describe what changed and, when needed, why it is needed. Do not describe
   the working process. Do not use process-only wording such as
   `followed the plan`, `ran tests`, `completed implementation`, or
   `updated the workflow` without naming the evidenced repository change.
3. Apply the highest-authority applicable `commits` convention:
   `mandatory` before `observed`, and preserve unresolved conflicts rather
   than choosing an unsupported format.
4. Include a scope, type, prefix, body format, or issue reference only when
   the convention evidence supports it. Do not assume Conventional Commits.
5. Refer to an issue only when both conditions hold:
   - the issue identity and repository are verified in a supplied issue
     handoff; and
   - an applicable repository convention requires or clearly prescribes the
     reference.
6. Never copy an issue number from a branch name, date, filename, or
   unverified prose.
7. Keep `message.subject` concise and in English. Use an imperative fallback
   subject when no repository-specific subject pattern is evidenced.
8. Use `message.body` only for additional evidenced context that does not fit
   the subject. Use an empty string when no body is required by the
   convention or the evidence.
9. Do not mention tests, validation, approvals, staging, or the commit process
   in the message unless the actual repository change itself is the tested,
   validated, or approval-related artifact and the evidence supports that
   description. Put validation evidence in `validation`, not in the message.

## Produce the proposal

Return exactly one English object with `schema: CommitProposal` and
`version: 1`.

For a usable composition:

- Set `status: approved` when a valid task-scoped delivery authorization is
  supplied; otherwise set `status: draft`.
- Set `repository`, `branch`, and `base_sha` from the trusted workspace
  evidence.
- Set `files` to the inspected, repository-relative scope.
- Set `message.subject` and `message.body` to the composed English text.
- Set `rationale` to the applied convention, issue-reference decision, scope
  source, and any evidence limitation.
- Copy the validation outcome and evidence into `validation` without
  converting readiness into authorization. Record the separate authorization
  source and task scope when supplied.
- With valid delivery authorization, set
  `authorization.exact_scope_approved: true` and
  `authorization.commit_authorized: true`, set `authorization.source` to the
  recorded source, and include concise evidence. Without it, set both flags to
  `false`, set `source: null`, and explain the missing authorization.
- Set `commit.sha` and `commit.created_at` to `null`, and
  `commit.files_committed` to an empty list.

Use `status: partial` when a defensible proposal can be composed but a
material, non-blocking evidence gap remains. Name the gap in `rationale` and
preserve the validation status. Use `status: blocked` when the required
inputs, identity, trusted scope, message evidence, or a mandatory convention
are unavailable or contradictory. A blocked result must not contain an
invented message or scope.

When a required string cannot be supplied in a blocked result, use an empty
string rather than a placeholder or inferred identity. Keep all lists empty
when their source evidence is unavailable, keep `base_sha` null, use empty
strings for `message.subject` and `message.body`, set
`authorization.exact_scope_approved` and `authorization.commit_authorized`
to `false`, and explain the missing evidence in `rationale` and
`validation.evidence`. This preserves the required object shape without
fabricating content.

## Output contract

```yaml
schema: CommitProposal
version: 1
status: approved
repository: owner/repository
branch: agent/example-task
base_sha: 0123456789abcdef0123456789abcdef01234567
files:
  added:
    - docs/example.md
  modified:
    - src/example.ts
  deleted: []
message:
  subject: "Document the example workflow"
  body: ""
rationale: >-
  Uses the observed imperative subject convention from
  handoff:RepositoryConventions.conventions[0]. The scope comes from
  handoff:WorkingTreeInspection.files and the purpose is supported by
  handoff:ImplementationPlan.objective. No issue reference was added because
  the supplied conventions do not require one.
validation:
  result_status: passed
  evidence:
    - handoff:ValidationResult.readiness.commit_preparation_allowed
authorization:
  exact_scope_approved: true
  commit_authorized: true
  source: task_intent
  task_scope: "example/repository issue 42"
  evidence: "The current task authorization covers routine commits for issue 42."
commit:
  sha: null
  created_at: null
  files_committed: []
```

For blocked output, preserve the same fields, use `status: blocked`, empty
required strings and lists where evidence is unavailable, and report the
concrete failure in `rationale` and `validation.evidence`. Never add a
`recommended_next_skill` field because it is not part of `CommitProposal`.

## Failure checks

Block or return partial evidence for:

- missing, malformed, or unsupported required handoffs;
- false or unavailable `ValidationResult.readiness.commit_preparation_allowed`;
- mismatched repository, branch, worktree, or base revision;
- unmerged paths, conflicting state, or an untrusted working-tree inventory;
- empty changed scope;
- missing diff or plan evidence for the actual change;
- unresolved mandatory commit-convention conflicts; or
- an issue reference that cannot be verified.

Do not turn a blocked or partial result into `draft` merely because a
plausible subject can be guessed. Do not create a commit, and never report a
commit SHA or committed files before Git verifies a later commit operation.
