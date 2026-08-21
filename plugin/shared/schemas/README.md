# GitHub Workflow Contracts

This directory contains the stable data contracts shared by future commands,
Agents, and Skills in the `github` plugin. Each YAML file is a human-readable
schema description, not a runtime payload. Implementations must preserve the
field names, required fields, and enumerated values unless the contract
version changes.

## Contract inventory

| Contract | Purpose |
| --- | --- |
| `HandoffGraph` | Version 1 structural meta-schema for the canonical typed workflow graph; describes architecture source data and is excluded from workflow-output orphan classification. |
| `LoadedIssue` | Version 1 read-only GitHub issue snapshot with preserved content, related pull requests, comments, metadata, and availability evidence. |
| `LoadedPullRequest` | Version 1 read-only GitHub pull-request snapshot with preserved content, head and base revisions, commits, file metadata, checks, reviews, draft state, authors, related issues, and availability evidence. |
| `PullRequestDiffAnalysis` | Version 1 read-only analysis of one pull-request diff across eight review categories, with evidence-backed findings, applied capability evidence, and separate uncertainties. |
| `PullRequestCheckInspection` | Version 1 read-only inspection of pull-request status checks, CI results, explicitly retrieved required checks, and pass, fail, pending, skipped, or missing outcomes; used by both broad and focused check-inspection workflows. |
| `DetectedReviewFindings` | Version 1 read-only source aggregation of diff, issue-coverage, check, discussion, and external-rule evidence into proposed `ReviewFinding`-compatible findings. |
| `DeduplicatedReviewFindings` | Version 1 read-only content-level comparison of proposed findings with one another and retrieved pull-request discussion threads, preserving distinct causes and auditable suppression records. |
| `ClassifiedReviewFindings` | Version 1 read-only classification of every deduplicated review finding by evidence-supported severity and domain category, with preserved thread metadata and no publication. |
| `LoadedPullRequestDiscussions` | Version 2 read-only pull-request discussion snapshot grouped by review thread and affected location, preserving reviews, replies, comments, authors, timestamps, resolution state, and the exact pull-request, head, and base identity with retrieval provenance. |
| `CollectedReviewFeedback` | Version 1 read-only grouped follow-up handoff for open, resolved, outdated, or addressed review feedback, request-changes findings, relevant comments, and failed or missing required checks. |
| `ClassifiedReviewFeedback` | Version 1 read-only classification of collected feedback by cause, severity, affected component, and required follow-up action. |
| `ExternalCapabilityResolution` | Version 1 canonical pure resolution of normalized context or feedback requirements against current host-session evidence, preserving available, unavailable, missing, ambiguous, provenance, and fail-closed gaps. |
| `FeedbackResolutionCapabilities` | Legacy version 1 lossless, fail-closed transition projection of ExternalCapabilityResolution for explicitly confirmed open feedback. |
| `FeedbackResolutionPlan` | Version 1 read-only, scope-bounded plan for explicitly confirmed open feedback, with ordered corrections and external implementation handoffs. |
| `ResolvedReviewFeedback` | Version 1 read-only comparison of collected feedback with the latest pull-request state, later commits, current diff, and explicit test evidence, preserving only clearly supported resolved candidates. |
| `FeedbackResolutionValidation` | Version 1 read-only validation of every confirmed feedback item after external follow-up, with current-state evidence, remaining problems, and advisory thread-resolution eligibility. |
| `FeedbackResolutionSummary` | Version 1 read-only summary of validated feedback follow-up, grouping each item as resolved, open, disputed, or blocked with evidence-linked next steps and diagnostic merge impact. |
| `LinkedIssue` | Version 1 read-only resolution of one pull request's issue candidates from explicit references, closing keywords, and GitHub relationships, with nested issue loading only after unique linkage. |
| `LinkedIssueStatusAssessment` | Version 1 read-only assessment of one pull request's linked issue state, explicit acceptance-criteria coverage, closing relationship, and integration consistency. |
| `LinkedIssueClosureVerification` | Version 1 read-only post-merge verification of one uniquely linked issue's expected closure, live state, relationship attribution, timing, cause, and safe next step. |
| `LinkedIssueClosure` | Version 2 explicitly authorized post-merge closure of one uniquely linked issue, with immediate preflight, narrow state mutation, optional separately authorized merge-reference comment, post-write verification, and a validated close-on-merge fallback authorization. |
| `IssueAnalysis` | Version 1 evidence-based issue analysis with severity findings, requirement inventories, and implementation readiness. |
| `ProductAssessment` | Version 1 read-only product analysis of one parent GitHub issue, covering product topics, mixed features, implicit requirements, and interview focus without creating sub-issues. |
| `ProductInterview` | Version 2 canonical structured record of the sole adaptive product interview for a normalized new request or a loaded issue, preserving confirmed decisions, assumptions, open questions, accepted uncertainties, and source provenance without creating sub-issues. |
| `ProductInterviewPrerequisite` | Version 1 typed prerequisite emitted by deterministic issue structuring, acceptance-criteria, and rewrite consumers when a matching complete `ProductInterview` v2 is unavailable. |
| `ProductCapabilityMap` | Version 1 hierarchical Capability Map from one parent `LoadedIssue` and one confirmed `ProductInterview` v2, grouping requirements by independently understandable Product Value and behavior areas without creating sub-issues. |
| `ProductCapabilityDecomposition` | Version 1 iterative decomposition of confirmed Product Capabilities from one parent `LoadedIssue` and one `ProductCapabilityMap` into the smallest value-oriented units, each with one observable outcome and independent acceptance, without creating sub-issues. |
| `IssueAtomicityAssessment` | Version 1 read-only atomicity assessment of each proposed sub-issue candidate from one `ProductCapabilityDecomposition`, classifying every unit as `too-large`, `atomic-enough`, or `over-fragmented` without creating sub-issues. |
| `ProductDependencyGraph` | Version 1 read-only directed dependency graph of atomic sub-issue candidates from one `ProductCapabilityDecomposition` and one `IssueAtomicityAssessment`, distinguishing evidenced product and mandatory technical relations without ranking slices by technical order or creating sub-issues. |
| `ProductIssuePrioritization` | Version 1 read-only MoSCoW ranking of classified sub-issue candidates from one `ProductDependencyGraph`, recording recommended versus confirmed classes, six-dimension rationales, explicit user decisions, and divergences between product priority and required implementation order without creating sub-issues. |
| `OpenIssueInventory` | Version 1 read-only inventory of every currently open GitHub issue in one repository, excluding pull requests, with current titles and parsed P-prefix evidence. |
| `OpenIssueRanking` | Version 1 unique consecutive P1-through-Pn ranking of one open-issue inventory with recommended versus confirmed ranks, exact proposed titles, and exact-set authorization without writing GitHub. |
| `IssueReprioritization` | Version 1 exact-set title-application result for one confirmed open-issue ranking, recording per-issue updates, no-ops, failed operations, live-identity preflight, and verification. |
| `ProductSubIssueDrafts` | Version 2 read-only canonical complete English sub-issue drafts from confirmed atomic units, preserving exact title, body, label operations, parent, dependency, priority, and traceability fields with a deterministic SHA-256 identity without authorizing publication. |
| `AffectedAreas` | Version 1 evidence-based mapping from an issue or task to affected repository areas, relevant paths, dependencies, and direct, indirect, or uncertain impact. |
| `IssueDraft` | Version 2 task-authorized create-or-edit issue title, body, label operations, and publication evidence. `issue-agent` `create` maps to `create`; `refine` maps to `edit`. |
| `IssueUpdate` | Version 1 task-authorized partial issue-field update patch with live baseline, preview, applied effects, warnings, and verification evidence. |
| `IssueRevisionComparison` | Version 1 evidence-based semantic diff between an original issue and one rewritten revision, including scope drift and contradiction flags. |
| `IssueAssessment` | Clarification state, locked requirements, non-goals, assumptions, and readiness. |
| `ImplementationEvaluation` | Version 1 evidence-based evaluation of implementation feasibility, architectural fit, dependencies, risks, compatibility, testing implications, and meaningful alternatives. |
| `ContextCapabilities` | Legacy version 1 lossless, fail-closed transition projection of ExternalCapabilityResolution for implementation planning. |
| `ImplementationPlan` | Version 1 task-authorized implementation objective with affected areas, ordered steps and dependencies, validation, capabilities, workspace, risks, prerequisites, blockers, assumptions, unresolved questions, and delivery authorization evidence. |
| `RepositoryPolicy` | Version 1 repository-owned configuration for PR description, rebase posture, and secret-scan preferences with compatibility-default and fail-closed invariants. |
| `RepositoryContext` | Version 1 verified repository identity, Git state, remotes, instructions, relevant paths, technologies, commands, and evidence-based findings. |
| `RepositoryConventions` | Version 1 evidence-based development conventions for planning and implementation, including authority, scope, confidence, and conflicts. |
| `BranchNameProposal` | Version 1 evidence-based Git branch name proposal with issue-number provenance, applied convention, rationale, and alternatives. |
| `TargetBranchFetch` | Version 1 exact-target remote branch fetch and verification result with approval evidence, repository and ref identity, matching remote/tracking SHAs, and structured failure evidence. |
| `RebaseConflictAnalysis` | Version 1 read-only analysis of one stopped or explicitly planned rebase, preserving confirmed and potential conflicts, base/ours/theirs evidence, impacts, capability limits, and a separate resolution handoff without authorizing resolution. |
| `BranchRebase` | Version 1 exact authorization-bounded local rebase result with verified pull-request, worktree, and target identity, preflight, conflict or success state, and post-rebase verification without authorizing resolution or push. |
| `BranchWorkspace` | Isolated branch/worktree identity, base revision, cleanup authorization, and read-only verification or failure evidence. |
| `WorkingTreeInspection` | Version 1 read-only working-tree inventory with branch and worktree identity checks, changed paths, diff statistics, and unexpected-state markers for downstream scope and commit review. |
| `ChangeClassification` | Version 1 read-only classification of worktree changes by purpose, component, issue or implementation-plan relationship, and evidence-backed scope alignment for commit planning. |
| `UnrelatedChangeDetection` | Version 1 read-only detection of unrelated or uncertain changes, necessary technical side effects, evidence and confidence, and commit or pull-request scope gates. |
| `ValidationResult` | Version 2 evidence-backed implementation-result validation combining plan completion, working-tree inspection, change classification, explicit evidence requirements, scope gates, required checks, blockers, warnings, and diagnostic commit or draft-pull-request readiness. |
| `GateLifecycle` | Version 1 host-neutral authority or non-authorizing receipt with one operation-specific nonce, exact five-minute expiry, maximum 60-second future skew, persistent consumption, and receipt-expiry fields. |
| `PreCommitGate` | Version 4 local-only snapshot binding one AI commit to a verified worktree, exact approved scope, complete version-2 `ValidationResult` evidence, task-scoped authorization, exact message-file bytes, cached staged-index fingerprint, and a one-shot lifecycle authority before the canonical final commit command. |
| `PreRebaseGate` | Version 2 local-only snapshot binding one exact authorized rebase phase to a verified pull-request branch, clean worktree, current remote context, unique target base, full `TargetBranchFetch` evidence, and a phase-specific one-shot lifecycle authority. |
| `PrePrCreateGate` | Version 3 local-only snapshot binding one exact Draft pull-request publication to a verified commit, pushed branch, unique issue link, complete description, passed version-2 validation, and a one-shot lifecycle authority before `gh pr create`. |
| `PreReviewSubmitGate` | Version 2 local-only snapshot binding one exact AI pull-request review publication to structurally complete, deduplicated, explicitly confirmed, current review evidence, and a one-shot lifecycle authority before the review write. |
| `PreMergeGate` | Version 4 local-only snapshot binding one exact approved pull-request merge to a final live preflight, version-3 `MergeReadiness` with an embedded immutable version-1 readiness evidence snapshot, explicit merge authorization, and a one-shot lifecycle authority before the merge write. |
| `PullRequestReady` | Version 1 exact authorization-gated Ready-for-Review intent, optional confirmed reviewer requests, live preflight, and verification for one open Draft pull request with a unique linked issue. |
| `PrePrReadyGate` | Version 2 local-only snapshot binding one exact Ready-for-Review transition or a separate requested-reviewers POST to a current pull request with a phase-specific one-shot lifecycle authority. |
| `PostMergeStatus` | Version 1 read-only post-merge status preserving PR and merge-commit verification, expected linked-issue closure, cleanup availability, separate authorization requirements, open actions, and deviations without performing cleanup. |
| `CommitProposal` | Version 1 intended file scope, English commit message, rationale, validation evidence, explicit authorization state, and verified commit result for the composition and creation workflows. |
| `BranchPush` | Version 1 verified branch-push result with repository, branch, remote, upstream, local-status, authorization, and post-push verification evidence. |
| `PullRequestDraft` | Version 1 evidence-backed English draft pull-request description with issue linkage, branch identity, validation evidence, authorization state, and publication verification fields. |
| `PullRequestIssueLink` | Version 1 read-only, evidence-backed relationship between exactly one Draft pull request and exactly one issue, including explicit closing-keyword intent without closing the issue. |
| `PullRequestMerge` | Version 2 exact authorization-gated pull-request merge intent, version-3 snapshot-backed readiness and preflight evidence, executed strategy, and post-merge verification result. |
| `PullRequestIntegration` | Version 1 lifecycle record for one pull request through readiness, target refresh, conflict analysis, rebase, validation, push, merge, issue-closure verification, and separately authorized cleanup decisions. |
| `LifecycleRun` | Version 1 task-authorized record of one autonomous issue-to-draft-PR run through create or an existing-issue refine entry, then preparation, external implementation, and Draft pull-request delivery, stopping before review. Absent `entry_phase` means `issue_create`. |
| `ReviewFinding` | Evidence-based finding with severity, location, impact, recommendation, and verification. |
| `ReviewDecision` | Version 1 composition-only or authorization-gated review event payload, confirmation evidence, publication result, and verification. |
| `ReviewFixPlan` | Version 1 host-neutral, interactively confirmed plan of mandatory fixes for one existing pull-request head branch. |
| `FeedbackLifecyclePlan` | Version 1 canonical head-bound feedback plan with `fix`, `full`, and `follow_up` modes, typed transitions, validation requirements, and independent effect authorization. |
| `FeedbackLifecycleRun` | Version 1 canonical lifecycle state record preserving transitions, current head, implementation delivery evidence, feedback IDs, blockers, and separately authorized thread effects. |
| `ReviewFixRun` | Version 2 compatibility projection of the canonical `FeedbackLifecycleRun` fix mode; it does not own independent review-fix state. |
| `ProductPlannerRun` | Version 2 lifecycle record for one interactive parent-issue product-planning run that consumes one canonical ProductSubIssueDrafts v2 identity and binds exact-set approval to its digest without carrying an independent publishable title/body set. |
| `ProductSubIssuePublication` | Version 2 exact-set publication result that records the canonical identity, exact approved unit set, lossless IssueDraft v2 adapter verification, GitHub mappings, parent and hard-dependency outcomes, and failed operations after attempting every confirmed sub-issue before finalizing relationships. |
| `ReviewThreadReply` | Version 3 exact, evidence-backed reply to one pull-request review-thread comment bound to a canonical lifecycle transition and validated current head, without resolving the thread. |
| `ReviewThreadResolution` | Version 3 scoped or authorization-gated resolution of exactly one open pull-request review thread bound to a canonical lifecycle transition and validated current head. |
| `MergeReadiness` | Version 3 deterministic read-only transformation of exactly one complete version-1 `PullRequestReadinessEvidence` snapshot into mergeability, draft and review state, open-thread, approval, required-check, issue-coverage, blocker, and remaining-condition diagnostics. |
| `PullRequestReadinessEvidence` | Version 1 immutable, identity-bound snapshot of one pull request's repository, PR node, URL, head/base OIDs, freshness, policy, required checks, approvals, dismissals, change requests, fully paginated discussions, linked issue, acceptance criteria, conditional merge-method evidence, and per-source provenance. |
| `RequiredApprovalInspection` | Version 1 read-only inspection of explicitly retrieved branch-protection and ruleset review requirements, effective approvals, active change requests, pending review requests, and satisfied or missing approval conditions. |
| `OpenReviewThreadAssessment` | Version 1 read-only assessment of one pull request's open, resolved, outdated, and unknown review-thread states, separating evidence-backed required problems from optional discussions and uncertainties. |
| `CleanupResult` | Version 1 explicitly authorized worktree/branch cleanup actions and evidence, including preserved unsafe or recoverable targets and separate local/remote outcomes. |
| `RequiredCheckWait` | Evidence-backed wait for required pull-request checks after a verified head push, reporting pass, fail, pending, skipped, and missing required outcomes without treating pending or unavailable policy evidence as a pass. |
| `RequiredCheckRerun` | Exact authorization-gated rerun of failed required pull-request checks with live run-identity verification; optional checks and unauthorized names fail closed with no GitHub write. |
| `CiFixPlan` | Host-neutral, interactively confirmed plan for failed required checks on one existing pull-request head branch. |
| `CiFixRun` | Lifecycle record for one pull-request CI wait, authorized required-check rerun, and bounded external-fix loop on an existing head branch. |
| `IssueClosure` | Explicitly authorized triage closure of exactly one verified GitHub issue without a merged pull request, covering duplicate, not-planned, and consciously not-delivered reasons with live preflight and post-write verification. |

