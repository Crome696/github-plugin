export interface InvariantIssue {
  code: string;
  path: string;
  message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const issue = (
  code: string,
  path: string,
  message: string,
): InvariantIssue => ({ code, path, message });

const arrayAt = (value: unknown, path: string): unknown[] =>
  Array.isArray(value) ? value : [];

const objectAt = (
  value: unknown,
  path: string,
): Record<string, unknown> | null => {
  if (isRecord(value)) return value;
  return null;
};

const evidenceSourceKinds = new Set([
  "issue",
  "implementation_plan",
  "repository_policy",
  "external_capability",
]);

const evidenceStatuses = new Set(["satisfied", "missing", "blocked"]);

const isRepositoryRelativeLocation = (value: unknown): value is string => {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    return false;
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    return false;
  }
  const segments = normalized.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
};

const validateEvidenceRequirements = (
  payload: Record<string, unknown>,
): InvariantIssue[] => {
  const issues: InvariantIssue[] = [];
  if (!Array.isArray(payload.evidence_requirements)) {
    return [
      issue(
        "evidence_requirements_required",
        "$.evidence_requirements",
        "ValidationResult v2 must contain an explicit evidence_requirements list.",
      ),
    ];
  }

  const seenIds = new Set<string>();
  for (const [index, value] of payload.evidence_requirements.entries()) {
    const path = `$.evidence_requirements[${index}]`;
    if (!isRecord(value)) {
      issues.push(issue("evidence_requirement_malformed", path, "Every evidence requirement must be an object."));
      continue;
    }
    if (typeof value.id !== "string" || value.id.trim().length === 0) {
      issues.push(issue("evidence_requirement_id_required", `${path}.id`, "Every evidence requirement needs a non-empty id."));
    } else if (seenIds.has(value.id)) {
      issues.push(issue("evidence_requirement_id_duplicate", `${path}.id`, "Evidence requirement ids must be unique."));
    } else {
      seenIds.add(value.id);
    }
    if (typeof value.requirement !== "string" || value.requirement.trim().length === 0) {
      issues.push(issue("evidence_requirement_text_required", `${path}.requirement`, "Every evidence requirement needs exact requirement text."));
    }
    const source = objectAt(value.source, `${path}.source`);
    if (
      source === null ||
      !evidenceSourceKinds.has(String(source.kind)) ||
      typeof source.reference !== "string" ||
      source.reference.trim().length === 0
    ) {
      issues.push(issue("evidence_requirement_source_required", `${path}.source`, "Every evidence requirement needs a supported source kind and reference."));
    }
    if (typeof value.expected_kind !== "string" || value.expected_kind.trim().length === 0) {
      issues.push(issue("evidence_requirement_kind_required", `${path}.expected_kind`, "Every evidence requirement needs a non-empty expected evidence kind."));
    }
    if (value.location !== null && !isRepositoryRelativeLocation(value.location)) {
      issues.push(issue("evidence_requirement_location_invalid", `${path}.location`, "An evidence requirement location must be a repository-relative string or null."));
    }
    if (
      value.required_capability !== undefined &&
      value.required_capability !== null &&
      (typeof value.required_capability !== "string" || value.required_capability.trim().length === 0)
    ) {
      issues.push(issue("evidence_requirement_capability_invalid", `${path}.required_capability`, "A required external capability must be a non-empty string or null."));
    }
    if (!evidenceStatuses.has(String(value.status))) {
      issues.push(issue("evidence_requirement_status_invalid", `${path}.status`, "Evidence requirement status must be satisfied, missing, or blocked."));
    }
    if (
      !Array.isArray(value.evidence) ||
      value.evidence.length === 0 ||
      value.evidence.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
    ) {
      issues.push(issue("evidence_requirement_evidence_required", `${path}.evidence`, "Every evidence requirement outcome needs concrete evidence references."));
    }
    if (payload.status === "passed" && value.status !== "satisfied") {
      issues.push(issue("passed_with_unmet_evidence", path, "A passed ValidationResult requires every explicit evidence requirement to be satisfied."));
    }
  }
  return issues;
};

const isExternalCapabilityReference = (
  value: string,
  expectedType: "skill" | "rule",
): boolean =>
  new RegExp(`^session:${expectedType}:[A-Za-z0-9][A-Za-z0-9._-]*$`).test(value);

