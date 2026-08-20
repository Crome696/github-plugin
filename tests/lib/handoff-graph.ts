export interface ContractRef {
  name: string;
  version: number;
  versionRequired?: boolean;
}

export interface SkillHandoff {
  name: string;
  consumes: ContractRef[];
  produces: ContractRef[];
  requiresOneOf?: ContractRef[][];
  identityInput?: boolean;
  nonSchemaOutput?: boolean;
}

export interface AgentHandoff {
  name: string;
  consumes: ContractRef[];
  produces: ContractRef[];
  skills: string[];
  startsAgents?: string[];
}

export interface CommandHandoff {
  name: string;
  agent: string;
  mode?: string;
  contracts: ContractRef[];
}

const contract = (name: string, version: number): ContractRef => ({
  name,
  version,
});

const optionalContract = (name: string, version: number): ContractRef => ({
  name,
  version,
  versionRequired: false,
});

const identity = (name: string): SkillHandoff => ({
  name,
  consumes: [],
  produces: [],
  identityInput: true,
});

export const skillHandoffs: SkillHandoff[] = [
  {
    name: "analyze-issue",
    consumes: [contract("LoadedIssue", 1)],
    produces: [contract("IssueAnalysis", 1)],
  },
  {
    name: "analyze-product-issue",
    consumes: [contract("LoadedIssue", 1)],
    produces: [contract("ProductAssessment", 1)],
  },
  {
    name: "analyze-pr-diff",
    consumes: [contract("LoadedPullRequest", 1)],
    produces: [contract("PullRequestDiffAnalysis", 1)],
    identityInput: true,
  },
  {
    name: "apply-issue-priority-titles",
    consumes: [
      contract("OpenIssueRanking", 1),
      contract("OpenIssueInventory", 1),
    ],
    produces: [contract("IssueReprioritization", 1)],
  },
  {
    name: "assess-issue-atomicity",
    consumes: [contract("ProductCapabilityDecomposition", 1)],
    produces: [contract("IssueAtomicityAssessment", 1)],
  },
  {
    name: "assess-issue-quality",
    consumes: [],
    produces: [],
    nonSchemaOutput: true,
  },
  {
    name: "assess-merge-readiness",
    consumes: [
      contract("LoadedPullRequest", 1),
      contract("LoadedPullRequestDiscussions", 1),
      contract("OpenReviewThreadAssessment", 1),
      contract("LinkedIssue", 1),
      contract("PullRequestCheckInspection", 1),
      contract("RequiredApprovalInspection", 1),
    ],
    produces: [contract("MergeReadiness", 2)],
    identityInput: true,
  },
  {
    name: "build-feedback-resolution-plan",
    consumes: [
      contract("ClassifiedReviewFeedback", 1),
      contract("FeedbackResolutionCapabilities", 1),
    ],
    produces: [contract("FeedbackResolutionPlan", 1)],
  },
  {
    name: "build-review-fix-plan",
    consumes: [
      contract("LoadedPullRequest", 1),
      contract("ClassifiedReviewFindings", 1),
      contract("ClassifiedReviewFeedback", 1),
    ],
    produces: [contract("ReviewFixPlan", 1)],
    identityInput: true,
  },
  {
    name: "build-implementation-plan",
    consumes: [
      contract("LoadedIssue", 1),
      contract("IssueAssessment", 1),
      contract("IssueAnalysis", 1),
      contract("RepositoryContext", 1),
      contract("AffectedAreas", 1),
      contract("ImplementationEvaluation", 1),
      contract("ContextCapabilities", 1),
      contract("RepositoryConventions", 1),
      optionalContract("BranchWorkspace", 1),
    ],
    produces: [contract("ImplementationPlan", 1)],
  },
  {
    name: "build-ci-fix-plan",
    consumes: [
      contract("LoadedPullRequest", 1),
      contract("PullRequestCheckInspection", 1),
      contract("RequiredCheckWait", 1),
      optionalContract("RequiredCheckRerun", 1),
    ],
    produces: [contract("CiFixPlan", 1)],
  },
  {
    name: "wait-required-checks",
    consumes: [
      contract("LoadedPullRequest", 1),
      contract("PullRequestCheckInspection", 1),
    ],
    produces: [contract("RequiredCheckWait", 1)],
    identityInput: true,
  },
  {
    name: "rerun-required-checks",
    consumes: [
      contract("LoadedPullRequest", 1),
      contract("PullRequestCheckInspection", 1),
      optionalContract("RequiredCheckWait", 1),
      contract("RequiredCheckRerun", 1),
    ],
    produces: [contract("RequiredCheckRerun", 1)],
    identityInput: true,
  },
  {
    name: "build-product-dependency-graph",
    consumes: [
      contract("ProductCapabilityDecomposition", 1),
      contract("IssueAtomicityAssessment", 1),
    ],
    produces: [contract("ProductDependencyGraph", 1)],
  },
  {
    name: "check-linked-issue-status",
    consumes: [
      contract("LoadedPullRequest", 1),
      contract("LinkedIssue", 1),
      contract("PullRequestDiffAnalysis", 1),
    ],
    produces: [contract("LinkedIssueStatusAssessment", 1)],
    identityInput: true,
  },
  {
    name: "check-open-review-threads",
    consumes: [
      contract("LoadedPullRequest", 1),
      contract("LoadedPullRequestDiscussions", 1),
      contract("ClassifiedReviewFindings", 1),
      contract("FeedbackResolutionValidation", 1),
    ],
    produces: [contract("OpenReviewThreadAssessment", 1)],
    identityInput: true,
  },
  {
    name: "check-required-approvals",
    consumes: [contract("LoadedPullRequest", 1)],
    produces: [contract("RequiredApprovalInspection", 1)],
    identityInput: true,
  },
  {
    name: "check-required-status-checks",
    consumes: [contract("PullRequestCheckInspection", 1)],
    produces: [contract("PullRequestCheckInspection", 1)],
  },
  {
    name: "classify-changes",
    consumes: [
      contract("WorkingTreeInspection", 1),
    ],
    requiresOneOf: [[
      contract("ImplementationPlan", 1),
      contract("ReviewFixPlan", 1),
    ]],
    produces: [contract("ChangeClassification", 1)],
  },
  {
    name: "classify-review-feedback",
    consumes: [contract("CollectedReviewFeedback", 1)],
    produces: [contract("ClassifiedReviewFeedback", 1)],
  },
  {
    name: "classify-review-findings",
    consumes: [contract("DeduplicatedReviewFindings", 1)],
    produces: [contract("ClassifiedReviewFindings", 1)],
  },
  {
    name: "cleanup-worktree",
    consumes: [contract("PullRequestMerge", 1), contract("CleanupResult", 1)],
    produces: [contract("CleanupResult", 1)],
  },
  {
    name: "close-github-issue",
    consumes: [contract("LoadedIssue", 1), contract("IssueClosure", 1)],
    produces: [contract("IssueClosure", 1)],
    identityInput: true,
  },
  {
    name: "close-linked-issue",
    consumes: [
      contract("PullRequestMerge", 1),
      contract("LinkedIssueClosureVerification", 1),
      contract("LinkedIssueStatusAssessment", 1),
      contract("PullRequestIssueLink", 1),
      contract("LinkedIssueClosure", 2),
    ],
    produces: [contract("LinkedIssueClosure", 2)],
  },
  {
    name: "collect-review-feedback",
    consumes: [
      contract("LoadedPullRequestDiscussions", 1),
      contract("ClassifiedReviewFindings", 1),
      contract("PullRequestCheckInspection", 1),
    ],
    produces: [contract("CollectedReviewFeedback", 1)],
    identityInput: true,
  },
  {
    name: "compare-issue-revision",
    consumes: [contract("LoadedIssue", 1), contract("IssueDraft", 2)],
    produces: [contract("IssueRevisionComparison", 1)],
  },
  {
    name: "compose-commit-message",
    consumes: [
      contract("ValidationResult", 1),
      contract("WorkingTreeInspection", 1),
      contract("ChangeClassification", 1),
      contract("UnrelatedChangeDetection", 1),
    ],
    requiresOneOf: [[
      contract("ImplementationPlan", 1),
      contract("ReviewFixPlan", 1),
    ]],
    produces: [contract("CommitProposal", 1)],
  },
  {
    name: "compose-pr-description",
    consumes: [
      contract("LoadedIssue", 1),
      contract("ImplementationPlan", 1),
      contract("ValidationResult", 1),
      contract("CommitProposal", 1),
      optionalContract("PullRequestIssueLink", 1),
    ],
    produces: [contract("PullRequestDraft", 1)],
  },
  {
    name: "compose-review",
    consumes: [contract("ClassifiedReviewFindings", 1)],
    produces: [contract("ReviewDecision", 1)],
  },
  {
    name: "compose-product-sub-issues",
    consumes: [
      contract("ProductCapabilityDecomposition", 1),
      contract("ProductIssuePrioritization", 1),
      optionalContract("ProductDependencyGraph", 1),
      optionalContract("ProductInterview", 1),
      optionalContract("LoadedIssue", 1),
    ],
    produces: [contract("ProductSubIssueDrafts", 1)],
  },
  {
    name: "conduct-product-interview",
    consumes: [contract("ProductAssessment", 1)],
    produces: [contract("ProductInterview", 1)],
  },
  {
    name: "create-commit",
    consumes: [
      contract("CommitProposal", 1),
      contract("ValidationResult", 1),
      contract("BranchWorkspace", 1),
    ],
    produces: [contract("CommitProposal", 1), contract("PreCommitGate", 2)],
  },
  {
    name: "create-draft-pr",
    consumes: [
      contract("PullRequestDraft", 1),
      contract("BranchWorkspace", 1),
      contract("ValidationResult", 1),
      contract("CommitProposal", 1),
      contract("BranchPush", 1),
      contract("PullRequestIssueLink", 1),
    ],
    produces: [contract("PullRequestDraft", 1), contract("PrePrCreateGate", 1)],
  },
  {
    name: "create-worktree",
    consumes: [],
    requiresOneOf: [[
      contract("ImplementationPlan", 1),
      contract("ReviewFixPlan", 1),
    ]],
    produces: [contract("BranchWorkspace", 1)],
  },
  {
    name: "create-github-issue",
    consumes: [contract("IssueDraft", 2)],
    produces: [contract("IssueDraft", 2)],
  },
  {
    name: "create-product-sub-issues",
    consumes: [
      contract("ProductPlannerRun", 1),
      contract("IssueDraft", 2),
    ],
    produces: [contract("ProductSubIssuePublication", 1)],
  },
  {
    name: "decompose-product-capabilities",
    consumes: [
      contract("LoadedIssue", 1),
      contract("ProductCapabilityMap", 1),
    ],
    produces: [contract("ProductCapabilityDecomposition", 1)],
  },
  {
    name: "deduplicate-review-findings",
    consumes: [contract("DetectedReviewFindings", 1)],
    produces: [contract("DeduplicatedReviewFindings", 1)],
  },
  {
    name: "define-acceptance-criteria",
    consumes: [],
    produces: [],
    nonSchemaOutput: true,
  },
  {
    name: "delete-merged-branch",
    consumes: [contract("PullRequestMerge", 1), contract("CleanupResult", 1)],
    produces: [contract("CleanupResult", 1)],
  },
  {
    name: "derive-branch-name",
    consumes: [
      contract("LoadedIssue", 1),
      contract("RepositoryContext", 1),
      contract("RepositoryConventions", 1),
    ],
    produces: [contract("BranchNameProposal", 1)],
  },
  {
    name: "detect-rebase-conflicts",
    consumes: [],
    produces: [contract("RebaseConflictAnalysis", 1)],
  },
  {
    name: "detect-repository-conventions",
    consumes: [contract("RepositoryContext", 1)],
    produces: [contract("RepositoryConventions", 1)],
  },
  {
    name: "detect-review-findings",
    consumes: [
      contract("LoadedPullRequest", 1),
      contract("PullRequestDiffAnalysis", 1),
      contract("LinkedIssue", 1),
      contract("PullRequestCheckInspection", 1),
      contract("LoadedPullRequestDiscussions", 1),
    ],
    produces: [contract("DetectedReviewFindings", 1)],
    identityInput: true,
  },
  {
    name: "detect-unrelated-changes",
    consumes: [
      contract("ChangeClassification", 1),
    ],
    requiresOneOf: [[
      contract("ImplementationPlan", 1),
      contract("ReviewFixPlan", 1),
    ]],
    produces: [contract("UnrelatedChangeDetection", 1)],
  },
  {
    name: "evaluate-implementation",
    consumes: [
      contract("LoadedIssue", 1),
      contract("RepositoryContext", 1),
      contract("IssueAnalysis", 1),
      contract("AffectedAreas", 1),
      contract("RepositoryConventions", 1),
    ],
    produces: [contract("ImplementationEvaluation", 1)],
  },
  {
    name: "fetch-target-branch",
    consumes: [contract("RepositoryContext", 1)],
    produces: [contract("TargetBranchFetch", 1)],
  },
  {
    name: "generate-project-hooks",
    consumes: [],
    produces: [],
    nonSchemaOutput: true,
  },
  {
    name: "identify-affected-areas",
    consumes: [contract("LoadedIssue", 1), contract("RepositoryContext", 1)],
    produces: [contract("AffectedAreas", 1)],
  },
  {
    name: "identify-product-capabilities",
    consumes: [
      contract("LoadedIssue", 1),
      contract("ProductInterview", 1),
      optionalContract("ProductAssessment", 1),
    ],
    produces: [contract("ProductCapabilityMap", 1)],
  },
  {
    name: "identify-resolved-feedback",
    consumes: [contract("CollectedReviewFeedback", 1)],
    produces: [contract("ResolvedReviewFeedback", 1)],
  },
  {
    name: "inspect-pr-checks",
    consumes: [contract("LoadedPullRequest", 1)],
    produces: [contract("PullRequestCheckInspection", 1)],
    identityInput: true,
  },
  {
    name: "inspect-repository",
    consumes: [contract("LoadedIssue", 1)],
    produces: [contract("RepositoryContext", 1)],
  },
  {
    name: "inspect-working-tree",
    consumes: [
      contract("BranchWorkspace", 1),
    ],
    requiresOneOf: [[
      contract("ImplementationPlan", 1),
      contract("ReviewFixPlan", 1),
    ]],
    produces: [contract("WorkingTreeInspection", 1)],
  },
  {
    name: "link-pr-to-issue",
    consumes: [contract("LoadedIssue", 1), contract("PullRequestDraft", 1)],
    produces: [contract("PullRequestIssueLink", 1)],
  },
  {
    ...identity("list-open-issues"),
    produces: [contract("OpenIssueInventory", 1)],
  },
  {
    ...identity("load-github-issue"),
    produces: [contract("LoadedIssue", 1)],
  },
  {
    name: "load-linked-issue",
    consumes: [contract("LoadedPullRequest", 1)],
    produces: [contract("LinkedIssue", 1)],
    identityInput: true,
  },
  {
    ...identity("load-pr-discussions"),
    produces: [contract("LoadedPullRequestDiscussions", 1)],
  },
  {
    ...identity("load-pull-request"),
    produces: [contract("LoadedPullRequest", 1)],
  },
  {
    name: "mark-pr-ready",
    consumes: [
      contract("PullRequestReady", 1),
      contract("LoadedPullRequest", 1),
      contract("LinkedIssue", 1),
    ],
    produces: [contract("PullRequestReady", 1), contract("PrePrReadyGate", 1)],
  },
  {
    name: "merge-pull-request",
    consumes: [contract("PullRequestMerge", 1), contract("MergeReadiness", 2)],
    produces: [contract("PullRequestMerge", 1), contract("PreMergeGate", 1)],
  },
  {
    name: "prioritize-product-issues",
    consumes: [
      contract("ProductDependencyGraph", 1),
      optionalContract("ProductCapabilityDecomposition", 1),
      optionalContract("ProductInterview", 1),
    ],
    produces: [contract("ProductIssuePrioritization", 1)],
  },
  {
    name: "propose-pr-reviewers",
    consumes: [
      contract("LoadedPullRequest", 1),
      optionalContract("LinkedIssue", 1),
      optionalContract("PullRequestDiffAnalysis", 1),
    ],
    produces: [contract("PullRequestReady", 1)],
  },
  {
    name: "push-branch",
    consumes: [contract("BranchWorkspace", 1)],
    produces: [contract("BranchPush", 1)],
  },
  {
    name: "rank-open-issues",
    consumes: [contract("OpenIssueInventory", 1)],
    produces: [contract("OpenIssueRanking", 1)],
  },
  {
    name: "rebase-branch",
    consumes: [
      contract("BranchRebase", 1),
      contract("BranchWorkspace", 1),
      contract("TargetBranchFetch", 1),
    ],
    produces: [contract("BranchRebase", 1), contract("PreRebaseGate", 1)],
  },
  {
    name: "reply-to-review-thread",
    consumes: [
      contract("ReviewThreadReply", 2),
      contract("FeedbackResolutionValidation", 1),
    ],
    produces: [contract("ReviewThreadReply", 2)],
  },
  {
    name: "resolve-context-capabilities",
    consumes: [contract("LoadedIssue", 1), contract("RepositoryContext", 1)],
    produces: [contract("ContextCapabilities", 1)],
  },
  {
    name: "resolve-feedback-capabilities",
    consumes: [contract("ClassifiedReviewFeedback", 1)],
    produces: [contract("FeedbackResolutionCapabilities", 1)],
  },
  {
    name: "resolve-review-thread",
    consumes: [
      contract("ReviewThreadResolution", 2),
      contract("FeedbackResolutionValidation", 1),
    ],
    produces: [contract("ReviewThreadResolution", 2)],
  },
  {
    name: "rewrite-github-issue",
    consumes: [
      contract("LoadedIssue", 1),
      optionalContract("ProductAssessment", 1),
      optionalContract("ProductInterview", 1),
      optionalContract("ProductCapabilityMap", 1),
      optionalContract("ProductCapabilityDecomposition", 1),
      optionalContract("IssueAtomicityAssessment", 1),
      optionalContract("ProductDependencyGraph", 1),
      optionalContract("ProductIssuePrioritization", 1),
    ],
    produces: [contract("IssueDraft", 2)],
  },
  {
    name: "rewrite-issue",
    consumes: [],
    produces: [],
    nonSchemaOutput: true,
  },
  {
    name: "structure-issue",
    consumes: [
      optionalContract("ProductAssessment", 1),
      optionalContract("ProductInterview", 1),
      optionalContract("ProductCapabilityMap", 1),
      optionalContract("ProductCapabilityDecomposition", 1),
      optionalContract("IssueAtomicityAssessment", 1),
      optionalContract("ProductDependencyGraph", 1),
      optionalContract("ProductIssuePrioritization", 1),
    ],
    produces: [contract("IssueAssessment", 1)],
  },
  {
    name: "submit-pr-review",
    consumes: [
      contract("ReviewDecision", 1),
      contract("ClassifiedReviewFindings", 1),
      contract("DeduplicatedReviewFindings", 1),
    ],
    produces: [contract("ReviewDecision", 1), contract("PreReviewSubmitGate", 1)],
  },
  {
    name: "summarize-feedback-resolution",
    consumes: [contract("FeedbackResolutionValidation", 1)],
    produces: [contract("FeedbackResolutionSummary", 1)],
  },
  {
    name: "update-github-issue",
    consumes: [contract("IssueUpdate", 1)],
    produces: [contract("IssueUpdate", 1)],
  },
  {
    name: "validate-feedback-resolution",
    consumes: [
      contract("ClassifiedReviewFeedback", 1),
      contract("FeedbackResolutionPlan", 1),
    ],
    produces: [contract("FeedbackResolutionValidation", 1)],
  },
  {
    name: "validate-implementation-result",
    consumes: [
      contract("WorkingTreeInspection", 1),
      contract("ChangeClassification", 1),
    ],
    requiresOneOf: [[
      contract("ImplementationPlan", 1),
      contract("ReviewFixPlan", 1),
    ]],
    produces: [contract("ValidationResult", 1)],
  },
  {
    name: "validate-rebased-branch",
    consumes: [
      contract("ImplementationPlan", 1),
      contract("WorkingTreeInspection", 1),
      contract("ChangeClassification", 1),
      contract("ValidationResult", 1),
    ],
    produces: [contract("ValidationResult", 1)],
  },
  {
    name: "verify-linked-issue-closure",
    consumes: [contract("PullRequestMerge", 1), contract("LinkedIssue", 1)],
    produces: [contract("LinkedIssueClosureVerification", 1)],
    identityInput: true,
  },
  {
    name: "verify-worktree",
    consumes: [contract("BranchWorkspace", 1)],
    produces: [contract("BranchWorkspace", 1)],
  },
];