The automatic `validate-rebased-branch` Skill reuses `ValidationResult`; it does
not introduce a separate contract. It compares explicit pre-rebase and
post-rebase revisions, implementation scope, and current-head validation
evidence before returning the updated result.

The explicitly invoked `rebase-branch` Skill produces `BranchRebase` and owns
only the authorized local rebase. It writes a complete version-2 `PreRebaseGate`
immediately before the bounded Git command through the common lifecycle writer;
the host Hook claims that phase-specific authority and never performs the
rebase. A conflict remains stopped for a separate resolution workflow. The
`integration-agent` `integration` mode produces
`PullRequestIntegration`, which preserves the current head at every phase,
  independent hard-operation authorizations, blockers, deferred operations,
issue-closure verification, and branch/worktree cleanup outcomes.

Every authorizing `Pre*Gate` carries a version-1 `GateLifecycle` object. The
canonical runtime path is `.github/github-plugin/state/`, shared by Cursor and
Codex through `hooks/lib/gate-state.mjs`. Owner Skills publish with a flushed,
same-directory temporary file and non-overwriting atomic operation; Hooks
claim before semantic validation and persist nonce-consumption markers. A
five-minute lifecycle TTL and maximum 60-second future skew are independent of
the domain `written_at` value. Invalid, expired, replayed, malformed, or
legacy state is quarantined without recursive deletion. A consumed pre-merge
gate may create one non-authorizing receipt, which `post-merge` consumes and
removes exactly once. Receipts and consumed markers are not reusable by an
older plugin version during rollback.

