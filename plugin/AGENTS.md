# GitHub Plugin Inventory

This file is the concise inventory and routing guide for the GitHub plugin. It
does not duplicate the operational rules, Skill procedures, Agent workflows, or
contract definitions. Those artifacts are the sources of truth named below.

## Responsibility boundary

The plugin owns GitHub issue and pull-request collaboration, repository context,
branches, worktrees, commits, pushes, reviews, feedback follow-up, rebase
coordination, merge coordination, issue-closure verification, and cleanup
coordination. Source-code implementation, framework architecture,
project-specific testing, domain knowledge, and product behavior remain
external capabilities.

External capabilities may be recorded by exact host-session identities such as
`session:skill:typescript-implementation` or `session:rule:project-testing`.
The plugin may not copy, package, execute, or claim ownership of their content.
Repository-local capability paths must remain under `plugin/`.

The technical entry point for developers and AI agents is
[`docs/README.md`](docs/README.md). It explains the plugin architecture,
approval gates, external capability boundary, Shared Contracts, complete
issue-to-merge lifecycle, failure handling, and extension points. It is
explanatory documentation only; the README inventory, Agent and Skill
procedures, Rules, Hooks, and Shared Contracts remain the sources of truth.

## Agents

| Agent | Activation | Responsibility |
| --- | --- | --- |
| `issue-agent` | Explicit | Create one new issue or refine one verified existing issue, then hand the exact `IssueDraft` to its publication Skill. |
| `preparation-agent` | Explicit | Prepare one qualified issue into an `ImplementationPlan`, create or reuse the authorized workspace through `create-worktree`, and verify it read-only. |
| `delivery-agent` | Explicit | Validate one completed implementation, compose the exact commit and Draft PR handoffs, and delegate routine delivery writes to their owning Skills. |
| `review-agent` | Explicit | Analyze one verified PR, apply a matching target-repository `AGENTS.md` policy before asking for finding or publication decisions, and hand the exact authorized review draft to publication. |
| `feedback-agent` | Explicit | Collect feedback, identify advisory resolved candidates, triage selected open items, coordinate external resolution, validate results, and hand eligible thread actions to Skills. |
| `integration-agent` | Explicit | Coordinate one PR's readiness, target-repository-policy-aware base refresh and rebase, post-rebase validation, separately authorized merge, issue-closure verification, and cleanup decisions. |
| `host-hooks-agent` | Explicit | Coordinate one verified repository's project-hook generation by delegating interactive host selection and bounded projection to `generate-project-hooks`. |
| `lifecycle-agent` | Explicit | Sequence issue create or existing-issue refine, then preparation, external implementation, and Draft PR delivery by starting the existing delivery Agents; stop before review. |
| `review-fix-agent` | Explicit | Review one verified pull request, confirm mandatory fixes, coordinate external implementation on its existing head branch, commit and non-force push, and repeat until complete or blocked. |
| `ci-fix-agent` | Explicit | Wait for required checks on one verified pull request, rerun only exactly authorized required names, confirm remaining CI failures, coordinate external implementation on its existing head branch, commit and non-force push, and reassess checks until complete or blocked. |
| `pr-ready-agent` | Explicit | Verify one Draft pull request, unique linked issue, and optional reviewer set, then mark it Ready-for-Review after exact authorization. |
| `product-planner-agent` | Explicit | Turn one verified parent issue into a prioritized graph of nearly atomic product sub-issues, then hand the approved create set to `create-product-sub-issues` only after exact user approval. |
| `issue-reprioritize-agent` | Explicit | Inventory currently open issues in one repository, rank them into unique consecutive P1-through-Pn titles with the user, and apply those titles only after exact ranked-set authorization. |
| `issue-close-agent` | Explicit | Load one verified issue, require an exact close reason and duplicate target when needed, then close it without a merged pull request after exact authorization. |