export const agentHandoffs: AgentHandoff[] = [
  {
    name: "issue-agent",
    consumes: [contract("LoadedIssue", 1)],
    produces: [contract("IssueDraft", 2)],
    skills: [
      "structure-issue",
      "define-acceptance-criteria",
      "assess-issue-quality",
      "load-github-issue",
      "analyze-product-issue",
      "conduct-product-interview",
      "identify-product-capabilities",
      "decompose-product-capabilities",
      "assess-issue-atomicity",
      "build-product-dependency-graph",
      "prioritize-product-issues",
      "rewrite-github-issue",
      "compare-issue-revision",
      "create-github-issue",
    ],
  },
  {
    name: "preparation-agent",
    consumes: [contract("LoadedIssue", 1)],
    produces: [contract("ImplementationPlan", 1), contract("BranchWorkspace", 1)],
    skills: [
      "load-github-issue",
      "analyze-issue",
      "inspect-repository",
      "detect-repository-conventions",
      "identify-affected-areas",
      "evaluate-implementation",
      "resolve-context-capabilities",
      "derive-branch-name",
      "fetch-target-branch",
      "build-implementation-plan",
      "create-worktree",
      "verify-worktree",
    ],
  },
  {
    name: "delivery-agent",
    consumes: [
      contract("ImplementationPlan", 1),
      contract("BranchWorkspace", 1),
      contract("LoadedIssue", 1),
    ],
    produces: [
      contract("ValidationResult", 1),
      contract("CommitProposal", 1),
      contract("BranchPush", 1),
      contract("PullRequestDraft", 1),
      contract("PullRequestIssueLink", 1),
    ],
    skills: [
      "inspect-working-tree",
      "classify-changes",
      "detect-unrelated-changes",
      "validate-implementation-result",
      "compose-commit-message",
      "create-commit",
      "push-branch",
      "compose-pr-description",
      "link-pr-to-issue",
      "create-draft-pr",
    ],
  },
  {
    name: "review-agent",
    consumes: [],
    produces: [
      contract("LoadedPullRequest", 1),
      contract("LinkedIssue", 1),
      contract("LoadedPullRequestDiscussions", 1),
      contract("PullRequestCheckInspection", 1),
      contract("PullRequestDiffAnalysis", 1),
      contract("DetectedReviewFindings", 1),
      contract("DeduplicatedReviewFindings", 1),
      contract("ClassifiedReviewFindings", 1),
      contract("ReviewDecision", 1),
    ],
    skills: [
      "load-pull-request",
      "load-linked-issue",
      "load-pr-discussions",
      "inspect-pr-checks",
      "analyze-pr-diff",
      "detect-review-findings",
      "deduplicate-review-findings",
      "classify-review-findings",
      "compose-review",
      "submit-pr-review",
    ],
  },
  {
    name: "feedback-agent",
    consumes: [
      contract("LoadedPullRequest", 1),
      contract("ClassifiedReviewFeedback", 1),
    ],
    produces: [
      contract("FeedbackResolutionPlan", 1),
      contract("FeedbackResolutionValidation", 1),
      contract("FeedbackResolutionSummary", 1),
      contract("ReviewThreadReply", 2),
      contract("ReviewThreadResolution", 2),
    ],
    skills: [
      "load-pull-request",
      "collect-review-feedback",
      "identify-resolved-feedback",
      "classify-review-feedback",
      "resolve-feedback-capabilities",
      "build-feedback-resolution-plan",
      "validate-feedback-resolution",
      "summarize-feedback-resolution",
      "reply-to-review-thread",
      "resolve-review-thread",
    ],
  },
  {
    name: "integration-agent",
    consumes: [
      contract("LoadedPullRequest", 1),
      contract("MergeReadiness", 2),
    ],
    produces: [
      contract("PullRequestIntegration", 1),
      contract("ValidationResult", 1),
      contract("BranchRebase", 1),
      contract("PullRequestMerge", 1),
      contract("LinkedIssueClosureVerification", 1),
      contract("LinkedIssueClosure", 2),
      contract("CleanupResult", 1),
    ],
    skills: [
      "load-pull-request",
      "assess-merge-readiness",
      "check-linked-issue-status",
      "fetch-target-branch",
      "detect-rebase-conflicts",
      "rebase-branch",
      "validate-rebased-branch",
      "push-branch",
      "merge-pull-request",
      "verify-linked-issue-closure",
      "close-linked-issue",
      "delete-merged-branch",
      "cleanup-worktree",
    ],
  },
  {
    name: "host-hooks-agent",
    consumes: [],
    produces: [],
    skills: ["generate-project-hooks"],
  },
  {
    name: "lifecycle-agent",
    consumes: [],
    produces: [contract("LifecycleRun", 1)],
    skills: [],
    startsAgents: ["issue-agent", "preparation-agent", "delivery-agent"],
  },
  {
    name: "review-fix-agent",
    consumes: [],
    produces: [contract("ReviewFixRun", 1)],
    skills: [
      "load-pull-request",
      "load-linked-issue",
      "load-pr-discussions",
      "inspect-pr-checks",
      "analyze-pr-diff",
      "detect-review-findings",
      "deduplicate-review-findings",
      "classify-review-findings",
      "collect-review-feedback",
      "identify-resolved-feedback",
      "classify-review-feedback",
      "build-review-fix-plan",
      "resolve-feedback-capabilities",
      "create-worktree",
      "verify-worktree",
      "inspect-working-tree",
      "classify-changes",
      "detect-unrelated-changes",
      "validate-implementation-result",
      "compose-commit-message",
      "create-commit",
      "push-branch",
    ],
  },
  {
    name: "pr-ready-agent",
    consumes: [],
    produces: [
      contract("LoadedPullRequest", 1),
      contract("LinkedIssue", 1),
      contract("PullRequestCheckInspection", 1),
      contract("PullRequestReady", 1),
      contract("PrePrReadyGate", 1),
    ],
    skills: [
      "load-pull-request",
      "load-linked-issue",
      "inspect-pr-checks",
      "propose-pr-reviewers",
      "mark-pr-ready",
    ],
  },
  {
    name: "product-planner-agent",
    consumes: [contract("LoadedIssue", 1)],
    produces: [contract("ProductPlannerRun", 1)],
    skills: [
      "load-github-issue",
      "analyze-product-issue",
      "conduct-product-interview",
      "identify-product-capabilities",
      "decompose-product-capabilities",
      "assess-issue-atomicity",
      "build-product-dependency-graph",
      "prioritize-product-issues",
      "structure-issue",
      "define-acceptance-criteria",
      "assess-issue-quality",
      "create-product-sub-issues",
      "create-github-issue",
    ],
  },
  {
    name: "issue-reprioritize-agent",
    consumes: [],
    produces: [
      contract("OpenIssueInventory", 1),
      contract("OpenIssueRanking", 1),
      contract("IssueReprioritization", 1),
    ],
    skills: [
      "list-open-issues",
      "rank-open-issues",
      "apply-issue-priority-titles",
      "update-github-issue",
    ],
  },
  {
    name: "ci-fix-agent",
    consumes: [],
    produces: [contract("CiFixRun", 1)],
    skills: [
      "load-pull-request",
      "inspect-pr-checks",
      "check-required-status-checks",
      "wait-required-checks",
      "rerun-required-checks",
      "build-ci-fix-plan",
      "resolve-feedback-capabilities",
      "create-worktree",
      "verify-worktree",
      "inspect-working-tree",
      "classify-changes",
      "detect-unrelated-changes",
      "validate-implementation-result",
      "compose-commit-message",
      "create-commit",
      "push-branch",
    ],
  },
  {
    name: "issue-close-agent",
    consumes: [],
    produces: [contract("LoadedIssue", 1), contract("IssueClosure", 1)],
    skills: ["load-github-issue", "close-github-issue"],
  },
];