## Canonical workflow graph

The `HandoffGraph v1` entry above is a structural meta-schema, not a runtime payload. The canonical workflow data is [`../graphs/handoff-graph.yaml`](../graphs/handoff-graph.yaml), and [`../graphs/handoff-graph.mmd`](../graphs/handoff-graph.mmd) is its checked Mermaid projection.

The canonical source owns the complete current Command, Agent, Skill, Shared Contract, external-capability, and terminal-node inventory. Its edge set distinguishes `entry`, `capability`, `handoff`, and `terminal` edges; payload-bearing edges use exact contract versions, while control edges explicitly use null payload fields. Producer classifications, optional/mode-specific transitions, identity/freshness requirements, mutation boundaries, and `AUD-*`/`S*`-bound gaps are maintained there.

The former full handoff Mermaid block is intentionally not maintained as an independent definition in this inventory. Product-planning and other workflow views must be obtained as filtered projections of the canonical YAML source. This directory remains the contract inventory; the graph source remains the architecture source of truth.

## Conventions

  - `version: 1` identifies the first stable shape of each contract. A
  breaking field, type, or enum change requires a new contract version.
- Durable text fields are written in English. Conversation language belongs in
  chat metadata and must not change GitHub-facing artifact requirements.
- Status values are explicit. Use `blocked` when a required precondition is
  missing, and `partial` when an external or local action already occurred but
  verification or completion is incomplete.
