import {
  canonicalUnitIds,
  productSubIssueDigest,
} from "../../lib/product-sub-issue-digest.js";
import { ScenarioAction, ScenarioDefinition } from "./scenario-types.js";

export interface GateContext {
  scenario: ScenarioDefinition;
  handoffs: Map<string, unknown>;
  successfulWrites: Set<string>;
  completedOperations: Set<string>;
}

export interface GateDecision {
  allowed: boolean;
  code: string;
  reason: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordAt = (
  value: unknown,
  ...keys: string[]
): Record<string, unknown> | null => {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return isRecord(current) ? current : null;
};

const valueAt = (value: unknown, ...keys: string[]): unknown => {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
};

const stringAt = (value: unknown, ...keys: string[]): string | null => {
  const result = valueAt(value, ...keys);
  return typeof result === "string" ? result : null;
};

const booleanAt = (value: unknown, ...keys: string[]): boolean | null => {
  const result = valueAt(value, ...keys);
  return typeof result === "boolean" ? result : null;
};

const numberAt = (value: unknown, ...keys: string[]): number | null => {
  const result = valueAt(value, ...keys);
  return typeof result === "number" ? result : null;
};

const arrayAt = (value: unknown, ...keys: string[]): unknown[] => {
  const result = valueAt(value, ...keys);
  return Array.isArray(result) ? result : [];
};

const sortedStringList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [])
    .filter((entry): entry is string => typeof entry === "string")
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

const exactStringSet = (left: unknown, right: unknown): boolean => {
  const a = sortedStringList(left);
  const b = sortedStringList(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

const decision = (code: string, reason: string): GateDecision => ({
  allowed: false,
  code,
  reason,
});

const allowed = (): GateDecision => ({
  allowed: true,
  code: "allowed",
  reason: "All applicable safety and approval gates are satisfied.",
});

const handoff = (
  context: GateContext,
  name: string,
): Record<string, unknown> | null => {
  const payload = context.handoffs.get(name);
  return isRecord(payload) ? payload : null;
};

const requireHandoff = (
  context: GateContext,
  name: string,
): GateDecision | null =>
  handoff(context, name)
    ? null
    : decision(
        "missing_handoff",
        `The ${name} handoff is required before this operation.`,
      );

const authorization = (
  context: GateContext,
  key: string,
  hard = false,
): GateDecision | null => {
  const authorizations = context.scenario.authorizations;
  if (hard) {
    return authorizations[key] === true
      ? null
      : decision(
          "approval_required",
          `The exact independent ${key} approval is missing.`,
        );
  }
  if (authorizations.routine !== true || authorizations[key] !== true) {
    return decision(
      "routine_authorization_required",
      `Task-scoped routine authorization for ${key} is missing.`,
    );
  }
  return null;
};

const targetGate = (
  context: GateContext,
  needsIssue: boolean,
  needsPullRequest: boolean,
): GateDecision | null => {
  const target = context.scenario.target;
  if (target.exact !== true) {
    return decision(
      "exact_target_required",
      "The command target is missing exact identity confirmation.",
    );
  }
  if (!target.repository) {
    return decision(
      "missing_repository",
      "Exactly one repository must be verified before a write.",
    );
  }
  if (needsIssue && (!target.issue_number || target.issue_number < 1)) {
    return decision(
      "missing_issue",
      "Exactly one positive issue number is required for this operation.",
    );
  }
  if (
    needsPullRequest &&
    (!target.pull_request_number || target.pull_request_number < 1)
  ) {
    return decision(
      "missing_pull_request",
      "Exactly one positive pull-request number is required for this operation.",
    );
  }
  return null;
};

const collectRepositoryValues = (
  value: unknown,
  result: string[] = [],
): string[] => {
  if (Array.isArray(value)) {
    for (const entry of value) collectRepositoryValues(entry, result);
    return result;
  }
  if (!isRecord(value)) return result;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "repository" && typeof entry === "string") {
      result.push(entry);
    }
    collectRepositoryValues(entry, result);
  }
  return result;
};

const repositoryMatches = (
  context: GateContext,
  payload: Record<string, unknown>,
): GateDecision | null => {
  const repository = context.scenario.target.repository;
  if (!repository) return decision("missing_repository", "Repository is missing.");
  const values = collectRepositoryValues(payload);
  if (values.some((value) => value !== repository)) {
    return decision(
      "repository_mismatch",
      "A handoff identifies a repository different from the verified target.",
    );
  }
  return null;
};

const issueMatches = (
  context: GateContext,
  payload: Record<string, unknown>,
  allowNull = false,
): GateDecision | null => {
  const issue = recordAt(payload, "issue");
  const issueNumber = numberAt(payload, "issue", "number");
  const targetNumber = context.scenario.target.issue_number;
  if (!targetNumber) {
    return allowNull
      ? null
      : decision("missing_issue", "The verified issue target is missing.");
  }
  if (issue && issueNumber === null && !allowNull) {
    return decision(
      "issue_identity_missing",
      "The handoff does not identify the verified issue.",
    );
  }
  if (issueNumber !== null && issueNumber !== targetNumber) {
    return decision(
      "issue_mismatch",
      "A handoff identifies a different issue than the command target.",
    );
  }
  return null;
};

const pullRequestMatches = (
  context: GateContext,
  payload: Record<string, unknown>,
): GateDecision | null => {
  const target = context.scenario.target;
  if (!target.pull_request_number) {
    return decision(
      "missing_pull_request",
      "The verified pull-request target is missing.",
    );
  }
  const pullRequest = recordAt(payload, "pull_request");
  const numbers = [
    numberAt(payload, "pull_request_number"),
    numberAt(payload, "pull_request", "number"),
  ].filter((value): value is number => value !== null);
  if (numbers.some((value) => value !== target.pull_request_number)) {
    return decision(
      "pull_request_mismatch",
      "A handoff identifies a different pull request than the command target.",
    );
  }
  if (pullRequest && numbers.length === 0) {
    return decision(
      "pull_request_identity_missing",
      "The handoff does not identify the verified pull request.",
    );
  }
  const headValues = [
    stringAt(payload, "head_sha"),
    stringAt(payload, "expected_head_sha"),
    stringAt(payload, "current_head_sha"),
    stringAt(payload, "pull_request", "head_sha"),
  ].filter((value): value is string => value !== null);
  if (
    target.head_sha &&
    headValues.some((value) => value !== target.head_sha)
  ) {
    return decision(
      "head_mismatch",
      "A handoff is not bound to the current pull-request head.",
    );
  }
  return null;
};

const requireRepositoryAndIssue = (
  context: GateContext,
  payload: Record<string, unknown>,
  allowNullIssue = false,
): GateDecision | null =>
  repositoryMatches(context, payload) ??
  issueMatches(context, payload, allowNullIssue);

const requireRepositoryAndPullRequest = (
  context: GateContext,
  payload: Record<string, unknown>,
): GateDecision | null =>
  repositoryMatches(context, payload) ?? pullRequestMatches(context, payload);

const statusIs = (
  context: GateContext,
  name: string,
  expected: string,
): GateDecision | null => {
  const payload = handoff(context, name);
  if (!payload) return requireHandoff(context, name);
  return payload.status === expected
    ? null
    : decision(
        "invalid_handoff_status",
        `${name} must have status ${expected} before this operation.`,
      );
};

