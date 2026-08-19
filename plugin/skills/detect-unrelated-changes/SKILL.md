---
name: detect-unrelated-changes
description: Detects working-tree changes that are not plausibly related to an issue, ImplementationPlan, ReviewFixPlan, CiFixPlan, or necessary follow-on edit, evaluates evidence and confidence, and separates scope violations from technical side effects before commit or pull-request preparation. Use automatically when a ChangeClassification shows drift, foreign paths, or uncertainty; never reset, restore, clean, or remove files.
---

# Detect Unrelated Changes

Detect whether one already classified worktree contains changes that do not
belong to the supplied issue, `ImplementationPlan`, `ReviewFixPlan`, or `CiFixPlan`.
Distinguish a genuine scope violation from a technically necessary follow-on
edit, record evidence and confidence for every finding, and return exactly one version-1
[`UnrelatedChangeDetection`](../../shared/schemas/UnrelatedChangeDetection.yaml)
handoff. This Skill is diagnostic only: it identifies blockers or
clarification needs before commit and pull-request preparation, but never
changes files or authorizes a Git operation.

## Boundaries

- Read supplied handoffs, bounded non-secret diff evidence, repository files,
  filesystem metadata, and read-only Git metadata only. Never edit files, the
  index, branches, worktrees, Git administrative state, or GitHub resources.
- Do not run `git add`, `rm`, `mv`, `checkout`, `switch`, `reset`, `restore`,
  `clean`, `rebase`, `merge`, `cherry-pick`, `commit`, `push`, `worktree add`,
  `worktree remove`, hooks, installs, builds, tests, formatters, linters, or
  other change-producing operations.
- Never reset, restore, clean, remove, hide, or otherwise discard a candidate
  path. Keep every path available for user review and clarification.
- Do not duplicate `classify-changes` path classification. Consume its
  version-1 handoff and make a separate scope-gate decision.
- Do not load the entire repository or unrelated dependency trees. Inspect
  only candidate paths and bounded evidence needed to distinguish a related
  change, a necessary side effect, or a scope violation.
- Do not invent paths, issue requirements, plan steps, technical dependencies,
  generated-file status, or authorization. A path convention alone does not
  prove a relationship or a necessary side effect.
- Do not provide source-code implementation, project-specific testing
  strategy, domain guidance, or product guidance.
- Do not expose secrets, tokens, private keys, credential-bearing remote URLs,
  `.env` contents, or sensitive diff hunks. Redact evidence before returning
  it.
- Do not invoke another Skill automatically. `recommended_next_skill` is
  advisory only and never authorizes or invokes a follow-up.
- Keep the structured handoff and authored report text in English. Questions
  and explanations may follow the user's conversation language.

## Input

Accept one expected worktree from:

- Required version-1
  [`ChangeClassification`](../../shared/schemas/ChangeClassification.yaml).
  Its `repository`, `branch_name`, `worktree_path`, `source`, and `changes`
  are the authoritative path and identity evidence.
- Optional version-1
  [`ImplementationPlan`](../../shared/schemas/ImplementationPlan.yaml) or
  `ReviewFixPlan`. Use an `ImplementationPlan`'s `affected_areas`, `in_scope`,
  `out_of_scope`, implementation-step `paths`, and task objective as scope
  evidence. For a `ReviewFixPlan`, use `scope.in_scope`,
  `scope.out_of_scope`, `scope.exact_path_allowlist`, and
  `implementation_steps`.
- Optional version-1 `LoadedIssue`, `IssueAnalysis`, and
  [`AffectedAreas`](../../shared/schemas/AffectedAreas.yaml) handoffs, plus a
  bounded task or issue summary when explicitly supplied.

Validate every supplied handoff before using it. Accept only version 1 and
preserve source versions and references in the output. Do not replace an
explicit value with one inferred from a branch name, commit message, or path.

The classification must have `status: classified`, or `status: partial` with
a trusted identity and a useful parsed change list. A missing, blocked,
unsupported, or untrusted classification returns `status: blocked` with
`recommended_next_skill: classify-changes`. A partial classification may be
processed when its missing evidence is recorded and the result remains useful;
do not present it as a clear gate.

An absent optional plan or issue is not proof that a change is unrelated.
Record the unavailable scope source and use `uncertain` when no other supplied
task or handoff establishes the relationship.