- `LoadedPullRequest` is a read-only immutable source snapshot. It preserves
  exact pull-request content and retrieved head, base, commit, file, check,
  review, comment, draft, author, and linked-issue evidence; unavailable fields
  remain explicit and never become inferred values.
- `PullRequestDiffAnalysis` is a read-only immutable diff-analysis result. It
  is tied to the verified pull-request head SHA, evaluates all eight review
  categories, keeps proposed findings grounded in changed-line or smallest
  verified-context evidence, records applied host capabilities, and keeps
  uncertainties separate from confirmed problems. It never authorizes review
  publication, change requests, approvals, merges, or local edits.
- `PullRequestCheckInspection` is a read-only check inspection tied to one
  pull-request head SHA. It preserves retrieved status and CI evidence,
  distinguishes pass, fail, pending, skipped, and missing outcomes, and
  reports required checks only from explicit branch-protection or applicable
  ruleset evidence. It never infers requirements or authorizes a merge.
- `DetectedReviewFindings` is a read-only aggregation tied to one
  pull-request head SHA. It combines supplied diff, explicit issue-coverage,
  exact required-check, actionable discussion, and applicable external-rule
  evidence into source-aggregated proposed findings, records each source and
  capability used, keeps uncertainties separate, and never publishes or
  authorizes a review.