`feedback-agent` owns feedback mode; `integration-agent` owns integration mode.
They share only verified pull-request identity and must not invoke one another.
`review-fix-agent` does not start another plugin Agent; it orchestrates the
declared review, planning, implementation-capability, and delivery Skills for
one `pr:<number>` scope. It never publishes review actions or performs
thread, PR, rebase, merge, or cleanup writes.
`ci-fix-agent` does not start another plugin Agent; it orchestrates wait,
exact required-check rerun, CI-fix planning, implementation-capability, and
delivery Skills for one `pr:<number>` scope. It never publishes review
actions, treats pending checks as pass, treats optional checks as required,
or performs merge, Ready-for-Review, rebase, or cleanup writes.
`product-planner-agent` does not start another plugin Agent; it orchestrates
the declared product analysis, interview, mapping, decomposition, atomicity,
dependency, prioritization, drafting, and quality Skills for one parent
issue. It never overwrites the parent and never publishes sub-issues before
overall-plan and exact-set approval.
`lifecycle-agent` is the only Agent that may start other plugin Agents. It
starts `issue-agent`, `preparation-agent`, and `delivery-agent` sequentially
and must not start `review-agent`, `feedback-agent`, `integration-agent`,
`host-hooks-agent`, `product-planner-agent`, `pr-ready-agent`,
`issue-reprioritize-agent`, `issue-close-agent`, or `ci-fix-agent`. It must not
copy their Skill chains. `/implement-auto-issue` starts it at create;
`/refine-auto-issue` starts it at refine for one verified existing issue and
skips create.

## Commands

| Command | Agent | Responsibility |
| --- | --- | --- |
| `create-issue` | `issue-agent` (`create`) | Resolve one repository, start the Agent, and display the exact issue result. |
| `refine-issue` | `issue-agent` (`refine`) | Resolve one issue, start the Agent, and display the exact revision result. |
| `prepare-issue` | `preparation-agent` | Resolve one issue, start preparation, and display `ImplementationPlan` plus `BranchWorkspace`. |
| `publish-draft-pr` | `delivery-agent` | Resolve one prepared implementation, start delivery, and display the complete delivery result. |
| `review-pr` | `review-agent` | Resolve one PR, start review, and display findings and the `ReviewDecision`. |
| `address-pr-feedback` | `feedback-agent` | Resolve one PR, start feedback follow-up, and display its resolution summary. |
| `integrate-pr` | `integration-agent` | Resolve one PR, start integration, and display `PullRequestIntegration`. |
| `generate-project-hooks` | `host-hooks-agent` | Resolve one repository, start hook projection, and display the selected-host generation result. |
| `implement-auto-issue` | `lifecycle-agent` | Resolve one repository and request, start the lifecycle Agent, and display the `LifecycleRun` through Draft PR publication. |
| `refine-auto-issue` | `lifecycle-agent` | Resolve one existing issue, start the lifecycle Agent at refine, and display the `LifecycleRun` through Draft PR publication. |
| `auto-review-fix-pr` | `review-fix-agent` | Resolve one pull request, start the review-fix Agent, and display the `ReviewFixRun` without publishing a review or merging. |
| `auto-ci-fix-pr` | `ci-fix-agent` | Resolve one pull request, start the CI-fix Agent, and display the `CiFixRun` without publishing a review, merging, or treating green checks as Ready-for-Review. |
| `ready-pr` | `pr-ready-agent` | Resolve one pull request, start Ready-for-Review, and display the `PullRequestReady` result. |
| `plan-product` | `product-planner-agent` | Resolve one repository and parent issue, start product planning, and display the `ProductPlannerRun` through overall-plan review and approved sub-issue publication. |
| `reprioritize-issues` | `issue-reprioritize-agent` | Resolve one repository, start open-issue reprioritization, and display the `IssueReprioritization` result after exact ranked-set title application. |
| `close-issue` | `issue-close-agent` | Resolve one issue, start triage close, and display the `IssueClosure` result after exact close-reason authorization. |

Commands are thin entry points: target resolution, one Agent start, and result
display only. They do not repeat Skill chains, publish a second issue or PR,
perform GitHub writes, or invoke another Agent.

## Skills

Each directory below contains the authoritative `SKILL.md` for one atomic
handoff. Automatic Skills omit `disable-model-invocation`; explicit mutation
Skills retain their explicit invocation boundary.