const validationGate = (
  context: GateContext,
  draftPreparation = false,
): GateDecision | null => {
  const validation = handoff(context, "ValidationResult");
  if (!validation) return requireHandoff(context, "ValidationResult");
  if (validation.status !== "passed") {
    return decision(
      "validation_not_passed",
      "A failed, partial, or blocked ValidationResult cannot authorize delivery.",
    );
  }
  if (!Array.isArray(validation.evidence_requirements)) {
    return decision(
      "evidence_requirements_required",
      "ValidationResult must contain the explicit evidence requirement list.",
    );
  }
  for (const requirement of validation.evidence_requirements) {
    if (!isRecord(requirement)) {
      return decision(
        "evidence_requirement_malformed",
        "ValidationResult contains a malformed explicit evidence requirement.",
      );
    }
    if (requirement.status !== "satisfied") {
      const source = recordAt(requirement, "source");
      const location =
        typeof requirement.location === "string" ? ` at ${requirement.location}` : "";
      return decision(
        "explicit_evidence_unmet",
        `Explicit evidence requirement ${String(requirement.id ?? "unknown")} (${String(requirement.requirement ?? "unspecified requirement")}) from ${String(source?.kind ?? "unknown kind")}:${String(source?.reference ?? "unknown source")} expects ${String(requirement.expected_kind ?? "unknown evidence")}${location} and is ${String(requirement.status ?? "missing")}.`,
      );
    }
  }
  const evaluation = recordAt(validation, "evaluation");
  if (stringAt(evaluation, "scope", "status") !== "aligned") {
    return decision(
      "scope_not_aligned",
      "ValidationResult does not prove aligned implementation scope.",
    );
  }
  if (
    arrayAt(evaluation, "unexpected_changes").length > 0 ||
    arrayAt(validation, "blockers").length > 0
  ) {
    return decision(
      "validation_blocker",
      "ValidationResult still contains an unexpected change or blocker.",
    );
  }
  const readinessField = draftPreparation
    ? "draft_pr_preparation_allowed"
    : "commit_preparation_allowed";
  if (booleanAt(validation, "readiness", readinessField) !== true) {
    return decision(
      "readiness_not_granted",
      `ValidationResult.${readinessField} must be true.`,
    );
  }
  return null;
};

const scopeGate = (context: GateContext): GateDecision | null => {
  const detection = handoff(context, "UnrelatedChangeDetection");
  if (!detection) return requireHandoff(context, "UnrelatedChangeDetection");
  if (detection.status !== "clear") {
    return decision(
      "scope_deviation",
      "UnrelatedChangeDetection did not establish a clear in-scope result.",
    );
  }
  const findings = arrayAt(detection, "findings").filter(isRecord);
  if (
    findings.some(
      (finding) =>
        finding.verdict === "scope_violation" ||
        finding.verdict === "uncertain",
    )
  ) {
    return decision(
      "scope_deviation",
      "The change set contains a scope violation or uncertain path.",
    );
  }
  return null;
};

const currentFeedbackValidation = (
  context: GateContext,
): GateDecision | null => {
  const validation = handoff(context, "FeedbackResolutionValidation");
  if (!validation) {
    return requireHandoff(context, "FeedbackResolutionValidation");
  }
  if (validation.status !== "validated") {
    return decision(
      "feedback_not_validated",
      "Thread actions require current validated feedback evidence.",
    );
  }
  const pullRequest = recordAt(validation, "pull_request");
  if (
    context.scenario.target.head_sha &&
    stringAt(pullRequest, "current_head_sha") !==
      context.scenario.target.head_sha
  ) {
    return decision(
      "stale_feedback_validation",
      "Feedback validation is not bound to the current pull-request head.",
    );
  }
  if (
    arrayAt(validation, "blockers").length > 0 ||
    arrayAt(validation, "uncertainties").length > 0
  ) {
    return decision(
      "feedback_validation_blocked",
      "Feedback validation retains blockers or uncertainties.",
    );
  }
  const results = arrayAt(validation, "results").filter(isRecord);
  if (
    results.some(
      (result) =>
        result.status !== "addressed" ||
        (result.thread && isRecord(result.thread) && result.thread.open === true),
    )
  ) {
    return decision(
      "feedback_not_addressed",
      "Every selected feedback item must be addressed before thread actions.",
    );
  }
  return null;
};

const feedbackAuthorization = (
  context: GateContext,
  payload: Record<string, unknown>,
  authorizationKey: string,
): GateDecision | null => {
  const feedback = recordAt(payload, "feedback_authorization");
  if (!feedback || booleanAt(feedback, "authorized") !== true) {
    return decision(
      "feedback_authorization_required",
      "The exact address-pr-feedback authorization is missing.",
    );
  }
  if (stringAt(feedback, "mode") !== "address_pr_feedback") {
    return decision(
      "feedback_authorization_mode",
      "The feedback authorization mode does not match address-pr-feedback.",
    );
  }
  if (
    stringAt(feedback, "repository") !== context.scenario.target.repository ||
    numberAt(feedback, "pull_request_number") !==
      context.scenario.target.pull_request_number ||
    (context.scenario.target.head_sha &&
      stringAt(feedback, "current_head_sha") !==
        context.scenario.target.head_sha)
  ) {
    return decision(
      "feedback_authorization_mismatch",
      "Feedback authorization is not bound to the exact current target.",
    );
  }
  return context.scenario.authorizations[authorizationKey] === true
    ? null
    : decision(
        "feedback_authorization_required",
        "The exact address-pr-feedback authorization is missing.",
      );
};

const reviewDecisionGate = (context: GateContext): GateDecision | null => {
  const review = handoff(context, "ReviewDecision");
  if (!review) return requireHandoff(context, "ReviewDecision");
  return (
    requireRepositoryAndPullRequest(context, review) ??
    (review.status === "approved"
      ? null
      : decision(
          "review_not_approved",
          "Only an explicitly approved ReviewDecision may be published.",
        )) ??
    (booleanAt(review, "approval", "exact_payload") === true &&
    booleanAt(review, "approval", "explicit_event_authorization") === true
      ? null
      : decision(
          "review_approval_required",
          "The exact review payload and event require separate approval.",
        ))
  );
};

const readinessGate = (context: GateContext): GateDecision | null => {
  if (!context.completedOperations.has("build-pr-readiness-evidence")) {
    return decision(
      "readiness_snapshot_step_missing",
      "MergeReadiness requires the complete build-pr-readiness-evidence step first.",
    );
  }
  const readiness = handoff(context, "MergeReadiness");
  if (!readiness) return requireHandoff(context, "MergeReadiness");
  const identity = requireRepositoryAndPullRequest(context, readiness);
  if (identity) return identity;
  if (readiness.status !== "ready") {
    return decision(
      "merge_not_ready",
      "Only a current ready MergeReadiness may be handed to merge.",
    );
  }
  const snapshot = recordAt(readiness, "readiness_evidence");
  if (
    snapshot === null ||
    stringAt(snapshot, "schema") !== "PullRequestReadinessEvidence" ||
    numberAt(snapshot, "version") !== 1 ||
    stringAt(snapshot, "status") !== "complete" ||
    snapshot.failure !== null
  ) {
    return decision(
      "readiness_snapshot_incomplete",
      "MergeReadiness must carry one complete version-1 readiness snapshot.",
    );
  }
  if (readiness.mergeability !== "mergeable") {
    return decision("merge_conflict", "The pull request has merge conflicts.");
  }
  const pullRequest = recordAt(readiness, "pull_request");
  if (
    stringAt(pullRequest, "state") !== "open" ||
    booleanAt(pullRequest, "draft") !== false
  ) {
    return decision(
      "pull_request_not_mergeable",
      "The pull request must be open and not Draft.",
    );
  }
  const reviewState = recordAt(readiness, "review_state");
  if (
    numberAt(reviewState, "change_request_count") !== 0 ||
    booleanAt(reviewState, "required_approvals_met") !== true ||
    stringAt(reviewState, "evidence_status") !== "known" ||
    stringAt(reviewState, "approval_inspection_status") !== "inspected"
  ) {
    return decision(
      "review_approval_blocker",
      "Required approvals or review-state evidence are missing.",
    );
  }
  const checks = arrayAt(readiness, "checks").filter(isRecord);
  if (
    checks.some(
      (check) => check.required === true && check.result !== "pass",
    )
  ) {
    return decision(
      "required_check_blocker",
      "A required status check has not passed.",
    );
  }
  if (arrayAt(readiness, "blockers").length > 0) {
    return decision(
      "merge_blocker",
      "MergeReadiness retains an actionable blocker.",
    );
  }
  const issueCoverageStatus = stringAt(
    readiness,
    "issue_coverage",
    "status",
  );
  if (issueCoverageStatus !== "covered" && issueCoverageStatus !== "waived") {
    return decision(
      "linked_issue_missing",
      "Exactly one covered linked issue or a waived unique-link condition is required before merge.",
    );
  }
  return null;
};