- `DeduplicatedReviewFindings` is a read-only content-level comparison tied
  to one `DetectedReviewFindings` handoff. It compares findings with one
  another and retrieved discussion threads, merges only the same problem core,
  keeps distinct causal mechanisms separate, preserves suppressed entries for
  audit, and never changes GitHub.
- `ClassifiedReviewFindings` is a read-only classification tied to one
  `DeduplicatedReviewFindings` handoff. It preserves every active finding in
  order,
  reclassifies severity from observed impact and evidence, assigns a primary
  domain category, maps `nit` to `suggestion`, preserves merge and thread
  metadata, marks uncertain findings for discussion, and never removes,
  dismisses, or publishes a finding.
- `ReviewDecision` may first be composed as a `draft` from an exact,
  explicitly confirmed finding set supplied by the user or a matching
  repository policy. Composition groups blockers, required changes,
  and optional suggestions, includes evidence and an expected correction for
  every included request, and leaves both approval flags false. Publication
  requires a later exact-payload and event-authorization gate.
- `PreReviewSubmitGate` is a version-2 one-shot snapshot written immediately
  before the review API write. It binds the authorized decision to matching
  classified and deduplicated findings, explicit finding confirmation, valid
  locations, blocker-support evidence, current pull-request freshness, and a
  fresh `GateLifecycle` authority. The host hook claims the authority before
  deterministic structural checks and never reanalyzes or rewrites the review.
- `submit-pr-review` is the only publication step for an approved
  `ReviewDecision`. It rechecks the live pull-request identity, open state,
  head SHA, and every inline location immediately before publication, preserves
  the approved payload exactly, and returns verified publication evidence.
  Stale or ambiguous inline locations block publication instead of being
  relocated or silently converted.
