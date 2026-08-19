import {
  agentHandoffs,
  commandHandoffs,
} from "../../lib/handoff-graph.js";
import { ScenarioAction } from "./scenario-types.js";

export interface WorkflowStep {
  operation: string;
  kind: "read" | "write";
  handoff?: string;
}

export interface WorkflowGraph {
  command: string;
  agent: string;
  mode?: string;
  steps: WorkflowStep[];
  forbiddenOperations: string[];
}

const read = (operation: string, handoff?: string): WorkflowStep => ({
  operation,
  kind: "read",
  handoff,
});

const write = (operation: string, handoff?: string): WorkflowStep => ({
  operation,
  kind: "write",
  handoff,
});

export const workflowGraphs: Record<string, WorkflowGraph> = {
  "create-issue": {
    command: "create-issue",
    agent: "issue-agent",
    mode: "create",
    steps: [
      read("verify-repository"),
      read("issue-agent:create", "IssueDraft"),
      write("create-github-issue", "IssueDraft"),
    ],
    forbiddenOperations: [
      "create-worktree",
      "create-commit",
      "submit-pr-review",
      "merge-pull-request",
      "mark-pr-ready",
    ],
  },
  "refine-issue": {
    command: "refine-issue",
    agent: "issue-agent",
    mode: "refine",
    steps: [
      read("verify-repository"),
      read("load-issue", "LoadedIssue"),
      read("issue-agent:refine", "IssueDraft"),
      write("create-github-issue", "IssueDraft"),
    ],
    forbiddenOperations: [
      "create-worktree",
      "create-commit",
      "submit-pr-review",
      "merge-pull-request",
      "mark-pr-ready",
    ],
  },
  "prepare-issue": {
    command: "prepare-issue",
    agent: "preparation-agent",
    steps: [
      read("verify-repository"),
      read("load-issue", "LoadedIssue"),
      read("build-implementation-plan", "ImplementationPlan"),
      write("create-worktree", "BranchWorkspace"),
      read("verify-worktree", "BranchWorkspace"),
    ],
    forbiddenOperations: [
      "create-github-issue",
      "create-commit",
      "push-branch",
      "merge-pull-request",
      "mark-pr-ready",
    ],
  },
  "publish-draft-pr": {
    command: "publish-draft-pr",
    agent: "delivery-agent",
    steps: [
      read("verify-repository"),
      read("inspect-working-tree", "WorkingTreeInspection"),
      read("classify-changes", "ChangeClassification"),
      read("validate-implementation-result", "ValidationResult"),
      write("create-commit", "CommitProposal"),
      write("push-branch", "BranchPush"),
      read("link-pr-to-issue", "PullRequestIssueLink"),
      write("create-draft-pr", "PullRequestDraft"),
    ],
    forbiddenOperations: [
      "submit-pr-review",
      "reply-to-review-thread",
      "rebase-branch",
      "merge-pull-request",
      "delete-merged-branch",
      "cleanup-worktree",
      "mark-pr-ready",
    ],
  },
  "review-pr": {
    command: "review-pr",
    agent: "review-agent",
    steps: [
      read("verify-repository"),
      read("load-pull-request", "LoadedPullRequest"),
      read("analyze-pr-diff", "PullRequestDiffAnalysis"),
      read("classify-review-findings", "ClassifiedReviewFindings"),
      read("compose-review", "ReviewDecision"),
      write("submit-pr-review", "ReviewDecision"),
    ],
    forbiddenOperations: [
      "create-commit",
      "push-branch",
      "reply-to-review-thread",
      "rebase-branch",
      "merge-pull-request",
      "delete-merged-branch",
      "cleanup-worktree",
      "mark-pr-ready",
    ],
  },
  "address-pr-feedback": {
    command: "address-pr-feedback",
    agent: "feedback-agent",
    steps: [
      read("verify-repository"),
      read("collect-review-feedback", "CollectedReviewFeedback"),
      read("identify-resolved-feedback", "ResolvedReviewFeedback"),
      read("classify-review-feedback", "ClassifiedReviewFeedback"),
      read("validate-feedback-resolution", "FeedbackResolutionValidation"),
      write("reply-to-review-thread", "ReviewThreadReply"),
      write("resolve-review-thread", "ReviewThreadResolution"),
    ],
    forbiddenOperations: [
      "submit-pr-review",
      "rebase-branch",
      "merge-pull-request",
      "delete-merged-branch",
      "cleanup-worktree",
      "mark-pr-ready",
    ],
  },
  "implement-auto-issue": {
    command: "implement-auto-issue",
    agent: "lifecycle-agent",
    steps: [
      read("verify-repository"),
      read("issue-agent:create", "IssueDraft"),
      write("create-github-issue", "IssueDraft"),
      read("load-issue", "LoadedIssue"),
      read("issue-agent:refine", "IssueDraft"),
      read("build-implementation-plan", "ImplementationPlan"),
      write("create-worktree", "BranchWorkspace"),
      read("verify-worktree", "BranchWorkspace"),
      read("handoff-external-implementation", "ContextCapabilities"),
      read("inspect-working-tree", "WorkingTreeInspection"),
      read("classify-changes", "ChangeClassification"),
      read("validate-implementation-result", "ValidationResult"),
      write("create-commit", "CommitProposal"),
      write("push-branch", "BranchPush"),
      read("link-pr-to-issue", "PullRequestIssueLink"),
      write("create-draft-pr", "PullRequestDraft"),
    ],
    forbiddenOperations: [
      "submit-pr-review",
      "reply-to-review-thread",
      "resolve-review-thread",
      "rebase-branch",
      "merge-pull-request",
      "delete-merged-branch",
      "cleanup-worktree",
      "mark-pr-ready",
      "apply-issue-priority-titles",
    ],
  },
  "refine-auto-issue": {
    command: "refine-auto-issue",
    agent: "lifecycle-agent",
    steps: [
      read("verify-repository"),
      read("load-issue", "LoadedIssue"),
      read("issue-agent:refine", "IssueDraft"),
      write("create-github-issue", "IssueDraft"),
      read("build-implementation-plan", "ImplementationPlan"),
      write("create-worktree", "BranchWorkspace"),
      read("verify-worktree", "BranchWorkspace"),
      read("handoff-external-implementation", "ContextCapabilities"),
      read("inspect-working-tree", "WorkingTreeInspection"),
      read("classify-changes", "ChangeClassification"),
      read("validate-implementation-result", "ValidationResult"),
      write("create-commit", "CommitProposal"),
      write("push-branch", "BranchPush"),
      read("link-pr-to-issue", "PullRequestIssueLink"),
      write("create-draft-pr", "PullRequestDraft"),
    ],
    forbiddenOperations: [
      "issue-agent:create",
      "submit-pr-review",
      "reply-to-review-thread",
      "resolve-review-thread",
      "rebase-branch",
      "merge-pull-request",
      "delete-merged-branch",
      "cleanup-worktree",
      "mark-pr-ready",
      "apply-issue-priority-titles",
    ],
  },
  "auto-review-fix-pr": {
    command: "auto-review-fix-pr",
    agent: "review-fix-agent",
    steps: [
      read("verify-repository"),
      read("load-pull-request", "LoadedPullRequest"),
      read("load-linked-issue", "LinkedIssue"),
      read("load-pr-discussions", "LoadedPullRequestDiscussions"),
      read("inspect-pr-checks", "PullRequestCheckInspection"),
      read("analyze-pr-diff", "PullRequestDiffAnalysis"),
      read("detect-review-findings", "DetectedReviewFindings"),
      read("deduplicate-review-findings", "DeduplicatedReviewFindings"),
      read("classify-review-findings", "ClassifiedReviewFindings"),
      read("collect-review-feedback", "CollectedReviewFeedback"),
      read("identify-resolved-feedback", "ResolvedReviewFeedback"),
      read("classify-review-feedback", "ClassifiedReviewFeedback"),
      read("build-review-fix-plan", "ReviewFixPlan"),
      write("create-worktree", "BranchWorkspace"),
      read("verify-worktree", "BranchWorkspace"),
      read("handoff-external-implementation", "ContextCapabilities"),
      read("inspect-working-tree", "WorkingTreeInspection"),
      read("classify-changes", "ChangeClassification"),
      read("detect-unrelated-changes", "UnrelatedChangeDetection"),
      read("validate-implementation-result", "ValidationResult"),
      read("compose-commit-message", "CommitProposal"),
      write("create-commit", "CommitProposal"),
      write("push-branch", "BranchPush"),
    ],
    forbiddenOperations: [
      "submit-pr-review",
      "reply-to-review-thread",
      "resolve-review-thread",
      "create-draft-pr",
      "rebase-branch",
      "merge-pull-request",
      "delete-merged-branch",
      "cleanup-worktree",
      "mark-pr-ready",
    ],
  },
  "auto-ci-fix-pr": {
    command: "auto-ci-fix-pr",
    agent: "ci-fix-agent",
    steps: [
      read("verify-repository"),
      read("load-pull-request", "LoadedPullRequest"),
      read("inspect-pr-checks", "PullRequestCheckInspection"),
      read("check-required-status-checks", "PullRequestCheckInspection"),
      read("wait-required-checks", "RequiredCheckWait"),
      write("rerun-required-checks", "RequiredCheckRerun"),
      read("wait-required-checks", "RequiredCheckWait"),
      read("build-ci-fix-plan", "CiFixPlan"),
      write("create-worktree", "BranchWorkspace"),
      read("verify-worktree", "BranchWorkspace"),
      read("handoff-external-implementation", "ContextCapabilities"),
      read("inspect-working-tree", "WorkingTreeInspection"),
      read("classify-changes", "ChangeClassification"),
      read("detect-unrelated-changes", "UnrelatedChangeDetection"),
      read("validate-implementation-result", "ValidationResult"),
      read("compose-commit-message", "CommitProposal"),
      write("create-commit", "CommitProposal"),
      write("push-branch", "BranchPush"),
      read("wait-required-checks", "RequiredCheckWait"),
    ],
    forbiddenOperations: [
      "submit-pr-review",
      "reply-to-review-thread",
      "resolve-review-thread",
      "create-draft-pr",
      "rebase-branch",
      "merge-pull-request",
      "delete-merged-branch",
      "cleanup-worktree",
      "mark-pr-ready",
      "apply-issue-priority-titles",
    ],
  },
  "integrate-pr": {
    command: "integrate-pr",
    agent: "integration-agent",
    steps: [
      read("verify-repository"),
      read("assess-merge-readiness", "MergeReadiness"),
      write("fetch-target-branch", "TargetBranchFetch"),
      read("detect-rebase-conflicts", "RebaseConflictAnalysis"),
      write("rebase-branch", "BranchRebase"),
      read("validate-rebased-branch", "ValidationResult"),
      write("push-branch", "BranchPush"),
      read("assess-final-merge-readiness", "MergeReadiness"),
      write("merge-pull-request", "PullRequestMerge"),
      read("verify-linked-issue-closure", "LinkedIssueClosureVerification"),
      write("close-linked-issue", "LinkedIssueClosure"),
      write("delete-merged-branch"),
      write("cleanup-worktree"),
    ],
    forbiddenOperations: [
      "submit-pr-review",
      "create-commit",
      "create-draft-pr",
      "resolve-review-thread",
      "mark-pr-ready",
    ],
  },
  "ready-pr": {
    command: "ready-pr",
    agent: "pr-ready-agent",
    steps: [
      read("verify-repository"),
      read("load-pull-request", "LoadedPullRequest"),
      read("load-linked-issue", "LinkedIssue"),
      read("inspect-pr-checks"),
      read("propose-pr-reviewers", "PullRequestReady"),
      write("mark-pr-ready", "PullRequestReady"),
    ],
    forbiddenOperations: [
      "submit-pr-review",
      "create-commit",
      "create-draft-pr",
      "reply-to-review-thread",
      "resolve-review-thread",
      "rebase-branch",
      "merge-pull-request",
      "delete-merged-branch",
      "cleanup-worktree",
    ],
  },
  "plan-product": {
    command: "plan-product",
    agent: "product-planner-agent",
    steps: [
      read("verify-repository"),
      read("load-issue", "LoadedIssue"),
      read("analyze-product-issue", "ProductAssessment"),
      read("conduct-product-interview", "ProductInterview"),
      read("identify-product-capabilities", "ProductCapabilityMap"),
      read("decompose-product-capabilities", "ProductCapabilityDecomposition"),
      read("assess-issue-atomicity", "IssueAtomicityAssessment"),
      read("build-product-dependency-graph", "ProductDependencyGraph"),
      read("prioritize-product-issues", "ProductIssuePrioritization"),
      read("product-planner-agent", "ProductPlannerRun"),
      write("create-product-sub-issues", "ProductSubIssuePublication"),
    ],
    forbiddenOperations: [
      "build-implementation-plan",
      "create-worktree",
      "create-commit",
      "create-draft-pr",
      "create-github-issue",
      "submit-pr-review",
      "rebase-branch",
      "merge-pull-request",
      "mark-pr-ready",
    ],
  },
  "reprioritize-issues": {
    command: "reprioritize-issues",
    agent: "issue-reprioritize-agent",
    steps: [
      read("verify-repository"),
      read("list-open-issues", "OpenIssueInventory"),
      read("rank-open-issues", "OpenIssueRanking"),
      write("apply-issue-priority-titles", "IssueReprioritization"),
    ],
    forbiddenOperations: [
      "create-github-issue",
      "create-worktree",
      "create-commit",
      "create-draft-pr",
      "submit-pr-review",
      "rebase-branch",
      "merge-pull-request",
      "mark-pr-ready",
    ],
  },
  "close-issue": {
    command: "close-issue",
    agent: "issue-close-agent",
    steps: [
      read("verify-repository"),
      read("load-github-issue", "LoadedIssue"),
      write("close-github-issue", "IssueClosure"),
    ],
    forbiddenOperations: [
      "create-github-issue",
      "create-worktree",
      "create-commit",
      "push-branch",
      "create-draft-pr",
      "submit-pr-review",
      "reply-to-review-thread",
      "resolve-review-thread",
      "rebase-branch",
      "merge-pull-request",
      "delete-merged-branch",
      "cleanup-worktree",
      "mark-pr-ready",
      "apply-issue-priority-titles",
    ],
  },
};