export const commandHandoffs: CommandHandoff[] = [
  {
    name: "create-issue",
    agent: "issue-agent",
    mode: "create",
    contracts: [],
  },
  {
    name: "refine-issue",
    agent: "issue-agent",
    mode: "refine",
    contracts: [],
  },
  {
    name: "prepare-issue",
    agent: "preparation-agent",
    contracts: [contract("ImplementationPlan", 1), contract("BranchWorkspace", 1)],
  },
  {
    name: "publish-draft-pr",
    agent: "delivery-agent",
    contracts: [
      contract("ImplementationPlan", 1),
      contract("BranchWorkspace", 1),
      contract("LoadedIssue", 1),
      contract("WorkingTreeInspection", 1),
      contract("ValidationResult", 1),
      contract("CommitProposal", 1),
    ],
  },
  {
    name: "review-pr",
    agent: "review-agent",
    contracts: [contract("ReviewDecision", 1)],
  },
  {
    name: "address-pr-feedback",
    agent: "feedback-agent",
    contracts: [],
  },
  {
    name: "integrate-pr",
    agent: "integration-agent",
    contracts: [contract("PullRequestIntegration", 1), contract("MergeReadiness", 2)],
  },
  {
    name: "generate-project-hooks",
    agent: "host-hooks-agent",
    contracts: [],
  },
  {
    name: "implement-auto-issue",
    agent: "lifecycle-agent",
    contracts: [contract("LifecycleRun", 1)],
  },
  {
    name: "refine-auto-issue",
    agent: "lifecycle-agent",
    contracts: [contract("LifecycleRun", 1)],
  },
  {
    name: "auto-review-fix-pr",
    agent: "review-fix-agent",
    contracts: [contract("ReviewFixRun", 1)],
  },
  {
    name: "ready-pr",
    agent: "pr-ready-agent",
    contracts: [contract("PullRequestReady", 1)],
  },
  {
    name: "plan-product",
    agent: "product-planner-agent",
    contracts: [contract("ProductPlannerRun", 1)],
  },
  {
    name: "reprioritize-issues",
    agent: "issue-reprioritize-agent",
    contracts: [contract("IssueReprioritization", 1)],
  },
  {
    name: "auto-ci-fix-pr",
    agent: "ci-fix-agent",
    contracts: [contract("CiFixRun", 1)],
  },
  {
    name: "close-issue",
    agent: "issue-close-agent",
    contracts: [contract("IssueClosure", 1)],
  },
];

export const nestedContracts = new Set(["ReviewFinding", "RepositoryPolicy"]);
export const hookEmittedContracts = new Set(["PostMergeStatus"]);

export const allReferencedContracts = (): ContractRef[] => {
  const refs = [
    ...skillHandoffs.flatMap((handoff) => [
      ...handoff.consumes,
      ...(handoff.requiresOneOf?.flat() ?? []),
      ...handoff.produces,
    ]),
    ...agentHandoffs.flatMap((handoff) => [
      ...handoff.consumes,
      ...handoff.produces,
    ]),
    ...commandHandoffs.flatMap((handoff) => handoff.contracts),
  ];
  return [...new Map(refs.map((ref) => [`${ref.name}:${ref.version}`, ref])).values()];
};