- `FeedbackLifecyclePlan` and `FeedbackLifecycleRun` are the canonical plan
  and state contracts for one feedback lifecycle. Their `fix`, `full`, and
  `follow_up` modes preserve exact head continuity and independently authorize
  worktree, commit, push, reply, and resolution effects.
- `ReviewFixRun` v2 is a compatibility projection for `fix` mode. It retains
  the discoverable review-fix identity without owning a competing state
  machine.
- `ReviewThreadReply` v3 is the exact, evidence-backed handoff for one reply to
  one inline review-thread parent comment. Direct invocation requires user or
  matching repository-policy authorization; the canonical lifecycle may carry
  exact scoped reply authorization after current validation. Publication refreshes the
  pull request, thread, parent
  relationship, and head SHA immediately before writing, verifies the reply
  afterward, and never resolves, reopens, edits, dismisses, or minimizes the
  thread.
- `ReviewThreadResolution` is the exact version-3 handoff for one resolution
  mutation. It requires current addressed and resolution-eligible validation,
  verified platform support, an immediate pre-mutation open-thread refresh, and
  post-mutation verification. The feedback command may supply exact scoped
  authorization; direct invocation requires user or repository-policy authorization. It never resolves
  disputed, outdated, ambiguous, or insufficiently evidenced threads and never
  performs replies or unrelated mutations.
- `LoadedPullRequestDiscussions` is a version-2 read-only immutable discussion
  snapshot. It groups inline review comments and replies by thread and
  affected location, keeps conversation comments separate, preserves authors
  and timestamps, records retrieved resolution and outdated state, and carries
  the exact PR node, head, base, retrieval, and pagination identity without
  inferring relationships or making GitHub writes.
- `CollectedReviewFeedback` is a read-only follow-up handoff. It groups only
  equivalent problem cores, preserves separate review and check items, and
  distinguishes open, resolved, outdated, and explicitly addressed feedback
  without publishing, changing discussions, rerunning checks, or authorizing
  implementation.
- `ExternalCapabilityResolution` is the canonical version-1 pure capability
  firewall. The context and feedback wrappers derive requirements and map
  source references; the core alone applies exact identity, narrowest
  selection, current-session provenance, available/unavailable/missing/
  ambiguous semantics, stale-session handling, and required versus optional
  gap impact. It never installs, authenticates, configures, executes, or
  mutates external capabilities.
- `ContextCapabilities` and `FeedbackResolutionCapabilities` are legacy
  transition projections. They may be produced only from a canonical result
  through lossless fail-closed adapters; ambiguous, stale, unsupported, or
  identity-conflicting results cannot be represented as available.
- `FeedbackResolutionSummary` is a read-only, current-head-bound summary of
  one validated follow-up. It preserves each selected feedback item exactly
  once, groups it as resolved, open, disputed, or blocked, links solutions and
  remaining problems to the smallest available evidence, and records concrete
  next steps. Its merge impact is diagnostic only; it never authorizes a merge,
  thread mutation, reply, check rerun, or Git change.
- `LinkedIssue` is a read-only resolution handoff. It classifies each
  candidate as `linked` or `mentioned`, keeps `ambiguous` and `unresolved`
  results distinct, and loads an exact `LoadedIssue` only after one unique
  linked candidate is established.
- Paths are repository-relative unless a field explicitly says
  `worktree_path`. Repository-local capability references must stay within
  `plugin/`; do not reference another plugin.
- Timestamps use ISO 8601 strings. Secrets, tokens, private keys, `.env`
  contents, and credential-bearing values are never valid contract data.
- Lists preserve order where order affects execution, review priority, or
  publication payloads.
- `null` means that a value is not available or has not been produced; it does
  not mean that a required decision was authorized.
- `BranchWorkspace` verification is read-only. An `active` result requires
  complete evidence and `failure: null`; `partial` and `blocked` results
  preserve reliable evidence and include structured failure details.
- `WorkingTreeInspection` is read-only. An `inspected` result inventories the
  expected worktree without modifying the index or files; `unexpected_states`
  must stay explicit; `partial` and `blocked` results preserve reliable
  evidence and never claim an unverified clean or trusted identity.
- `ChangeClassification` is read-only. An `inspected` worktree is classified
  by purpose, component, and independent issue or implementation-plan
  relationships using diff and scope evidence; it never grants staging or
  commit authorization.
- `UnrelatedChangeDetection` is read-only. It consumes a version-1
  `ChangeClassification`, preserves uncertainty, distinguishes necessary
  technical side effects from scope violations, and reports diagnostic commit
  and pull-request gates without granting authorization or changing paths.