## Evidence rules

Every finding must include concise, reproducible evidence. Prefer:

- `handoff:ChangeClassification.changes[<path>]` for the source relationship,
  purpose, confidence, and classification evidence.
- `handoff:ChangeClassification.summary[<field>]` for candidate selection and
  the existing scope-alignment signal.
- `handoff:ImplementationPlan.affected_areas[<path>]`,
  `handoff:ImplementationPlan.implementation_steps[<id>].paths`, and
  `handoff:ImplementationPlan.in_scope[<path>]` for planned scope.
- `handoff:ReviewFixPlan.scope.in_scope[<path>]` and
  `handoff:ReviewFixPlan.scope.exact_path_allowlist[<path>]` for confirmed
  review-fix scope.
- `handoff:ImplementationPlan.out_of_scope[<path>]` or
  `handoff:ReviewFixPlan.scope.out_of_scope[<path>]` for explicit exclusions.
- `handoff:LoadedIssue`, `handoff:IssueAnalysis`, or
  `handoff:AffectedAreas[<path>]` for issue scope and dependencies.
- `git:diff:<path>` or
  `handoff:WorkingTreeInspection.diff.numstat[<path>]` for bounded content or
  change-stat evidence.
- `path:<path>` for a repository convention that helps explain purpose, never
  as the sole proof of scope.

Use `high` confidence only when direct path and diff evidence are corroborated
by a plan, issue, affected-area, or explicit task boundary. Use `medium` when
the evidence is strong but one corroborating source is incomplete. Use `low`
for path-only, missing, conflicting, redacted, or unresolved evidence.
Explain the confidence in the rationale.

## Verdict rules

Evaluate each path from `ChangeClassification.changes` exactly once. Preserve a
rename as one finding with the destination in `path` and the source in
`previous_path`.

### Related

Use `related` when the issue, task, affected-area map, or plan explicitly
covers the changed path, component, behavior, or required validation, and no
stronger evidence contradicts that relationship. A `planned` or `supporting`
plan relation with corroborating evidence is normally related. Do not call a
path related merely because it shares a branch name or filename.

### Necessary technical side effect

Use `necessary_side_effect` only when the path is not directly listed as
implementation scope but bounded diff and plan or repository evidence show
that it is required by a related change. Valid side-effect kinds include:

- generated output or a dependency lockfile changed by the planned operation;
- a manifest or metadata synchronization required by the same package change;
- a focused test or documentation update coupled to the affected behavior; or
- build metadata required to represent the planned change.

The category, filename, or presence of a tool-generated-looking path alone is
not enough. Record `side_effect_kind` and explain the dependency.

### Scope violation

Use `scope_violation` only when the evidence establishes an explicit
out-of-scope or unrelated relationship and bounded path or diff evidence
corroborates it. Typical evidence is an explicit
`ImplementationPlan.out_of_scope` or `ReviewFixPlan.scope.out_of_scope` entry,
`plan_relation: unrelated`, or
`issue_relation: out_of_scope` that conflicts with the observed diff. A
`potentially_foreign` purpose or `scope_alignment: drift` is a candidate signal,
not proof by itself.

Create a blocker only for a high-confidence scope violation or an
unresolvable required-input failure. A scope suspicion without sufficient
evidence becomes `uncertain`, not a blocker.

### Uncertain

Use `uncertain` when the plan or issue does not establish the relationship,
the relevant diff is unavailable or redacted, the supplied handoffs conflict,
or a potentially foreign change cannot be connected to the task. Ask for the
specific missing evidence in `clarifications`; never label the path foreign
only because an optional plan or issue was omitted.

## Workflow

### 1. Validate the classification and identity

1. Resolve the supplied version-1 `ChangeClassification`; do not substitute
   the current checkout for its expected worktree.
2. Confirm repository identity, branch identity, absolute
   `worktree_path`, and the source classification version.
3. Validate optional handoffs and record unavailable or conflicting inputs.
4. If the classification is missing, blocked, unsupported, or has no
   trustworthy path inventory, return a blocked result without making a
   scope claim.

### 2. Build the candidate list

Start with every classification change whose plan relation is `unrelated` or
`uncertain`, whose issue relation is `out_of_scope` or `uncertain`, whose
purpose is `potentially_foreign`, or whose path appears in the classification
summary's foreign or uncertain lists. De-duplicate by normalized path while
preserving rename source evidence.