| Skill | Responsibility |
| --- | --- |
| `analyze-issue` | Analyze one loaded issue for evidence-based readiness, gaps, risks, and contradictions. |
| `analyze-product-issue` | Analyze one loaded parent issue from a product perspective into a `ProductAssessment` interview basis without creating sub-issues. |
| `analyze-pr-diff` | Analyze one PR diff across correctness, architecture, security, performance, maintainability, tests, documentation, and scope. |
| `apply-issue-priority-titles` | Apply one confirmed unique P1-through-Pn ranking as title prefixes on the current open issues after exact-set authorization and a live identity check. |
| `assess-issue-atomicity` | Classify each proposed sub-issue candidate from a `ProductCapabilityDecomposition` as `too-large`, `atomic-enough`, or `over-fragmented` without creating sub-issues. |
| `assess-issue-quality` | Assess issue completeness, understandability, implementability, testability, scope, and contradictions. |
| `assess-merge-readiness` | Aggregate current merge-relevant evidence into diagnostic `MergeReadiness`. |
| `build-feedback-resolution-plan` | Build a bounded external implementation handoff for selected feedback. |
| `build-review-fix-plan` | Confirm current findings and open feedback as a host-neutral `ReviewFixPlan`. |
| `build-ci-fix-plan` | Confirm remaining failed required checks as a host-neutral `CiFixPlan`. |
| `build-implementation-plan` | Build an evidence-based, task-authorized implementation plan without implementing it. |
| `build-product-dependency-graph` | Map evidenced product and mandatory technical dependencies among classified sub-issue candidates without ranking slices by technical order or creating sub-issues. |
| `generate-project-hooks` | Ask interactively for Cursor, Codex, or both, then generate only the selected project-hook projections without creating gate snapshots, committing, or changing GitHub. |
| `check-linked-issue-status` | Assess linked-issue state, acceptance coverage, and relationship consistency. |
| `check-open-review-threads` | Assess current open, resolved, outdated, and unknown review-thread states. |
| `check-required-approvals` | Inspect explicit review requirements and current approval state. |
| `check-required-status-checks` | Project one existing `PullRequestCheckInspection` into required versus optional check evidence without another fetch. |
| `wait-required-checks` | Wait after a verified PR-head push and report required-check pass, fail, pending, skipped, and missing outcomes without treating pending or unavailable policy as a pass. |
| `rerun-required-checks` | Rerun only exactly authorized required check names and verify new live run identities. |
| `classify-changes` | Classify inspected worktree paths by purpose, component, and task relationship. |
| `classify-review-feedback` | Classify open feedback by cause, severity, component, and required action. |
| `classify-review-findings` | Classify deduplicated findings by evidence-supported severity and domain. |
| `cleanup-worktree` | Remove one authorized merged implementation worktree and verify the result. |
| `close-github-issue` | Close one verified issue without a merged pull request after exact authorization of the repository, issue, and close reason. |
| `close-linked-issue` | Perform one separately authorized narrow manual issue closure after merge, or the exact validated close-on-merge fallback from `integrate-pr`. |
| `collect-review-feedback` | Collect PR review threads, findings, comments, and required-check feedback. |
| `compare-issue-revision` | Compare an original issue with one proposed revision without ranking them. |
| `compose-commit-message` | Compose one exact English `CommitProposal` from validated evidence. |
| `compose-pr-description` | Compose one evidence-backed Draft PR description, optionally using a validated link. |
| `compose-review` | Compose one exact non-publishing `ReviewDecision` from confirmed findings. |
| `compose-product-sub-issues` | Compose complete standalone sub-issue drafts from confirmed atomic units without creating or publishing GitHub issues. |
| `conduct-product-interview` | Interview from one `ProductAssessment` into a `ProductInterview` of confirmed decisions, assumptions, and open questions without creating sub-issues. |
| `create-commit` | Stage the exact approved scope, create one commit, and verify it. |
| `create-draft-pr` | Create or verify one exact GitHub Draft PR after all delivery gates pass. |
| `create-github-issue` | Publish and verify one exact new issue or approved issue rewrite. |
| `create-product-sub-issues` | Publish a fully approved product plan as GitHub sub-issues from confirmed drafts only, preserving priority, parent relationship, and documented dependencies without silently changing content. |
| `create-worktree` | Create or explicitly reuse one authorized worktree, including attaching an existing pull-request head branch, and return creation evidence. |
| `decompose-product-capabilities` | Decompose confirmed Product Capabilities into the smallest value-oriented units with independent acceptance and parent-issue traceability without creating sub-issues. |
| `define-acceptance-criteria` | Define independent observable acceptance criteria from scoped requirements. |
| `deduplicate-review-findings` | Merge only content-equivalent findings and preserve auditable suppressions. |
| `delete-merged-branch` | Delete one authorized, fully integrated local or remote branch safely. |
| `derive-branch-name` | Derive a concise branch name from verified task and convention evidence. |
| `detect-rebase-conflicts` | Analyze planned or stopped rebase conflicts without resolving them. |
| `detect-repository-conventions` | Detect mandatory and observed repository conventions read-only. |
| `detect-review-findings` | Aggregate evidence-backed proposed review findings without publishing. |
| `detect-unrelated-changes` | Detect foreign, uncertain, or necessary side-effect paths before delivery. |
| `evaluate-implementation` | Evaluate feasible implementation approaches, fit, risks, and dependencies. |
| `fetch-target-branch` | Fetch and verify one explicitly selected remote target branch. |
| `identify-affected-areas` | Map one task to evidenced repository areas and dependencies. |
| `identify-product-capabilities` | Map one parent issue and confirmed `ProductInterview` into a hierarchical `ProductCapabilityMap` grouped by Product Value without creating sub-issues. |
| `identify-resolved-feedback` | Identify only clearly evidenced resolved feedback candidates from later state. |
| `inspect-pr-checks` | Perform the single live PR check, status, and policy-evidence fetch. |
| `inspect-repository` | Inspect bounded repository context and discovered conventions read-only. |
| `inspect-working-tree` | Inventory one expected worktree and its path-level Git state. |
| `link-pr-to-issue` | Validate one unique issue relationship after Draft composition. |
| `list-open-issues` | Load every currently open GitHub issue in one repository, excluding pull requests, without ranking or writing GitHub. |
| `load-github-issue` | Load one exact issue snapshot without modifying GitHub. |
| `load-linked-issue` | Resolve one PR's unique linked issue without guessing. |
| `load-pr-discussions` | Load one PR's reviews, threads, replies, comments, and discussion state. |
| `load-pull-request` | Load one exact PR snapshot without analysis or mutation. |
| `mark-pr-ready` | Mark one authorized open Draft pull request Ready-for-Review and request only the confirmed reviewer set. |
| `merge-pull-request` | Perform one separately authorized merge after fresh readiness checks. |
| `prioritize-product-issues` | Rank classified sub-issue candidates with the user using Product Value, user impact, urgency, risk, learning value, and dependencies without autonomously setting essential product priority or creating sub-issues. |
| `propose-pr-reviewers` | Propose an optional reviewer set from existing requests, CODEOWNERS suggestions, and policy names without writing GitHub. |
| `push-branch` | Push one verified branch non-force by default and verify the remote SHA. |
| `rank-open-issues` | Rank one open-issue inventory into unique consecutive P1-through-Pn proposed titles without writing GitHub. |
| `rebase-branch` | Perform one separately authorized bounded local rebase and preserve conflicts stopped. |
| `reply-to-review-thread` | Reply to one exact review thread without resolving it. |
| `resolve-context-capabilities` | Resolve named session capabilities for implementation planning without execution. |
| `resolve-feedback-capabilities` | Resolve named session capabilities for selected feedback without execution. |
| `resolve-review-thread` | Resolve one eligible current thread after validated follow-up. |
| `rewrite-github-issue` | Draft one implementation-ready issue revision from a `ProductInterview` or an adaptive interview. |
| `rewrite-issue` | Restructure issue text without interview or GitHub publication. |
| `structure-issue` | Structure one issue request into a normalized assessment. |
| `submit-pr-review` | Publish one explicitly approved exact review payload. |
| `summarize-feedback-resolution` | Summarize validated feedback as resolved, open, disputed, or blocked. |
| `update-github-issue` | Apply one validated partial issue-field patch and verify it. |
| `validate-feedback-resolution` | Validate every selected feedback item against current diff, commits, tests, and checks. |
| `validate-implementation-result` | Consolidate scope, completion, and validation evidence before delivery. |
| `validate-rebased-branch` | Validate post-rebase history, scope, tests, and checks without mutation. |
| `verify-linked-issue-closure` | Verify expected automatic issue closure after a verified merge. |
| `verify-worktree` | Verify one existing workspace read-only before implementation. |