const isRepositoryCapabilityReference = (value: string): boolean =>
  value.startsWith("plugin/") && !value.includes("../");

const validateImplementationPlan = (
  payload: Record<string, unknown>,
): InvariantIssue[] => {
  const issues: InvariantIssue[] = [];
  const status = payload.status;
  const failure = payload.failure;
  if (status === "blocked" && failure === null) {
    issues.push(
      issue(
        "blocked_failure_required",
        "$.failure",
        "A blocked ImplementationPlan must preserve structured failure evidence.",
      ),
    );
  }

  const capabilities = objectAt(payload.capabilities, "$.capabilities");
  for (const fieldName of ["required_skills", "applicable_rules"]) {
    for (const [index, value] of arrayAt(
      capabilities?.[fieldName],
      `$.capabilities.${fieldName}`,
    ).entries()) {
      if (typeof value === "string") {
        const expectedType = fieldName === "required_skills" ? "skill" : "rule";
        const validReference =
          isRepositoryCapabilityReference(value) ||
          isExternalCapabilityReference(value, expectedType);
        if (validReference) continue;
        issues.push(
          issue(
            "cross_plugin_capability",
            `$.capabilities.${fieldName}[${index}]`,
            "Capability references must be repository-local plugin paths or exact host-session identities.",
          ),
        );
      }
    }
  }

  const source = objectAt(payload.source, "$.source");
  const versionExpectations: Record<string, number> = {
    loaded_issue_version: 1,
    issue_analysis_version: 1,
    issue_assessment_version: 1,
    affected_areas_version: 1,
    implementation_evaluation_version: 1,
    context_capabilities_version: 1,
    repository_context_version: 1,
    repository_conventions_version: 1,
    branch_workspace_version: 1,
    target_branch_fetch_version: 1,
  };
  for (const [fieldName, expected] of Object.entries(versionExpectations)) {
    const value = source?.[fieldName];
    if (typeof value === "number" && value !== expected) {
      issues.push(
        issue(
          "source_version_mismatch",
          `$.source.${fieldName}`,
          `Expected source version ${expected}, received ${value}.`,
        ),
      );
    }
  }
  return issues;
};

const validateReviewFinding = (
  payload: Record<string, unknown>,
  path = "$",
): InvariantIssue[] => {
  const issues: InvariantIssue[] = [];
  const location = objectAt(payload.location, `${path}.location`);
  if (typeof location?.path !== "string" || location.path.length === 0) {
    issues.push(
      issue(
        "finding_location_required",
        `${path}.location.path`,
        "A ReviewFinding must identify a non-empty repository-relative location.",
      ),
    );
  }
  for (const fieldName of ["evidence", "impact", "recommendation", "verification"]) {
    if (typeof payload[fieldName] !== "string" || payload[fieldName].length === 0) {
      issues.push(
        issue(
          "finding_evidence_required",
          `${path}.${fieldName}`,
          `ReviewFinding.${fieldName} must contain observable review evidence.`,
        ),
      );
    }
  }
  if (
    payload.suggestion !== null &&
    payload.suggestion !== undefined &&
    (typeof payload.suggestion !== "string" || payload.suggestion.length === 0)
  ) {
    issues.push(
      issue(
        "invalid_suggestion",
        `${path}.suggestion`,
        "A suggestion must be a complete non-empty replacement.",
      ),
    );
  }
  return issues;
};

const validateClassifiedFindings = (
  payload: Record<string, unknown>,
): InvariantIssue[] => {
  const issues: InvariantIssue[] = [];
  for (const [index, value] of arrayAt(payload.findings, "$.findings").entries()) {
    if (!isRecord(value)) continue;
    issues.push(...validateReviewFinding(value, `$.findings[${index}]`));
    if (value.severity === "nit") {
      issues.push(
        issue(
          "nit_not_classified",
          `$.findings[${index}].severity`,
          "ClassifiedReviewFindings maps nit to suggestion.",
        ),
      );
    }
    if (
      value.needs_discussion === true &&
      (typeof value.discussion_reason !== "string" ||
        value.discussion_reason.length === 0)
    ) {
      issues.push(
        issue(
          "discussion_reason_required",
          `$.findings[${index}].discussion_reason`,
          "A finding marked for discussion needs a concrete reason.",
        ),
      );
    }
  }
  return issues;
};