export const workflowGraphFor = (command: string): WorkflowGraph => {
  const graph = workflowGraphs[command];
  if (!graph) throw new Error(`No workflow graph registered for ${command}`);
  return graph;
};

export const graphOperations = (graph: WorkflowGraph): Set<string> =>
  new Set(graph.steps.map((step) => step.operation));

export const graphWrites = (graph: WorkflowGraph): Set<string> =>
  new Set(
    graph.steps
      .filter((step) => step.kind === "write")
      .map((step) => step.operation),
  );

export const assertWorkflowRegistry = (): void => {
  const commandsByName = new Map(
    commandHandoffs.map((handoff) => [handoff.name, handoff]),
  );
  const agentsByName = new Map(
    agentHandoffs.map((handoff) => [handoff.name, handoff]),
  );

  for (const graph of Object.values(workflowGraphs)) {
    const command = commandsByName.get(graph.command);
    if (!command) throw new Error(`Graph has unknown command ${graph.command}`);
    if (command.agent !== graph.agent || command.mode !== graph.mode) {
      throw new Error(
        `Graph identity mismatch for ${graph.command}: expected ${command.agent}/${command.mode ?? "default"}`,
      );
    }
    if (!agentsByName.has(graph.agent)) {
      throw new Error(`Graph has unknown Agent ${graph.agent}`);
    }
    const operations = graphOperations(graph);
    for (const forbidden of graph.forbiddenOperations) {
      if (operations.has(forbidden)) {
        throw new Error(
          `${graph.command} both allows and forbids ${forbidden}`,
        );
      }
    }
  }
};

export const assertActionBelongsToGraph = (
  graph: WorkflowGraph,
  action: ScenarioAction,
): void => {
  const step = graph.steps.find(
    (candidate) => candidate.operation === action.operation,
  );
  if (!step) {
    throw new Error(
      `${graph.command} action ${action.operation} is outside its workflow graph`,
    );
  }
  if (graph.forbiddenOperations.includes(action.operation)) {
    throw new Error(
      `${graph.command} action ${action.operation} is explicitly forbidden`,
    );
  }
  const expectedKind =
    action.effect === "read" ? "read" : "write";
  if (step.kind !== expectedKind) {
    throw new Error(
      `${graph.command} action ${action.operation} has effect ${action.effect}, expected ${step.kind}`,
    );
  }
};