## Rules

| Rule | Responsibility |
| --- | --- |
| `github-scope-contract.mdc` | Defines the collaboration boundary and external-capability firewall. |
| `github-safety.mdc` | Owns the hard-operation safety floor and secret prohibition. |
| `branch-worktree-policy.mdc` | Defines workspace selection, isolation, verification, and reuse boundaries. |
| `github-evidence.mdc` | Requires observable evidence for GitHub facts and review findings. |
| `interactive-approval.mdc` | Owns task-scoped routine autonomy and independent hard-operation gates. |
| `commit-policy.mdc` | Defines exact-scope, validation, authorization, secret, and commit-history checks. |
| `pull-request-policy.mdc` | Defines Draft PR content, validation, linkage, duplicate, and ready-state boundaries. |
| `merge-policy.mdc` | Defines current merge evidence, strategy, authorization, and post-merge boundaries. |
| `product-decomposition-policy.mdc` | Defines nearly atomic GitHub product-issue splits with one outcome, verifiable acceptance criteria, independent value, and justified dependency limits. |
| `product-interview-policy.mdc` | Requires an adaptive user interview to gather product-decomposition decisions without inventing essential product choices or ending while unaccepted uncertainties remain. |
| `issue-priority-title-policy.mdc` | Defines unique consecutive P-number title prefixes for the current open-issue inventory, exact-set write authorization, and the exclusive write boundary for those prefixes. |
| `plugin-versioning.mdc` | Defines component change classes, synchronized package and contract versions, public migration and changelog requirements, and external Skill and Rule compatibility. |