const validateValidationResult = (
  payload: Record<string, unknown>,
): InvariantIssue[] => {
  const issues: InvariantIssue[] = validateEvidenceRequirements(payload);
  const checks = arrayAt(payload.checks, "$.checks").filter(isRecord);
  const requiredChecks = checks.filter((check) => check.required === true);
  const requiredChecksPassed = requiredChecks.every(
    (check) => check.result === "pass",
  );
  if (payload.required_checks_passed !== requiredChecksPassed) {
    issues.push(
      issue(
        "required_check_summary_mismatch",
        "$.required_checks_passed",
        "The required check summary must match every required check result.",
      ),
    );
  }

  const evaluation = objectAt(payload.evaluation, "$.evaluation");
  const scope = objectAt(evaluation?.scope, "$.evaluation.scope");
  const criteria = [
    ...arrayAt(evaluation?.acceptance_criteria, "$.evaluation.acceptance_criteria"),
    ...arrayAt(evaluation?.completion_criteria, "$.evaluation.completion_criteria"),
  ].filter(isRecord);
  const criteriaPassed = criteria.every((criterion) => criterion.status === "pass");
  const plannedSteps = arrayAt(evaluation?.planned_steps, "$.evaluation.planned_steps")
    .filter(isRecord);
  const stepsCompleted = plannedSteps.every(
    (step) => step.status === "completed",
  );

  if (payload.status === "passed") {
    if (!requiredChecksPassed) {
      issues.push(
        issue(
          "passed_with_failed_required_check",
          "$.status",
          "A passed ValidationResult requires every required check to pass.",
        ),
      );
    }
    if (scope?.status !== "aligned") {
      issues.push(
        issue(
          "passed_with_unaligned_scope",
          "$.evaluation.scope.status",
          "A passed ValidationResult requires aligned scope evidence.",
        ),
      );
    }
    if (!criteriaPassed) {
      issues.push(
        issue(
          "passed_with_unmet_criteria",
          "$.evaluation",
          "Every acceptance and completion criterion must pass.",
        ),
      );
    }
    if (!stepsCompleted) {
      issues.push(
        issue(
          "passed_with_incomplete_steps",
          "$.evaluation.planned_steps",
          "Every planned implementation step must be completed.",
        ),
      );
    }
  }

  if (payload.status === "blocked" && payload.failure === null) {
    issues.push(
      issue(
        "blocked_failure_required",
        "$.failure",
        "A blocked ValidationResult must preserve structured failure evidence.",
      ),
    );
  }
  return issues;
};

const validateMergeReadiness = (
  payload: Record<string, unknown>,
): InvariantIssue[] => {
  const issues: InvariantIssue[] = [];
  if (payload.status !== "ready") return issues;

  const pullRequest = objectAt(payload.pull_request, "$.pull_request");
  const reviewState = objectAt(payload.review_state, "$.review_state");
  const issueCoverage = objectAt(payload.issue_coverage, "$.issue_coverage");
  const evidence = objectAt(payload.evidence, "$.evidence");
  const checks = arrayAt(payload.checks, "$.checks").filter(isRecord);

  const requiredConditions: Array<[boolean, string, string]> = [
    [
      payload.mergeability === "mergeable",
      "$.mergeability",
      "Ready requires mergeable pull-request state.",
    ],
    [
      pullRequest?.state === "open" && pullRequest.draft === false,
      "$.pull_request",
      "Ready requires an open, non-Draft pull request.",
    ],
    [
      reviewState?.evidence_status === "known" &&
        reviewState.approval_inspection_status === "inspected",
      "$.review_state",
      "Ready requires current review-policy evidence.",
    ],
    [
      issueCoverage?.status !== "ambiguous",
      "$.issue_coverage.status",
      "Ready cannot retain ambiguous issue coverage.",
    ],
    [
      issueCoverage?.status !== "waived" ||
        (isRecord(issueCoverage.waiver) &&
          typeof issueCoverage.waiver.reason === "string" &&
          issueCoverage.waiver.reason.trim().length > 0 &&
          typeof issueCoverage.waiver.source === "string" &&
          issueCoverage.waiver.source.trim().length > 0 &&
          typeof issueCoverage.waiver.evidence === "string" &&
          issueCoverage.waiver.evidence.trim().length > 0),
      "$.issue_coverage.waiver",
      "Ready requires complete waiver evidence when using a waived unique-link condition.",
    ],
    [
      evidence?.status === "complete" &&
        typeof evidence.head_sha === "string" &&
        evidence.head_sha === payload.head_sha &&
        arrayAt(evidence.sources, "$.evidence.sources").length > 0,
      "$.evidence",
      "Ready requires complete evidence tied to the current head.",
    ],
    [
      checks.every(
        (check) => check.required !== true || check.result === "pass",
      ),
      "$.checks",
      "Every required check must pass before readiness is ready.",
    ],
    [
      arrayAt(payload.blockers, "$.blockers").length === 0,
      "$.blockers",
      "Ready cannot retain an actionable blocker.",
    ],
  ];

  for (const [condition, path, message] of requiredConditions) {
    if (!condition) issues.push(issue("ready_condition_unmet", path, message));
  }
  return issues;
};