Also inspect paths already marked `planned`, `supporting`, or `in_scope` only
enough to confirm they can be carried forward as `related`. A clean
classification yields empty findings and a valid clear result only when its
scope evidence is complete.

### 3. Collect bounded evidence

Start with the classification's evidence and diff statistics. Read a
path-specific diff only when the existing evidence cannot distinguish a
necessary side effect from a foreign change. For an untracked path, use safe
metadata or a bounded non-secret read only when necessary.

Never dump the whole patch. If the relevant diff is unavailable, binary,
truncated, or redacted, record that limitation and lower confidence or return
`uncertain`. Do not treat absence of evidence as evidence of alignment.

### 4. Assign verdict and confidence

Apply the verdict rules independently for each path. Keep `purpose`,
`plan_relation`, and `issue_relation` from the source classification as
evidence; do not rewrite that classification. Use the strongest direct
relationship available, and record contradictory evidence in the rationale.

### 5. Produce blockers and clarification requests

- Add one stable blocker per high-confidence scope violation, with the path,
  severity, description, and evidence needed to review it.
- Add a blocker with `path: null` for an unresolvable required-input,
  identity, or source-version failure, and preserve the failure evidence.
- Add one clarification per unresolved path or required source, asking a
  concrete question and naming the evidence that would resolve it.
- Do not recommend removing, resetting, restoring, or hiding a path. The
  requested resolution is a user decision or additional evidence.

### 6. Set the two diagnostic gates

Set both `summary.commit_gate` and `summary.pr_gate` to:

- `block` when any blocker exists;
- `clarify` when no blocker exists but any finding or required source remains
  uncertain, or the source classification is partial; or
- `pass` only when every finding is `related` or `necessary_side_effect` and
  the evidence is complete enough to support the conclusion.

Use `status: clear` only with two `pass` gates and no blockers or
clarifications. Use `status: needs_clarification` for unresolved scope
questions, `status: blocked` for missing/invalid required input or a
high-confidence scope blocker, and `status: partial` when a useful result is
available from a partial source but verification is incomplete. A partial
result can still expose a block or clarification gate; it never authorizes a
Git operation.

## Output contract

Return exactly one English version-1 `UnrelatedChangeDetection` object:

```yaml
schema: UnrelatedChangeDetection
version: 1
status: clear
repository: owner/repository
branch_name: agent/example-task
worktree_path: /workspace/.cromesdk-worktrees/repository/agent-example-task
source:
  task_or_issue: "Issue #123: add the feature"
  change_classification_version: 1
  implementation_plan_version: 1
  loaded_issue_version: null
  issue_analysis_version: null
  affected_areas_version: 1
  references:
    - "handoff:ChangeClassification"
    - "handoff:ImplementationPlan"
  unavailable_inputs: []
findings:
  - path: src/feature.ts
    previous_path: null
    change_kind: modified
    verdict: related
    confidence: high
    rationale: "The plan step lists the path and the bounded diff implements the stated feature."
    evidence:
      - "handoff:ChangeClassification.changes[src/feature.ts]"
      - "handoff:ImplementationPlan.implementation_steps[implement-feature].paths[src/feature.ts]"
      - "git:diff:src/feature.ts"
  - path: package-lock.json
    previous_path: null
    change_kind: modified
    verdict: necessary_side_effect
    confidence: high
    side_effect_kind: dependency_lockfile
    rationale: "The bounded diff changes only the dependency resolution required by the planned package update."
    evidence:
      - "handoff:ChangeClassification.changes[package-lock.json]"
      - "git:diff:package-lock.json"
      - "handoff:ImplementationPlan.implementation_steps[update-dependency]"
blockers: []
clarifications: []
summary:
  related_paths:
    - src/feature.ts
  necessary_side_effect_paths:
    - package-lock.json
  scope_violation_paths: []
  uncertain_paths: []
  commit_gate: pass
  pr_gate: pass
evidence:
  - "All changed paths have direct plan or required side-effect evidence."
recommended_next_skill: null
failure: null
```

For blocked, partial, or clarification results, preserve every reliable
identity and path value, include sanitized evidence, and set a non-null
failure when the source or detection operation is incomplete. Never present
`pass` as commit, push, pull-request, or cleanup authorization.