- `ValidationResult` is read-only. It consolidates version-2 implementation
  plan, working-tree, change-classification, and applicable scope-gate
  evidence; it blocks unresolved scope deviations, missing required
  validations, and unmet completion criteria. Its commit and draft
  pull-request readiness flags are diagnostic only and never invent
  task-scoped authorization. Its mandatory `evidence_requirements` list
  preserves only explicitly declared requirements and records `satisfied`,
  `missing`, or `blocked` outcomes. An empty list means no evidence is
  required; frameworks, filenames, paths, and generated artifact names never
  create requirements.
- `PreCommitGate` is a local-only, version-4 snapshot written after
  validation and before the final commit status check. It binds the exact
  `CommitProposal`, complete `ValidationResult`, worktree path, branch,
  pre-commit `HEAD`, approved message-file bytes, and cached staged-index
  fingerprint for the deterministic host hook. The only permitted command is
  one standalone direct `git -C <verified-worktree> commit
  --cleanup=verbatim --file=<approved-message-file>` invocation. The hook
  reads the snapshot and current Git state only; it never repairs, stages, or
  changes the workspace. It carries a fresh lifecycle authority and is claimed
  before semantic validation, so command failure cannot replay it. The ignored
  canonical state path must never be staged. Older snapshots fail closed.
- `PrePrCreateGate` is a local-only, version-3 snapshot written immediately
  before `gh pr create`. It binds the exact `PullRequestDraft`,
  `PullRequestIssueLink`, created `CommitProposal`, verified `BranchPush`,
  complete passed `ValidationResult`, worktree identity, expected head SHA,
  and a fresh lifecycle authority. Its deterministic host hook claims the
  authority before checking the command, live Git and remote branch, exact
  title and body, required description sections, unique issue link, and open
  blockers without modifying any content or Git state.
- `CommitProposal` is composition-only while `status` is `draft` or `partial`.
  The `create-commit` Skill accepts only an `approved` proposal with both
  authorization flags true, a verified routine authorization source, stages
  only its exact approved path union, uses its exact approved message, and
  verifies the resulting Git commit. A `created` proposal contains the
  verified SHA, timestamp, and committed paths; `partial` preserves the result
  when a commit exists but verification is incomplete.
- `BranchPush` is the version-1 handoff for one verified branch push. The
  `push-branch` Skill accepts a trusted `BranchWorkspace`, verifies repository,
  branch, remote, upstream, and local status before the write, uses verified
  task-scoped routine authorization for non-force delivery, and returns
  `verified` only after the remote branch points to the expected local head
  SHA. Force-push authorization is separate and never implied by normal push
  authorization.
- `PullRequestDraft` is composition-only while `status` is `draft`. The
  `compose-pr-description` Skill consumes a verified issue,
  `ImplementationPlan`, passed `ValidationResult`, and created
  `CommitProposal`, preserves repository pull-request templates when
  available, and returns an English description without pushing or publishing.
  It may carry existing task-scoped routine push and draft-publication
  authorization without inventing it from readiness. The `create-draft-pr`
  Skill consumes that explicitly authorized draft plus verified pushed-branch
  evidence, checks for an existing open head-to-base pull request, and uses
  only the approved title and body. It populates the pull-request number, URL,
  and verification fields only after GitHub verifies the existing or created
  draft and its repository, branches, head SHA, title, and body. It never
  requests review, marks the draft ready, merges, rebases, or edits a
  duplicate pull request.
- `PullRequestIssueLink` is read-only and identifies exactly one verified issue
  for exactly one Draft pull request. It defaults to the neutral `Refs`
  relationship, uses `Fixes`, `Closes`, or `Resolves` only when repository
  convention or supplied intent explicitly establishes close-on-merge behavior
  for a merge into the repository's default branch, and returns the
  relationship kind and evidence without editing GitHub or closing the issue.
  Ambiguous or conflicting issue candidates remain `ambiguous` or `blocked`.
- `PullRequestMerge` is the version-2 authorization-gated handoff for exactly one
  GitHub pull-request merge. It requires a current, identity- and SHA-matched
  version-3 `MergeReadiness` result of `ready` carrying one complete version-1
  `PullRequestReadinessEvidence` snapshot and independent exact final
  authorization for the repository, pull request, expected head and base SHAs,
  base branch, method, commit metadata, and requested remote branch deletion. It records
  the immediate live preflight, uses only the explicitly selected
  GitHub-supported strategy, and returns `merged` only after verifying the
  final PR state and merge-commit SHA. Readiness never authorizes a merge;
  state changes block before the write, and cleanup remains a separate
  authorized workflow after successful verification.
- `PullRequestReadinessEvidence` is the version-1 immutable snapshot built only
  from the fixed-order reader handoffs. It binds repository, PR number, node
  ID, URL, head OID, base branch/OID, freshness, policy, checks, approvals,
  dismissals, change requests, fully paginated discussions, linked issue,
  acceptance criteria, conditional merge-method evidence, and each source's
  provenance. Empty and unavailable sources remain distinct; mixed, stale,
  partial, unavailable, or ambiguous evidence cannot be complete.