const validateCleanupResult = (
  payload: Record<string, unknown>,
): InvariantIssue[] => {
  const issues: InvariantIssue[] = [];
  const authorization = objectAt(payload.authorization, "$.authorization");
  for (const [index, value] of arrayAt(payload.actions, "$.actions").entries()) {
    if (!isRecord(value)) continue;
    if (value.action === "remove" && authorization?.explicit !== true) {
      issues.push(
        issue(
          "cleanup_authorization_required",
          `$.actions[${index}]`,
          "Removing a branch or worktree requires explicit cleanup authorization.",
        ),
      );
    }
    if (payload.status === "completed" && value.result !== "pass") {
      issues.push(
        issue(
          "completed_cleanup_unverified",
          `$.actions[${index}].result`,
          "A completed cleanup must verify every executed action.",
        ),
      );
    }
    if (
      value.target === "worktree" &&
      value.action === "remove" &&
      typeof value.identifier === "string" &&
      /primary checkout|primary/i.test(value.identifier)
    ) {
      issues.push(
        issue(
          "primary_checkout_protected",
          `$.actions[${index}].identifier`,
          "The primary checkout is not a default cleanup target.",
        ),
      );
    }
  }
  return issues;
};

const validatePullRequestMerge = (
  payload: Record<string, unknown>,
): InvariantIssue[] => {
  const issues: InvariantIssue[] = [];
  if (payload.status !== "approved" && payload.status !== "merged") {
    return issues;
  }
  const authorization = objectAt(payload.authorization, "$.authorization");
  for (const fieldName of [
    "exact_target",
    "exact_merge_operation",
    "merge_authorized",
  ]) {
    if (authorization?.[fieldName] !== true) {
      issues.push(
        issue(
          "merge_authorization_required",
          `$.authorization.${fieldName}`,
          "Approval or execution requires exact independent merge authorization.",
        ),
      );
    }
  }
  const readiness = objectAt(payload.readiness, "$.readiness");
  if (
    readiness?.schema !== "MergeReadiness" ||
    readiness.version !== 2 ||
    readiness.status !== "ready"
  ) {
    issues.push(
      issue(
        "merge_readiness_mismatch",
        "$.readiness",
        "A merge handoff requires a current version-2 ready MergeReadiness.",
      ),
    );
  }
  const merge = objectAt(payload.merge, "$.merge");
  if (merge?.delete_branch === true && authorization?.delete_branch_authorized !== true) {
    issues.push(
      issue(
        "branch_delete_authorization_required",
        "$.authorization.delete_branch_authorized",
        "Branch deletion requires separate exact authorization.",
      ),
    );
  }
  return issues;
};

const validatePullRequestReady = (
  payload: Record<string, unknown>,
): InvariantIssue[] => {
  const issues: InvariantIssue[] = [];
  if (
    payload.status !== "approved" &&
    payload.status !== "ready" &&
    payload.status !== "partial"
  ) {
    return issues;
  }
  const authorization = objectAt(payload.authorization, "$.authorization");
  for (const fieldName of [
    "exact_target",
    "exact_ready_operation",
    "ready_authorized",
    "reviewers_authorized",
  ]) {
    if (authorization?.[fieldName] !== true) {
      issues.push(
        issue(
          "ready_authorization_required",
          `$.authorization.${fieldName}`,
          "Approval or execution requires exact independent Ready-for-Review authorization.",
        ),
      );
    }
  }
  return issues;
};