const uniqueLinkedIssue = (context: GateContext): GateDecision | null => {
  const linked = handoff(context, "LinkedIssue");
  if (!linked) return requireHandoff(context, "LinkedIssue");
  const identity = requireRepositoryAndPullRequest(context, linked);
  if (identity) return identity;
  if (linked.status !== "loaded") {
    return decision(
      "unique_issue_missing",
      "Ready-for-Review requires exactly one uniquely loaded linked issue.",
    );
  }
  const primary = recordAt(linked, "primary_issue");
  if (!primary || numberAt(primary, "number") === null) {
    return decision(
      "unique_issue_missing",
      "Ready-for-Review requires exactly one uniquely loaded linked issue.",
    );
  }
  if (arrayAt(linked, "ambiguous_candidates").length > 0) {
    return decision(
      "unique_issue_missing",
      "Ambiguous linked-issue candidates block Ready-for-Review.",
    );
  }
  const ready = handoff(context, "PullRequestReady");
  if (ready && booleanAt(ready, "linked_issue", "unique") !== true) {
    return decision(
      "unique_issue_missing",
      "PullRequestReady.linked_issue.unique must be true.",
    );
  }
  if (
    ready &&
    numberAt(ready, "linked_issue", "number") !== null &&
    numberAt(ready, "linked_issue", "number") !== numberAt(primary, "number")
  ) {
    return decision(
      "unique_issue_missing",
      "The Ready-for-Review linked issue does not match the loaded unique issue.",
    );
  }
  return null;
};

const exactReadyApproval = (
  context: GateContext,
  ready: Record<string, unknown>,
): GateDecision | null => {
  const auth = recordAt(ready, "authorization");
  for (const field of [
    "exact_target",
    "exact_ready_operation",
    "ready_authorized",
    "reviewers_authorized",
  ]) {
    if (booleanAt(auth, field) !== true) {
      return decision(
        "ready_authorization_required",
        `PullRequestReady.authorization.${field} must be true.`,
      );
    }
  }
  if (context.scenario.authorizations.pr_ready !== true) {
    return decision(
      "approval_required",
      "Independent exact Ready-for-Review approval is missing.",
    );
  }
  return null;
};

const exactMergeApproval = (
  context: GateContext,
  merge: Record<string, unknown>,
): GateDecision | null => {
  const auth = recordAt(merge, "authorization");
  for (const field of [
    "exact_target",
    "exact_merge_operation",
    "merge_authorized",
  ]) {
    if (booleanAt(auth, field) !== true) {
      return decision(
        "merge_authorization_required",
        `PullRequestMerge.authorization.${field} must be true.`,
      );
    }
  }
  if (
    context.scenario.authorizations.merge !== true ||
    booleanAt(auth, "merge_authorized") !== true
  ) {
    return decision(
      "approval_required",
      "Independent exact merge approval is missing.",
    );
  }
  return null;
};

const preCommitGate = (context: GateContext): GateDecision | null => {
  const gate = handoff(context, "PreCommitGate");
  if (!gate) return requireHandoff(context, "PreCommitGate");
  const identity = repositoryMatches(context, gate);
  if (identity) return identity;
  const validation = recordAt(gate, "validation");
  if (
    stringAt(validation, "status") !== "passed" ||
    booleanAt(validation, "readiness", "commit_preparation_allowed") !== true
  ) {
    return decision(
      "precommit_validation_required",
      "PreCommitGate must contain passed validation and commit readiness.",
    );
  }
  const proposal = recordAt(gate, "commit_proposal");
  if (
    stringAt(proposal, "status") !== "approved" ||
    booleanAt(proposal, "authorization", "exact_scope_approved") !== true ||
    booleanAt(proposal, "authorization", "commit_authorized") !== true
  ) {
    return decision(
      "precommit_authorization_required",
      "PreCommitGate must bind an approved, exactly authorized commit proposal.",
    );
  }
  return null;
};

const prePrCreateGate = (context: GateContext): GateDecision | null => {
  const gate = handoff(context, "PrePrCreateGate");
  if (!gate) return requireHandoff(context, "PrePrCreateGate");
  const identity = repositoryMatches(context, gate);
  if (identity) return identity;
  const validation = recordAt(gate, "validation");
  if (
    stringAt(validation, "status") !== "passed" ||
    booleanAt(validation, "readiness", "draft_pr_preparation_allowed") !== true
  ) {
    return decision(
      "prepr_validation_required",
      "PrePrCreateGate must contain passed validation and Draft PR readiness.",
    );
  }
  if (
    !["created", "verified"].includes(
      String(stringAt(gate, "commit_proposal", "status")),
    ) ||
    !["pushed", "verified"].includes(
      String(stringAt(gate, "branch_push", "status")),
    ) ||
    stringAt(gate, "pull_request_draft", "status") !== "draft" ||
    booleanAt(gate, "pull_request_draft", "draft") !== true ||
    stringAt(gate, "issue_link", "status") !== "linked"
  ) {
    return decision(
      "prepr_prerequisites_required",
      "PrePrCreateGate must bind the created commit, pushed branch, Draft payload, and linked issue.",
    );
  }

  return null;
};

const preReviewGate = (context: GateContext): GateDecision | null => {
  const gate = handoff(context, "PreReviewSubmitGate");
  if (!gate) return requireHandoff(context, "PreReviewSubmitGate");
  const identity = repositoryMatches(context, gate);
  if (identity) return identity;
  const review = recordAt(gate, "review_decision");
  if (
    stringAt(review, "status") !== "approved" ||
    booleanAt(review, "approval", "exact_payload") !== true ||
    booleanAt(review, "approval", "explicit_event_authorization") !== true
  ) {
    return decision(
      "prereview_approval_required",
      "PreReviewSubmitGate must bind the exact approved review payload and event.",
    );
  }
  const freshness = recordAt(gate, "freshness");
  if (
    context.scenario.target.head_sha &&
    stringAt(freshness, "head_sha") !== context.scenario.target.head_sha
  ) {
    return decision(
      "prereview_stale",
      "PreReviewSubmitGate freshness must match the current pull-request head.",
    );
  }
  if (stringAt(freshness, "pull_request_state") !== "open") {
    return decision(
      "prereview_pull_request_state",
      "Review publication requires an open pull request.",
    );
  }
  return null;
};

const preRebaseGate = (context: GateContext): GateDecision | null => {
  const gate = handoff(context, "PreRebaseGate");
  if (!gate) return requireHandoff(context, "PreRebaseGate");
  const identity =
    repositoryMatches(context, gate) ??
    pullRequestMatches(context, recordAt(gate, "pull_request") ?? {});
  if (identity) return identity;
  const targetFetch = recordAt(gate, "target_fetch");
  if (
    stringAt(targetFetch, "status") !== "verified" ||
    repositoryMatches(context, targetFetch ?? {}) !== null
  ) {
    return decision(
      "prerebase_target_fetch_required",
      "PreRebaseGate must bind the verified target branch fetch for this repository.",
    );
  }
  if (
    booleanAt(gate, "authorization", "approved") !== true ||
    booleanAt(gate, "authorization", "exact_target") !== true ||
    booleanAt(gate, "authorization", "exact_operation") !== true
  ) {
    return decision(
      "rebase_authorization_required",
      "The exact pre-rebase approval is missing.",
    );
  }
  return null;
};