- `MergeReadiness` version 3 is a pure deterministic transformation of exactly
  one complete snapshot. It retains that snapshot under `readiness_evidence`
  and never refreshes a source or interprets live policy.
- `PrePrReadyGate` is a version-2 local-only snapshot with a phase-specific
  lifecycle operation. The `pre-pr-ready` authority is written and claimed
  before `gh pr ready`; a non-empty reviewer set requires a second fresh
  `pre-reviewer-request` authority with `is_draft: false`. Neither authority
  covers the other mutation.
- `PreMergeGate` is a version-4 local-only snapshot written immediately before
  the GitHub merge write. It binds the exact pull request, expected head and
  base SHAs, final live preflight, selected method, branch-deletion effect,
  complete version-3 `MergeReadiness` with its version-1 snapshot, explicit
  merge authorization, and a fresh lifecycle authority. Its host hook claims
  the authority before validating the embedded current policy evidence, final
  preflight, exact Git identity, and command compare-and-set without executing
  a GitHub or GraphQL live read or authorizing the merge.
- `PostMergeStatus` is a version-1 read-only result emitted after one observed
  GitHub pull-request merge and, when available, one consumed non-authorizing
  pre-merge receipt. It preserves the live PR state, merge timestamp
  and commit, target-branch containment, expected issue closure and
  attribution, local and remote branch/worktree availability, open cleanup
  actions, deviations, and evidence limitations. Every cleanup action requires
  separate exact user or repository-policy authorization; the Hook never performs cleanup, issue closure, or
  state-file writes; the receipt is consumed and removed exactly once and
  cannot authorize a replay or cleanup operation.
- `LinkedIssueClosureVerification` is the version-1 read-only post-merge
  handoff for exactly one pull request and one uniquely linked issue. It keeps
  merge identity, closing intent, GitHub relationship evidence, target branch,
  live issue state, closure timing, and attribution separate. It reports an
  open issue as a diagnostic `not-closed` result with an evidence-backed cause
  or safe next step and never closes, edits, comments on, or otherwise mutates
  the issue or pull request.
- `LinkedIssueClosure` is the version-2 explicitly authorized mutation handoff
  for one uniquely linked issue after a verified merge. It requires a matching
  `not-closed` verification, complete current implementation evidence, exact
  close authorization, and immediate PR, relationship, and issue preflight.
  The `close_on_merge_intent` source is limited to the exact validated
  close-on-merge relationship and current verification; it does not authorize
  neutral `Refs` relationships or comments. The handoff may carry a
  separately authorized exact merge-reference comment, verifies every external
  effect, returns `no-op` for an already closed issue, and never mutates
  unrelated issue metadata or pull-request state.
- `ProductSubIssueDrafts` v2 is the canonical, draft-only approved-publication
  candidate. Its exact title, body, add/remove/preserve label operations,
  parent relationship, hard dependencies, priority, and traceability are
  hashed into one deterministic SHA-256 identity. The digest is not itself
  authorization and the handoff never writes GitHub.
- `ProductPlannerRun` v2 records only lifecycle/progress data plus the
  canonical-set identity. `drafts_ready` keeps exact_payload, exact_set, and
  publication_authorized false; publication handoff requires all three true
  and a matching approval digest.
- `ProductSubIssuePublication` v2 is the exact-set publication result for one
  approved canonical payload. It records adapter equivalence, maps each unit
  to a verified GitHub issue, records parent sub-issue links and hard
  `blocks`/`requires` dependencies, preserves omitted units and failed
  operations, and never overwrites the parent or silently rewrites title,
  body, or labels. Relationship writes begin only after every approved create
  has been attempted. `published` requires a complete verified mapping,
  verified adapter set, and relationship set with `failure` null.
- `OpenIssueInventory` is the version-1 read-only inventory of currently open
  GitHub issues in one repository. It excludes pull requests, preserves exact
  titles and parsed P-prefix evidence, and fails closed when the retrieved
  list is truncated.
- `OpenIssueRanking` is the version-1 unique consecutive `P1` through `Pn`
  ranking of that inventory. A recommendation is not a confirmation. Title
  writes require `ranked` status with `ranking_confirmed`, `exact_payload`,
  and `exact_set` all true.
- `IssueReprioritization` is the version-1 exact-set title-application
  result. Live open-issue numbers must match the approved set before any
  write. Bodies, labels, assignees, milestones, and state stay unchanged.
  Identical titles are `no_op`; later failures do not roll back successful
  title writes.

## Consumption rules

Agents and Skills should validate the relevant contract before handing data to
another workflow. A handoff must include the source contract version and must
not silently drop a required field. If a producer cannot satisfy a contract,
it returns a structured `blocked` or `partial` result rather than fabricating
values.