const validateProductSubIssuePublication = (
  payload: Record<string, unknown>,
): InvariantIssue[] => {
  const issues: InvariantIssue[] = [];
  const parent = objectAt(payload.parent_issue, "$.parent_issue");
  const parentNumber =
    typeof parent?.number === "number" ? parent.number : null;
  const mapping = arrayAt(payload.mapping, "$.mapping").filter(isRecord);
  const failedOperations = arrayAt(
    payload.failed_operations,
    "$.failed_operations",
  );
  const relationships = objectAt(payload.relationships, "$.relationships");
  const parentLinks = arrayAt(
    relationships?.parent_links,
    "$.relationships.parent_links",
  ).filter(isRecord);
  const dependencies = arrayAt(
    relationships?.dependencies,
    "$.relationships.dependencies",
  ).filter(isRecord);

  for (const [index, entry] of mapping.entries()) {
    if (
      parentNumber !== null &&
      entry.issue_number === parentNumber
    ) {
      issues.push(
        issue(
          "parent_issue_protected",
          `$.mapping[${index}].issue_number`,
          "A published sub-issue must not reuse the parent issue number.",
        ),
      );
    }
  }

  if (payload.status === "published") {
    if (payload.failure !== null) {
      issues.push(
        issue(
          "published_failure_forbidden",
          "$.failure",
          "A published ProductSubIssuePublication must set failure to null.",
        ),
      );
    }
    if (failedOperations.length > 0) {
      issues.push(
        issue(
          "published_failed_operations_forbidden",
          "$.failed_operations",
          "A published result cannot retain failed operations.",
        ),
      );
    }
    if (mapping.length === 0) {
      issues.push(
        issue(
          "published_mapping_required",
          "$.mapping",
          "A published result must map every approved unit to a GitHub issue.",
        ),
      );
    }
    for (const [index, link] of parentLinks.entries()) {
      if (link.status !== "linked" && link.status !== "reused") {
        issues.push(
          issue(
            "published_parent_link_incomplete",
            `$.relationships.parent_links[${index}].status`,
            "A published result requires every parent link to be linked or reused.",
          ),
        );
      }
    }
    for (const [index, dependency] of dependencies.entries()) {
      if (dependency.status !== "linked" && dependency.status !== "reused") {
        issues.push(
          issue(
            "published_dependency_incomplete",
            `$.relationships.dependencies[${index}].status`,
            "A published result requires every hard dependency to be linked or reused.",
          ),
        );
      }
    }
  }

  if (payload.status === "blocked" && mapping.length > 0) {
    issues.push(
      issue(
        "blocked_mapping_forbidden",
        "$.mapping",
        "A blocked result must not report created or reused GitHub issues.",
      ),
    );
  }

  if (payload.failure === null && payload.status !== "published") {
    issues.push(
      issue(
        "failure_required",
        "$.failure",
        "failure may be null only for a published ProductSubIssuePublication.",
      ),
    );
  }

  return issues;
};

export const validateContractInvariants = (
  schemaName: string,
  payload: unknown,
): InvariantIssue[] => {
  if (!isRecord(payload)) return [issue("invalid_shape", "$", "Expected object")];
  switch (schemaName) {
    case "ImplementationPlan":
      return validateImplementationPlan(payload);
    case "ReviewFinding":
      return validateReviewFinding(payload);
    case "DetectedReviewFindings":
      return payload.findings === undefined
        ? []
        : arrayAt(payload.findings, "$.findings")
            .filter(isRecord)
            .flatMap((finding, index) =>
              validateReviewFinding(finding, `$.findings[${index}]`),
            );
    case "DeduplicatedReviewFindings":
      return arrayAt(payload.findings, "$.findings")
        .filter(isRecord)
        .flatMap((finding, index) =>
          validateReviewFinding(finding, `$.findings[${index}]`),
        );
    case "ClassifiedReviewFindings":
      return validateClassifiedFindings(payload);
    case "ValidationResult":
      return validateValidationResult(payload);
    case "MergeReadiness":
      return validateMergeReadiness(payload);
    case "PullRequestMerge":
      return validatePullRequestMerge(payload);
    case "PullRequestReady":
      return validatePullRequestReady(payload);
    case "CleanupResult":
      return validateCleanupResult(payload);
    case "ProductSubIssuePublication":
      return validateProductSubIssuePublication(payload);
    default:
      return [];
  }
};