const prePrReadyGate = (context: GateContext): GateDecision | null => {
  const gate = handoff(context, "PrePrReadyGate");
  if (!gate) return requireHandoff(context, "PrePrReadyGate");
  const identity =
    repositoryMatches(context, gate) ??
    pullRequestMatches(context, recordAt(gate, "pull_request") ?? gate);
  if (identity) return identity;
  if (
    context.scenario.target.head_sha &&
    stringAt(gate, "expected_head_sha") !== context.scenario.target.head_sha
  ) {
    return decision(
      "preready_head_mismatch",
      "PrePrReadyGate must bind the current pull-request head.",
    );
  }
  if (booleanAt(gate, "is_draft") !== true) {
    return decision(
      "preready_draft_required",
      "PrePrReadyGate must bind a current Draft pull request.",
    );
  }
  if (booleanAt(gate, "linked_issue", "unique") !== true) {
    return decision(
      "preready_unique_issue_required",
      "PrePrReadyGate must bind a unique linked issue.",
    );
  }
  if (
    booleanAt(gate, "authorization", "exact_target") !== true ||
    booleanAt(gate, "authorization", "exact_ready_operation") !== true ||
    booleanAt(gate, "authorization", "ready_authorized") !== true ||
    booleanAt(gate, "authorization", "reviewers_authorized") !== true
  ) {
    return decision(
      "preready_authorization_required",
      "PrePrReadyGate must bind independent exact Ready-for-Review authorization.",
    );
  }
  return null;
};

const preMergeGate = (context: GateContext): GateDecision | null => {
  const gate = handoff(context, "PreMergeGate");
  if (!gate) return requireHandoff(context, "PreMergeGate");
  const identity =
    repositoryMatches(context, gate) ??
    pullRequestMatches(context, recordAt(gate, "pull_request") ?? {});
  if (identity) return identity;
  if (
    context.scenario.target.head_sha &&
    stringAt(gate, "expected_head_sha") !== context.scenario.target.head_sha
  ) {
    return decision(
      "premerge_head_mismatch",
      "PreMergeGate must bind the current pull-request head.",
    );
  }
  if (
    context.scenario.target.base_sha &&
    stringAt(gate, "expected_base_sha") !== context.scenario.target.base_sha
  ) {
    return decision(
      "premerge_base_mismatch",
      "PreMergeGate must bind the current target base revision.",
    );
  }
  if (
    booleanAt(gate, "authorization", "exact_target") !== true ||
    booleanAt(gate, "authorization", "exact_merge_operation") !== true ||
    booleanAt(gate, "authorization", "merge_authorized") !== true
  ) {
    return decision(
      "premerge_authorization_required",
      "PreMergeGate must bind independent exact merge authorization.",
    );
  }
  const preflight = recordAt(gate, "preflight");
  const pullRequest = recordAt(gate, "pull_request");
  if (
    !preflight ||
    stringAt(preflight, "live_head_sha") !== context.scenario.target.head_sha ||
    stringAt(preflight, "live_base_sha") !== context.scenario.target.base_sha ||
    stringAt(preflight, "base_branch") !== stringAt(pullRequest, "base_branch") ||
    [
      "target_match",
      "open_state",
      "non_draft",
      "head_sha_match",
      "base_branch_match",
      "base_sha_match",
      "mergeability",
      "reviews_current",
      "checks_current",
      "method_allowed",
      "authorization_match",
    ].some((field) => stringAt(preflight, field) !== "pass")
  ) {
    return decision(
      "premerge_preflight_mismatch",
      "PreMergeGate must bind a passing final live preflight for the current pull-request and base identities.",
    );
  }
  const readiness = recordAt(gate, "readiness");
  if (
    stringAt(readiness, "schema") !== "MergeReadiness" ||
    numberAt(readiness, "version") !== 3 ||
    stringAt(readiness, "status") !== "ready" ||
    (context.scenario.target.head_sha &&
      stringAt(readiness, "head_sha") !== context.scenario.target.head_sha)
  ) {
    return decision(
      "premerge_readiness_mismatch",
      "PreMergeGate must bind current version-3 ready merge-readiness evidence and its immutable readiness snapshot.",
    );
  }
  return null;
};