Rules own policy. Agents and Commands reference them; they must not restate
their full safety or approval lists.

## Hooks

| Hook | Host projection | Responsibility |
| --- | --- | --- |
| `pre-commit.mjs` | Cursor `beforeShellExecution`; Codex `PreToolUse` | Fail closed before an identified AI commit unless the local `PreCommitGate` and current worktree evidence pass. |
| `pre-rebase.mjs` | Cursor `beforeShellExecution`; Codex `PreToolUse` | Fail closed before a new local rebase start unless the exact `PreRebaseGate` passes, and allow only standalone recovery of the same active rebase when its metadata and registered worktree identity match. |
| `pre-pr-create.mjs` | Cursor `beforeShellExecution`; Codex `PreToolUse` | Fail closed before `gh pr create` unless the exact Draft gate passes. |
| `pre-review-submit.mjs` | Cursor `beforeShellExecution`; Codex `PreToolUse` | Fail closed before the canonical review API write unless the exact review gate passes. |
| `pre-pr-ready.mjs` | Cursor `beforeShellExecution`; Codex `PreToolUse` | Fail closed before `gh pr ready` or an authorized reviewer-request write unless the exact `PrePrReadyGate` passes. |
| `pre-merge.mjs` | Cursor `beforeShellExecution`; Codex `PreToolUse` | Fail closed before a PR merge unless current merge evidence and `PreMergeGate` pass. |
| `post-merge.mjs` | Cursor `afterShellExecution`; Codex `PostToolUse` | Observe a completed merge and return read-only `PostMergeStatus`. |

`cursor-hooks.json` and `codex-hooks.json` are separate host projections.
The portable manifest contains no hook declarations.

`generate-project-hooks.mjs` is the deterministic projection generator. The
explicit `generate-project-hooks` Skill asks the user interactively for Cursor,
Codex, or both, then writes only the selected project configuration and
checker copies into the target repository. It never creates
`.cursor/hooks/state/*.json`; gate snapshots remain owning-Skill runtime
evidence and missing or mismatched snapshots continue to fail closed.

## Contracts

`shared/schemas/README.md` is the contract inventory and handoff-graph source
of truth. It must contain exactly the 83 versioned YAML contracts under
`shared/schemas/`: issue snapshots and drafts, repository and planning
handoffs, worktree and delivery handoffs, review and feedback handoffs,
integration and cleanup handoffs, host gate snapshots, the autonomous
`LifecycleRun` record, the `ProductSubIssueDrafts` record, the
`ProductPlannerRun` record, the `ProductSubIssuePublication` record, the
Ready-for-Review `PullRequestReady` and `PrePrReadyGate` records, the
open-issue reprioritization `OpenIssueInventory`, `OpenIssueRanking`, and
`IssueReprioritization` records, the triage-close `IssueClosure` record, and
the CI wait, rerun, and fix `RequiredCheckWait`, `RequiredCheckRerun`,
`CiFixPlan`, and `CiFixRun` records. Contract field names,
versions, status values, and approval semantics remain synchronized with the
Skills, Agents, Commands, and fixtures; breaking changes require a version
change.

## Synchronization and validation

When any capability changes, update the applicable source and verify:

1. `plugin.json` and all host manifests remain valid and point only to local
   directories; the Codex manifest omits unverified native command and Agent
   registration keys.
2. `README.md` inventories every Command, Skill, Agent, Rule, Hook, and
   contract; `shared/schemas/README.md` inventories every YAML contract.
3. `../tests/lib/handoff-graph.ts`, valid fixtures, and contract tests describe
   the same producers, consumers, optional references, and Agent ownership.
4. Automatic Skills do not set `disable-model-invocation`; explicit mutation
   Skills document their invocation boundary.
5. The canonical delivery order is compose Draft → link the issue → optionally
   recompose with a changed validated link → create the Draft PR.
6. Run `npm test` from the repository root after any Skill, Agent, Command, or
   shared-contract change. Use `npm run typecheck` when TypeScript handoffs or
   test helpers change.

All durable plugin artifacts are English. Preserve exact external API text and
user-provided values where fidelity is required.