export const evaluateWriteGate = (
  context: GateContext,
  action: ScenarioAction,
): GateDecision => {
  const operation = action.operation;

  if (operation === "create-github-issue") {
    const isRefinePublication =
      context.scenario.command === "refine-issue" ||
      context.scenario.command === "refine-auto-issue" ||
      action.phase === "refine";
    const target = targetGate(context, isRefinePublication, false);
    if (target) return target;
    const auth = authorization(context, "issue_publication");
    if (auth) return auth;
    const draftingStep = isRefinePublication
      ? "issue-agent:refine"
      : "issue-agent:create";
    if (!context.completedOperations.has(draftingStep)) {
      return decision(
        "issue_draft_step_missing",
        "Issue publication requires the completed issue drafting handoff.",
      );
    }
    const draft = handoff(context, "IssueDraft");
    if (!draft) return requireHandoff(context, "IssueDraft")!;
    const identity = requireRepositoryAndIssue(
      context,
      draft,
      context.scenario.command === "create-issue" || action.phase === "create",
    );
    if (identity) return identity;
    if (draft.status !== "approved") {
      return decision(
        "issue_draft_not_approved",
        "Only an approved IssueDraft may be published.",
      );
    }
    if (
      booleanAt(draft, "approval", "exact_payload") !== true ||
      booleanAt(draft, "approval", "publication_authorized") !== true
    ) {
      return decision(
        "issue_publication_approval_required",
        "The exact issue payload and publication authorization are required.",
      );
    }
    if (isRefinePublication && stringAt(draft, "mode") !== "edit") {
      return decision(
        "issue_mode_mismatch",
        "Refine publication requires an edit-mode IssueDraft.",
      );
    }
    return allowed();
  }

  if (operation === "create-worktree") {
    if (context.scenario.command === "auto-ci-fix-pr") {
      const target = targetGate(context, false, true);
      if (target) return target;
      const auth = authorization(context, "workspace_attachment");
      if (auth) return auth;
      if (!context.completedOperations.has("build-ci-fix-plan")) {
        return decision(
          "ci_fix_plan_step_missing",
          "CI-fix plan worktree attachment requires the completed build-ci-fix-plan step.",
        );
      }
      const plan = handoff(context, "CiFixPlan");
      if (!plan) return requireHandoff(context, "CiFixPlan")!;
      const workspace = handoff(context, "BranchWorkspace");
      if (!workspace) return requireHandoff(context, "BranchWorkspace")!;
      const identity =
        requireRepositoryAndPullRequest(context, plan) ??
        repositoryMatches(context, workspace);
      if (identity) return identity;
      if (plan.status !== "confirmed") {
        return decision(
          "ci_fix_plan_not_confirmed",
          "Only a confirmed CiFixPlan may attach the existing pull-request worktree.",
        );
      }
      if (workspace.status !== "planned") {
        return decision(
          "workspace_state_mismatch",
          "An existing pull-request worktree must start from planned state.",
        );
      }
      return allowed();
    }
    if (context.scenario.command === "auto-review-fix-pr") {
      const target = targetGate(context, false, true);
      if (target) return target;
      const auth = authorization(context, "workspace_attachment");
      if (auth) return auth;
      if (!context.completedOperations.has("build-review-fix-plan")) {
        return decision(
          "review_fix_plan_step_missing",
          "Review-fix worktree attachment requires the confirmed ReviewFixPlan step.",
        );
      }
      const plan = handoff(context, "ReviewFixPlan");
      if (!plan) return requireHandoff(context, "ReviewFixPlan")!;
      const workspace = handoff(context, "BranchWorkspace");
      if (!workspace) return requireHandoff(context, "BranchWorkspace")!;
      const identity =
        requireRepositoryAndPullRequest(context, plan) ??
        repositoryMatches(context, workspace);
      if (identity) return identity;
      if (plan.status !== "confirmed") {
        return decision(
          "review_fix_plan_not_confirmed",
          "Only a confirmed ReviewFixPlan may attach the existing pull-request branch.",
        );
      }
      if (workspace.status !== "planned") {
        return decision(
          "workspace_state_mismatch",
          "An existing pull-request worktree must start from planned state.",
        );
      }
      return allowed();
    }
    const target = targetGate(context, true, false);
    if (target) return target;
    const auth = authorization(context, "workspace_creation");
    if (auth) return auth;
    if (!context.completedOperations.has("build-implementation-plan")) {
      return decision(
        "implementation_plan_step_missing",
        "Workspace creation requires the completed implementation-plan step.",
      );
    }
    const plan = handoff(context, "ImplementationPlan");
    if (!plan) return requireHandoff(context, "ImplementationPlan")!;
    const workspace = handoff(context, "BranchWorkspace");
    if (!workspace) return requireHandoff(context, "BranchWorkspace")!;
    const identity =
      requireRepositoryAndIssue(context, plan) ??
      repositoryMatches(context, workspace);
    if (identity) return identity;
    if (!["approved", "in_progress", "completed"].includes(String(plan.status))) {
      return decision(
        "implementation_not_ready",
        "The implementation plan is not ready for workspace creation.",
      );
    }
    if (workspace.status !== "planned") {
      return decision(
        "workspace_state_mismatch",
        "A new workspace must start from the planned state.",
      );
    }
    return allowed();
  }

  if (operation === "rerun-required-checks") {
    const target = targetGate(context, false, true);
    if (target) return target;
    const auth = authorization(context, "check_rerun");
    if (auth) return auth;
    if (
      context.scenario.command === "auto-ci-fix-pr" &&
      context.scenario.facts.optional_check_as_required === true
    ) {
      return decision(
        "optional_check_as_required",
        "Rerunning an optional check as if it were required is blocked by scenario facts.",
      );
    }
    if (!context.completedOperations.has("wait-required-checks")) {
      return decision(
        "required_check_wait_step_missing",
        "A CI fix rerun requires the completed wait-required-checks step.",
      );
    }
    const intent = handoff(context, "RequiredCheckRerun");
    if (!intent) return requireHandoff(context, "RequiredCheckRerun")!;
    if (intent.status !== "approved") {
      return decision(
        "required_check_rerun_intent_not_approved",
        "Only an approved RequiredCheckRerun may request a rerun.",
      );
    }
    const rerunAuthorized = booleanAt(
      intent,
      "authorization",
      "rerun_authorized",
    );
    if (rerunAuthorized !== true) {
      return decision(
        "required_check_rerun_authorization_required",
        "Exact required-check rerun authorization is missing.",
      );
    }
    return allowed();
  }

  if (operation === "create-commit") {
    const prBased =
      context.scenario.command === "auto-review-fix-pr" ||
      context.scenario.command === "auto-ci-fix-pr";
    const target = prBased
      ? targetGate(context, false, true)
      : targetGate(context, true, false);
    if (target) return target;
    const auth = authorization(context, "commit");
    if (auth) return auth;
    if (!context.completedOperations.has("validate-implementation-result")) {
      return decision(
        "validation_step_missing",
        "Commit creation requires the completed implementation validation step.",
      );
    }
    const scope = scopeGate(context);
    if (scope) return scope;
    const validation = validationGate(context);
    if (validation) return validation;
    const proposal = handoff(context, "CommitProposal");
    if (!proposal) return requireHandoff(context, "CommitProposal")!;
    const identity = prBased
      ? requireRepositoryAndPullRequest(context, proposal)
      : requireRepositoryAndIssue(context, proposal);
    if (identity) return identity;
    if (proposal.status !== "approved") {
      return decision(
        "commit_proposal_not_approved",
        "Only an approved CommitProposal can create a commit.",
      );
    }
    if (
      booleanAt(proposal, "authorization", "exact_scope_approved") !== true ||
      booleanAt(proposal, "authorization", "commit_authorized") !== true
    ) {
      return decision(
        "commit_authorization_required",
        "Exact commit scope and commit authorization are required.",
      );
    }
    return preCommitGate(context) ?? allowed();
  }

  if (operation === "push-branch") {
    const prBased =
      context.scenario.command === "auto-review-fix-pr" ||
      context.scenario.command === "auto-ci-fix-pr";
    const target = prBased
      ? targetGate(context, false, true)
      : targetGate(
          context,
          action.phase !== "integration",
          action.phase === "integration",
        );
    if (target) return target;
    const auth =
      action.phase === "integration"
        ? context.scenario.authorizations.push === true
          ? null
          : decision(
              "push_authorization_required",
              "The approved integration branch push authorization is missing.",
            )
        : authorization(context, "push");
    if (auth) return auth;
    if (action.phase === "integration") {
      if (!context.successfulWrites.has("rebase-branch")) {
        return decision(
          "rebase_required",
          "An integration push requires a successful approved rebase first.",
        );
      }
      if (!context.completedOperations.has("validate-rebased-branch")) {
        return decision(
          "rebased_validation_step_missing",
          "An integration push requires current post-rebase validation.",
        );
      }
    } else if (!context.successfulWrites.has("create-commit")) {
      return decision(
        "commit_required",
        "A branch cannot be pushed before the approved commit is created.",
      );
    }
    return allowed();
  }

  if (operation === "create-draft-pr") {
    const target = targetGate(context, true, false);
    if (target) return target;
    const auth = authorization(context, "draft_pr");
    if (auth) return auth;
    if (
      !context.successfulWrites.has("create-commit") ||
      !context.successfulWrites.has("push-branch")
    ) {
      return decision(
        "delivery_prerequisites_missing",
        "A Draft PR requires the verified commit and branch push from this workflow.",
      );
    }
    if (!context.completedOperations.has("link-pr-to-issue")) {
      return decision(
        "issue_link_step_missing",
        "Draft PR creation requires the completed issue-link step.",
      );
    }
    const validation = validationGate(context, true);
    if (validation) return validation;
    const draft = handoff(context, "PullRequestDraft");
    const link = handoff(context, "PullRequestIssueLink");
    if (!draft) return requireHandoff(context, "PullRequestDraft")!;
    if (!link) return requireHandoff(context, "PullRequestIssueLink")!;
    const identity =
      requireRepositoryAndIssue(context, draft) ??
      requireRepositoryAndIssue(context, link);
    if (identity) return identity;
    if (draft.status !== "draft" || booleanAt(draft, "draft") !== true) {
      return decision(
        "draft_pr_required",
        "The publication payload must remain an explicit Draft PR.",
      );
    }
    if (
      link.status !== "linked" ||
      arrayAt(link, "linked_issues").length !== 1
    ) {
      return decision(
        "issue_link_required",
        "Exactly one verified issue link is required before Draft PR creation.",
      );
    }
    return prePrCreateGate(context) ?? allowed();
  }

  if (operation === "submit-pr-review") {
    const target = targetGate(context, false, true);
    if (target) return target;
    const auth = authorization(context, "review_event", true);
    if (auth) return auth;
    if (!context.completedOperations.has("compose-review")) {
      return decision(
        "review_composition_missing",
        "Review publication requires the completed review composition step.",
      );
    }
    const review = reviewDecisionGate(context);
    if (review) return review;
    const decisionPayload = handoff(context, "ReviewDecision")!;
    if (
      stringAt(decisionPayload, "proposed_event") === "REQUEST_CHANGES" &&
      context.scenario.authorizations.review_request_changes !== true
    ) {
      return decision(
        "change_request_approval_required",
        "REQUEST_CHANGES requires its own explicit review-event approval.",
      );
    }
    return preReviewGate(context) ?? allowed();
  }

  if (
    operation === "reply-to-review-thread" ||
    operation === "resolve-review-thread"
  ) {
    const target = targetGate(context, false, true);
    if (target) return target;
    const validation = currentFeedbackValidation(context);
    if (validation) return validation;
    if (!context.completedOperations.has("validate-feedback-resolution")) {
      return decision(
        "feedback_validation_step_missing",
        "Thread actions require the completed current feedback-validation step.",
      );
    }
    const payload = handoff(
      context,
      operation === "reply-to-review-thread"
        ? "ReviewThreadReply"
        : "ReviewThreadResolution",
    );
    if (!payload) {
      return requireHandoff(
        context,
        operation === "reply-to-review-thread"
          ? "ReviewThreadReply"
          : "ReviewThreadResolution",
      )!;
    }
    const identity = requireRepositoryAndPullRequest(context, payload);
    if (identity) return identity;
    const feedback = feedbackAuthorization(
      context,
      payload,
      operation === "reply-to-review-thread"
        ? "feedback_reply"
        : "feedback_resolution",
    );
    if (feedback) return feedback;
    if (operation === "resolve-review-thread") {
      if (
        stringAt(payload, "status") !== "approved" ||
        stringAt(payload, "validation", "status") !== "addressed" ||
        booleanAt(payload, "validation", "resolution_eligible") !== true ||
        booleanAt(payload, "platform", "resolution_supported") !== true
      ) {
        return decision(
          "thread_resolution_not_eligible",
          "A review thread may be resolved only after current addressed validation.",
        );
      }
    }
    return allowed();
  }

  if (operation === "fetch-target-branch") {
    const target = targetGate(context, false, true);
    if (target) return target;
    if (!context.completedOperations.has("assess-merge-readiness")) {
      return decision(
        "readiness_step_missing",
        "Target-branch fetch requires an initial merge-readiness assessment.",
      );
    }
    const auth = authorization(context, "fetch", true);
    if (auth) return auth;
    const fetch = handoff(context, "TargetBranchFetch");
    if (!fetch) return requireHandoff(context, "TargetBranchFetch")!;
    const identity =
      repositoryMatches(context, fetch) ??
      (fetch.status === "verified"
        ? null
        : decision(
            "target_fetch_not_verified",
            "The target branch fetch must be verified before rebase planning.",
          ));
    if (identity) return identity;
    if (
      booleanAt(fetch, "authorization", "approved") !== true ||
      stringAt(fetch, "fetch", "result") !== "success" &&
        stringAt(fetch, "fetch", "result") !== "up_to_date"
    ) {
      return decision(
        "target_fetch_approval_required",
        "The exact target branch fetch approval and successful result are required.",
      );
    }
    return allowed();
  }

  if (operation === "rebase-branch") {
    const target = targetGate(context, false, true);
    if (target) return target;
    const auth = authorization(context, "rebase", true);
    if (auth) return auth;
    if (
      !context.successfulWrites.has("fetch-target-branch") ||
      !context.completedOperations.has("detect-rebase-conflicts")
    ) {
      return decision(
        "rebase_preflight_missing",
        "Rebase requires the verified target fetch and conflict-analysis steps.",
      );
    }
    const rebase = handoff(context, "BranchRebase");
    if (!rebase) return requireHandoff(context, "BranchRebase")!;
    if (rebase.status === "conflicted") {
      return decision(
        "rebase_conflict",
        "The rebase is conflicted and must remain stopped for read-only analysis.",
      );
    }
    if (rebase.status !== "approved") {
      return decision(
        "rebase_not_approved",
        "Only an independently approved rebase may run.",
      );
    }
    if (context.scenario.facts.worktree_clean === false) {
      return decision(
        "dirty_worktree",
        "A rebase requires a clean registered worktree.",
      );
    }
    const gate = preRebaseGate(context);
    if (gate) return gate;
    return allowed();
  }

  if (operation === "merge-pull-request") {
    const target = targetGate(context, false, true);
    if (target) return target;
    const auth = authorization(context, "merge", true);
    if (auth) return auth;
    if (
      !context.successfulWrites.has("rebase-branch") ||
      !context.completedOperations.has("assess-merge-readiness")
    ) {
      return decision(
        "rebase_required",
        "Integration must complete the rebase and rebuilt snapshot-bound readiness validation before merge.",
      );
    }
    const readiness = readinessGate(context);
    if (readiness) return readiness;
    const merge = handoff(context, "PullRequestMerge");
    if (!merge) return requireHandoff(context, "PullRequestMerge")!;
    const identity = requireRepositoryAndPullRequest(context, merge);
    if (identity) return identity;
    if (merge.status !== "approved") {
      return decision(
        "merge_not_approved",
        "Only an approved PullRequestMerge may be executed.",
      );
    }
    const mergeApproval = exactMergeApproval(context, merge);
    if (mergeApproval) return mergeApproval;
    return preMergeGate(context) ?? allowed();
  }

  if (operation === "mark-pr-ready") {
    const target = targetGate(context, false, true);
    if (target) return target;
    const auth = authorization(context, "pr_ready", true);
    if (auth) return auth;
    if (
      !context.completedOperations.has("load-pull-request") ||
      !context.completedOperations.has("load-linked-issue") ||
      !context.completedOperations.has("propose-pr-reviewers")
    ) {
      return decision(
        "ready_preflight_missing",
        "Ready-for-Review requires the loaded pull request, unique linked issue, and reviewer proposal.",
      );
    }
    const unique = uniqueLinkedIssue(context);
    if (unique) return unique;
    const loaded = handoff(context, "LoadedPullRequest");
    if (!loaded) return requireHandoff(context, "LoadedPullRequest")!;
    const loadedIdentity = requireRepositoryAndPullRequest(context, loaded);
    if (loadedIdentity) return loadedIdentity;
    if (stringAt(loaded, "state") !== "open") {
      return decision(
        "not_open",
        "Ready-for-Review requires an open pull request.",
      );
    }
    const ready = handoff(context, "PullRequestReady");
    if (!ready) return requireHandoff(context, "PullRequestReady")!;
    const readyIdentity = requireRepositoryAndPullRequest(context, ready);
    if (readyIdentity) return readyIdentity;
    if (booleanAt(loaded, "is_draft") === false) {
      return ready.status === "already_ready"
        ? allowed()
        : decision(
            "not_draft",
            "An already non-Draft pull request must return already_ready without requesting reviewers.",
          );
    }
    if (booleanAt(loaded, "is_draft") !== true) {
      return decision(
        "not_draft",
        "Ready-for-Review requires a current Draft pull request.",
      );
    }
    if (ready.status !== "approved") {
      return decision(
        "ready_not_approved",
        "Only an approved PullRequestReady may mark a Draft ready.",
      );
    }
    const readyApproval = exactReadyApproval(context, ready);
    if (readyApproval) return readyApproval;
    return prePrReadyGate(context) ?? allowed();
  }

  if (operation === "create-product-sub-issues") {
    const target = targetGate(context, true, false);
    if (target) return target;
    const auth = authorization(context, "issue_publication");
    if (auth) return auth;
    if (!context.completedOperations.has("product-planner-agent")) {
      return decision(
        "product_planner_review_missing",
        "Sub-issue publication requires the completed product-planner review.",
      );
    }
    const run = handoff(context, "ProductPlannerRun");
    if (!run) return requireHandoff(context, "ProductPlannerRun")!;
    const runIdentity =
      repositoryMatches(context, run) ??
      (numberAt(run, "parent_issue", "number") ===
      context.scenario.target.issue_number
        ? null
        : decision(
            "issue_mismatch",
            "ProductPlannerRun.parent_issue does not match the verified parent issue.",
          ));
    if (runIdentity) return runIdentity;
    if (run.status !== "publication_handed_off") {
      return decision(
        "product_plan_not_ready",
        "Only a publication_handed_off ProductPlannerRun may be handed to publication.",
      );
    }
    if (context.handoffs.has("IssueDraft")) {
      return decision(
        "independent_issue_draft_forbidden",
        "Product Planner publication must not accept a separately authored IssueDraft set.",
      );
    }
    const drafts = handoff(context, "ProductSubIssueDrafts");
    if (!drafts) return requireHandoff(context, "ProductSubIssueDrafts")!;
    const draftIdentity = repositoryMatches(context, drafts);
    if (draftIdentity) return draftIdentity;
    if (drafts.schema !== "ProductSubIssueDrafts" || drafts.version !== 2) {
      return decision(
        "legacy_input",
        "Product publication accepts only ProductSubIssueDrafts version 2; legacy draft sets are rejected.",
      );
    }
    if (context.scenario.facts.legacy_input === true) {
      return decision(
        "legacy_input",
        "Product publication rejects a legacy v1 draft-set input before any write.",
      );
    }
    const source = recordAt(drafts, "source");
    const canonicalIdentity = recordAt(drafts, "canonical_identity");
    const canonicalSet = recordAt(run, "canonical_set");
    const targetIssue = context.scenario.target.issue_number;
    if (
      !canonicalIdentity ||
      !canonicalSet ||
      canonicalIdentity.schema !== "ProductSubIssueDrafts" ||
      canonicalIdentity.version !== 2 ||
      canonicalIdentity.canonicalization_version !== 1 ||
      canonicalIdentity.algorithm !== "sha256" ||
      typeof canonicalIdentity.digest !== "string" ||
      !/^[0-9a-f]{64}$/.test(canonicalIdentity.digest)
    ) {
      return decision(
        "canonical_identity_invalid",
        "Publication requires a complete ProductSubIssueDrafts v2 canonical identity.",
      );
    }
    if (
      canonicalSet.schema !== "ProductSubIssueDrafts" ||
      canonicalSet.version !== 2 ||
      canonicalSet.canonicalization_version !== 1 ||
      canonicalSet.algorithm !== "sha256" ||
      canonicalSet.digest !== canonicalIdentity.digest ||
      !exactStringSet(canonicalSet.unit_ids, canonicalIdentity.unit_ids) ||
      !exactStringSet(canonicalIdentity.unit_ids, canonicalUnitIds(drafts))
    ) {
      return decision(
        "canonical_set_mismatch",
        "Planner approval must identify the exact supplied canonical ProductSubIssueDrafts set.",
      );
    }
    let recomputedDigest = "";
    try {
      recomputedDigest = productSubIssueDigest(drafts);
    } catch {
      return decision(
        "canonical_digest_invalid",
        "The canonical ProductSubIssueDrafts digest could not be recomputed.",
      );
    }
    if (recomputedDigest !== canonicalIdentity.digest) {
      return decision(
        "digest_mismatch",
        "Publication is blocked because the supplied canonical payload changed after approval.",
      );
    }
    if (context.scenario.facts.mutation_after_approval === true) {
      return decision(
        "digest_mismatch",
        "Publication is blocked because the canonical payload was mutated after exact-set approval.",
      );
    }
    if (
      stringAt(source, "repository") !== context.scenario.target.repository ||
      numberAt(source, "number") !== targetIssue ||
      stringAt(source, "url") !== stringAt(run, "parent_issue", "url") ||
      numberAt(run, "parent_issue", "number") !== targetIssue
    ) {
      return decision(
        "identity_mismatch",
        "The canonical draft source, Planner parent, and verified target issue must match exactly.",
      );
    }
    const authorizationRecord = recordAt(run, "authorization");
    if (
      authorizationRecord?.exact_payload !== true ||
      authorizationRecord.exact_set !== true ||
      authorizationRecord.publication_authorized !== true ||
      authorizationRecord.canonical_set_digest !== canonicalIdentity.digest
    ) {
      return decision(
        "issue_publication_approval_required",
        "Exact payload, exact set, matching digest, and publication authorization are required before publication.",
      );
    }
    if (context.scenario.facts.ambiguous_live_match === true) {
      return decision(
        "duplicate_ambiguous",
        "Publication is blocked because more than one live exact-title candidate matches the canonical unit.",
      );
    }
    if (context.scenario.facts.retry_digest_changed === true) {
      return decision(
        "digest_mismatch",
        "A retry mapping is not reusable because the canonical-set digest changed.",
      );
    }
    if (context.scenario.facts.parent_overwrite === true) {
      return decision(
        "parent_overwrite_forbidden",
        "Publication is blocked because a canonical unit would target the parent issue.",
      );
    }
    for (const [index, draftValue] of arrayAt(drafts, "drafts").entries()) {
      const draft = isRecord(draftValue) ? draftValue : {};
      const target = recordAt(draft, "issue") ?? recordAt(draft, "publication_target");
      if (
        targetIssue &&
        target &&
        (numberAt(target, "number") === targetIssue ||
          stringAt(target, "url") === stringAt(run, "parent_issue", "url"))
      ) {
        return decision(
          "parent_overwrite_forbidden",
          `Canonical draft ${String(draft.unit_id ?? index)} targets the parent issue.`,
        );
      }
      const parentReference = recordAt(draft, "sections", "parent_reference");
      if (parentReference && parentReference.relationship !== "sub_issue_of") {
        return decision(
          "parent_relationship_mismatch",
          `Canonical draft ${String(draft.unit_id ?? index)} does not preserve the sub_issue_of parent relationship.`,
        );
      }
    }
    return allowed();
  }

  if (
    operation === "delete-merged-branch" ||
    operation === "cleanup-worktree"
  ) {
    if (!context.successfulWrites.has("merge-pull-request")) {
      return decision(
        "cleanup_before_merge",
        "Cleanup is available only after a verified merge.",
      );
    }
    if (context.scenario.facts.recoverable_work === true) {
      return decision(
        "recoverable_work",
        "Recoverable or uncommitted work must be preserved.",
      );
    }
    const auth = authorization(
      context,
      operation === "delete-merged-branch"
        ? "branch_cleanup"
        : "worktree_cleanup",
      true,
    );
    if (auth) return auth;
    return allowed();
  }

  if (operation === "close-github-issue") {
    const target = targetGate(context, true, false);
    if (target) return target;
    const auth = authorization(context, "issue_close", true);
    if (auth) return auth;
    const closure = handoff(context, "IssueClosure");
    if (!closure) return requireHandoff(context, "IssueClosure")!;
    const closeReason = stringAt(closure, "close_reason");
    if (!closeReason) {
      return decision(
        "missing_close_reason",
        "A close reason is required before closing a GitHub issue.",
      );
    }
    if (closeReason === "duplicate") {
      const duplicateOf = recordAt(closure, "duplicate_of");
      if (!duplicateOf) {
        return decision(
          "ambiguous_duplicate_target",
          "A unique duplicate target is required before closing as duplicate.",
        );
      }
    }
    return allowed();
  }

  if (operation === "close-linked-issue") {
    const target = targetGate(context, true, true);
    if (target) return target;
    if (!context.successfulWrites.has("merge-pull-request")) {
      return decision(
        "issue_closure_before_merge",
        "A linked issue may be closed only after the merge has been verified.",
      );
    }
    if (!context.completedOperations.has("verify-linked-issue-closure")) {
      return decision(
        "issue_closure_verification_step_missing",
        "A linked issue may be closed only after current closure verification.",
      );
    }
    const verification = handoff(context, "LinkedIssueClosureVerification");
    if (!verification) {
      return requireHandoff(context, "LinkedIssueClosureVerification")!;
    }
    if (verification.status !== "not-closed") {
      return decision(
        "issue_closure_not_eligible",
        "Manual issue closure requires current not-closed verification.",
      );
    }
    const closeOnMergeIntent =
      booleanAt(verification, "closure", "expected") === true;
    const issueLink = handoff(context, "PullRequestIssueLink");
    const linkedIssues = arrayAt(issueLink, "linked_issues");
    const linkPullRequest = recordAt(issueLink, "pull_request");
    const targetMatchesIntent =
      issueLink?.status === "linked" &&
      booleanAt(issueLink, "closes_issue_on_merge") === true &&
      stringAt(issueLink, "repository") === context.scenario.target.repository &&
      numberAt(issueLink, "issue", "number") ===
        context.scenario.target.issue_number &&
      numberAt(linkPullRequest, "number") ===
        context.scenario.target.pull_request_number &&
      stringAt(linkPullRequest, "repository") ===
        context.scenario.target.repository &&
      linkedIssues.length === 1 &&
      isRecord(linkedIssues[0]) &&
      linkedIssues[0].repository === context.scenario.target.repository &&
      linkedIssues[0].number === context.scenario.target.issue_number;
    const closure = handoff(context, "LinkedIssueClosure");
    const closureAuthorization = recordAt(closure, "authorization");
    const fallbackAuthorized =
      closure?.status === "approved" &&
      closureAuthorization?.source === "close_on_merge_intent" &&
      closureAuthorization.exact_target === true &&
      closureAuthorization.exact_close_operation === true &&
      closureAuthorization.close_authorized === true;
    if (closeOnMergeIntent && targetMatchesIntent && fallbackAuthorized) {
      return allowed();
    }
    const auth = authorization(context, "issue_close", true);
    if (auth) return auth;
    return allowed();
  }

  if (operation === "apply-issue-priority-titles") {
    const target = targetGate(context, false, false);
    if (target) return target;
    const auth = authorization(context, "issue_reprioritize");
    if (auth) return auth;
    if (
      !context.completedOperations.has("list-open-issues") ||
      !context.completedOperations.has("rank-open-issues")
    ) {
      return decision(
        "reprioritize_preflight_missing",
        "Title application requires the open-issue inventory and confirmed ranking.",
      );
    }
    const inventory = handoff(context, "OpenIssueInventory");
    if (!inventory) return requireHandoff(context, "OpenIssueInventory")!;
    const inventoryIdentity = repositoryMatches(context, inventory);
    if (inventoryIdentity) return inventoryIdentity;
    if (inventory.status !== "loaded") {
      return decision(
        "inventory_not_loaded",
        "Title application requires a loaded OpenIssueInventory.",
      );
    }
    if (inventory.truncated === true) {
      return decision(
        "truncated_inventory",
        "A truncated open-issue list cannot authorize title writes.",
      );
    }
    const ranking = handoff(context, "OpenIssueRanking");
    if (!ranking) return requireHandoff(context, "OpenIssueRanking")!;
    const rankingIdentity = repositoryMatches(context, ranking);
    if (rankingIdentity) return rankingIdentity;
    if (ranking.status !== "ranked") {
      return decision(
        "ranking_unconfirmed",
        "Only a ranked OpenIssueRanking may be applied.",
      );
    }
    if (
      booleanAt(ranking, "authorization", "ranking_confirmed") !== true ||
      booleanAt(ranking, "authorization", "exact_payload") !== true ||
      booleanAt(ranking, "authorization", "exact_set") !== true
    ) {
      return decision(
        "ranking_approval_required",
        "Exact ranked-set approval is required before title writes.",
      );
    }
    const inventoryNumbers = arrayAt(inventory, "issues")
      .map((entry) => (isRecord(entry) ? entry.number : null))
      .filter((value): value is number => typeof value === "number")
      .sort((left, right) => left - right);
    const sourceNumbers = arrayAt(ranking, "source", "issue_numbers")
      .filter((value): value is number => typeof value === "number")
      .sort((left, right) => left - right);
    const rankNumbers = arrayAt(ranking, "ranks")
      .map((entry) => (isRecord(entry) ? entry.number : null))
      .filter((value): value is number => typeof value === "number")
      .sort((left, right) => left - right);
    const sameSet =
      inventoryNumbers.length === sourceNumbers.length &&
      inventoryNumbers.length === rankNumbers.length &&
      inventoryNumbers.every(
        (value, index) =>
          value === sourceNumbers[index] && value === rankNumbers[index],
      );
    if (!sameSet) {
      return decision(
        "live_set_changed",
        "Live open-issue numbers must match the approved ranking set.",
      );
    }
    return allowed();
  }

  return decision(
    "operation_not_supported",
    `No write gate exists for ${operation}; fail closed.`,
  );
};

export const evaluateReadGate = (
  context: GateContext,
  action: ScenarioAction,
): GateDecision => {
  if (action.operation === "assess-merge-readiness") {
    return readinessGate(context) ?? allowed();
  }
  if (action.operation === "validate-rebased-branch") {
    const validation = handoff(context, "ValidationResult");
    if (!validation) return requireHandoff(context, "ValidationResult")!;
    return validation.status === "passed"
      ? allowed()
      : decision(
          "rebased_validation_failed",
          "A rebased branch must pass current implementation validation.",
        );
  }
  if (action.operation === "detect-rebase-conflicts") {
    const analysis = handoff(context, "RebaseConflictAnalysis");
    if (!analysis) return requireHandoff(context, "RebaseConflictAnalysis")!;
    return analysis.status === "blocked"
      ? decision(
          "conflict_analysis_blocked",
          "Conflict analysis is incomplete; the rebase must remain stopped.",
        )
      : allowed();
  }
  if (action.operation === "handoff-external-implementation") {
    if (context.scenario.command === "auto-review-fix-pr") {
      const plan = handoff(context, "ReviewFixPlan");
      if (!plan) return requireHandoff(context, "ReviewFixPlan")!;
      if (plan.status !== "confirmed") {
        return decision(
          "review_fix_plan_not_confirmed",
          "External implementation requires a confirmed ReviewFixPlan.",
        );
      }
    }
    const capabilities = handoff(context, "ContextCapabilities");
    if (!capabilities) return requireHandoff(context, "ContextCapabilities")!;
    if (capabilities.status === "blocked") {
      return decision(
        "missing_implementation_capability",
        "External implementation cannot start from a blocked capability handoff.",
      );
    }
    const blocking = arrayAt(capabilities, "missing_capabilities").some(
      (entry) =>
        isRecord(entry) &&
        entry.relevance === "required" &&
        entry.impact === "blocking",
    );
    return blocking
      ? decision(
          "missing_implementation_capability",
          "A required implementation capability is missing or unavailable.",
        )
      : allowed();
  }
  return allowed();
};

export const isPreservationSafe = (context: GateContext): GateDecision =>
  context.scenario.facts.recoverable_work === true ||
  context.scenario.facts.dirty_at_cleanup === true ||
  context.scenario.facts.worktree_clean === false
    ? {
        allowed: true,
        code: "preserve_recoverable_work",
        reason: "Uncommitted or recoverable work remains preserved.",
      }
    : decision(
        "preservation_not_required",
        "Preservation was requested without evidence of recoverable work.",
      );
