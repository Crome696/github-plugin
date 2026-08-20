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

const isFullSha = (value: unknown): value is string =>
  typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));

const isNonEmptyStringList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((entry) => typeof entry === "string" && entry.trim().length > 0);

const normalizeSnapshotUrl = (value: unknown): string | null =>
  typeof value === "string" ? value.replace(/\/+$/, "").toLowerCase() : null;

const validatePullRequestReadinessEvidence = (
  payload: Record<string, unknown>,
): InvariantIssue[] => {
  const issues: InvariantIssue[] = [];
  const requiredSourceNames = [
    "load-pull-request",
    "load-pr-discussions",
    "inspect-pr-checks",
    "check-required-approvals",
    "check-open-review-threads",
    "check-linked-issue-status",
  ];

  if (payload.schema !== "PullRequestReadinessEvidence" || payload.version !== 1) {
    issues.push(
      issue(
        "snapshot_version_mismatch",
        "$",
        "Readiness evidence must use PullRequestReadinessEvidence version 1.",
      ),
    );
  }
  if (payload.status !== "complete") {
    issues.push(
      issue(
        "snapshot_not_complete",
        "$.status",
        "Only a complete readiness evidence snapshot can be consumed by merge readiness.",
      ),
    );
    return issues;
  }

  const pullRequest = objectAt(payload.pull_request, "$.pull_request");
  const base = objectAt(payload.base, "$.base");
  const freshness = objectAt(payload.freshness, "$.freshness");
  const policy = objectAt(payload.policy, "$.policy");
  const requiredChecks = objectAt(policy?.required_checks, "$.policy.required_checks");
  const approvals = objectAt(policy?.approvals, "$.policy.approvals");
  const discussions = objectAt(payload.discussions, "$.discussions");
  const linkedIssue = objectAt(payload.linked_issue, "$.linked_issue");
  const mergeMethods = objectAt(payload.merge_methods, "$.merge_methods");
  const snapshotIdentity = {
    repository: payload.repository,
    number: pullRequest?.number,
    nodeId: pullRequest?.node_id,
    url: pullRequest?.url,
    headSha: payload.head_sha,
    baseBranch: base?.name,
    baseSha: base?.oid,
  };

  if (
    typeof payload.repository !== "string" ||
    payload.repository.trim().length === 0 ||
    !isRecord(pullRequest) ||
    !isNonNegativeInteger(pullRequest.number) ||
    pullRequest.number < 1 ||
    typeof pullRequest.node_id !== "string" ||
    pullRequest.node_id.trim().length === 0 ||
    typeof pullRequest.url !== "string" ||
    normalizeSnapshotUrl(pullRequest.url) === null ||
    pullRequest.state !== "open" ||
    pullRequest.draft !== false ||
    !isFullSha(payload.head_sha) ||
    !isRecord(base) ||
    typeof base.name !== "string" ||
    base.name.trim().length === 0 ||
    !isFullSha(base.oid) ||
    !isIsoTimestamp(payload.observed_at) ||
    !isRecord(freshness) ||
    freshness.status !== "current" ||
    !isNonEmptyStringList(freshness.evidence)
  ) {
    issues.push(
      issue(
        "snapshot_identity_incomplete",
        "$",
        "A complete snapshot must carry one canonical PR, head, base, observation, and current-freshness identity.",
      ),
    );
  }
  if (freshness !== null && freshness.status !== "current") {
    issues.push(
      issue(
        "snapshot_stale",
        "$.freshness.status",
        "A complete snapshot must explicitly prove current freshness.",
      ),
    );
  }

  if (payload.failure !== null) {
    issues.push(
      issue(
        "snapshot_failure_present",
        "$.failure",
        "A complete readiness evidence snapshot cannot retain a failure object.",
      ),
    );
  }

  const sources = arrayAt(payload.sources, "$.sources").filter(isRecord);
  const sourceNames = new Set<string>();
  if (sources.length === 0) {
    issues.push(
      issue(
        "snapshot_sources_incomplete",
        "$.sources",
        "A complete snapshot must preserve every reader source and its provenance.",
      ),
    );
  }
  for (const [index, source] of sources.entries()) {
    const path = `$.sources[${index}]`;
    const identity = objectAt(source.identity, `${path}.identity`);
    const pagination = objectAt(source.pagination, `${path}.pagination`);
    if (typeof source.name !== "string" || source.name.trim().length === 0 || sourceNames.has(source.name)) {
      issues.push(issue("snapshot_source_identity_invalid", `${path}.name`, "Snapshot source names must be non-empty and unique."));
    } else {
      sourceNames.add(source.name);
    }
    if (!["loaded", "empty"].includes(String(source.status))) {
      issues.push(issue("snapshot_source_unavailable", `${path}.status`, "Partial or unavailable sources cannot be part of a complete snapshot."));
    }
    if (
      !isRecord(identity) ||
      identity.repository !== snapshotIdentity.repository ||
      identity.number !== snapshotIdentity.number ||
      identity.node_id !== snapshotIdentity.nodeId ||
      normalizeSnapshotUrl(identity.url) !== normalizeSnapshotUrl(snapshotIdentity.url) ||
      typeof identity.head_sha !== "string" ||
      identity.head_sha.toLowerCase() !== String(snapshotIdentity.headSha).toLowerCase() ||
      identity.base_branch !== snapshotIdentity.baseBranch ||
      typeof identity.base_sha !== "string" ||
      identity.base_sha.toLowerCase() !== String(snapshotIdentity.baseSha).toLowerCase()
    ) {
      issues.push(issue("snapshot_mixed_identity", `${path}.identity`, "Every source must bind to the exact snapshot repository, PR node, head, and base."));
    }
    if (
      !isIsoTimestamp(source.retrieved_at) ||
      !isRecord(pagination) ||
      pagination.complete !== true ||
      !isNonNegativeInteger(pagination.page_count) ||
      !isNonEmptyStringList(source.provenance) ||
      !isNonEmptyStringList(source.evidence)
    ) {
      issues.push(issue("snapshot_source_incomplete", path, "Every source must carry retrieval, pagination, provenance, and evidence details."));
    }
  }
  for (const name of requiredSourceNames) {
    if (!sourceNames.has(name)) {
      issues.push(issue("snapshot_source_missing", "$.sources", `The fixed readiness chain is missing ${name}.`));
    }
  }

  if (
    !isRecord(policy) ||
    !["loaded", "empty"].includes(String(policy.status)) ||
    !Array.isArray(policy.sources) ||
    (policy.status === "loaded" && policy.sources.length === 0) ||
    !isNonEmptyStringList(policy.evidence) ||
    !isRecord(requiredChecks) ||
    !["loaded", "empty"].includes(String(requiredChecks.status)) ||
    !Array.isArray(requiredChecks.checks) ||
    !isNonEmptyStringList(requiredChecks.evidence) ||
    !isRecord(approvals) ||
    !["loaded", "empty"].includes(String(approvals.status)) ||
    !isNonNegativeInteger(approvals.required_approvals) ||
    !Array.isArray(approvals.approvals) ||
    !Array.isArray(approvals.dismissals) ||
    !Array.isArray(approvals.change_requests) ||
    !isNonEmptyStringList(approvals.evidence)
  ) {
    issues.push(issue("snapshot_policy_unavailable", "$.policy", "Complete evidence must distinguish retrieved-empty policy from unavailable policy."));
  }
  if (
    Array.isArray(policy?.sources) &&
    policy.sources.some(
      (source) =>
        !isRecord(source) ||
        !isNonEmptyStringList(source.provenance) ||
        !isNonEmptyStringList(source.evidence) ||
        !["loaded", "empty"].includes(String(source.status)),
    )
  ) {
    issues.push(issue("snapshot_policy_provenance_incomplete", "$.policy.sources", "Every policy source must be loaded or validly empty with provenance."));
  }

  if (
    !isRecord(discussions) ||
    !["loaded", "empty"].includes(String(discussions.status)) ||
    !isRecord(discussions.pagination) ||
    discussions.pagination.complete !== true ||
    !Number.isInteger(discussions.pagination.page_count) ||
    !isNonEmptyStringList(discussions.pagination.evidence) ||
    !Array.isArray(discussions.threads) ||
    !isNonEmptyStringList(discussions.evidence)
  ) {
    issues.push(issue("snapshot_threads_incomplete", "$.discussions", "Complete evidence requires fully paginated discussion data."));
  } else {
    for (const [index, thread] of discussions.threads.entries()) {
      if (
        !isRecord(thread) ||
        typeof thread.id !== "string" ||
        thread.id.trim().length === 0 ||
        !["open", "resolved", "unknown"].includes(String(thread.state)) ||
        typeof thread.is_resolved !== "boolean" ||
        typeof thread.is_outdated !== "boolean" ||
        !["blocking", "nonblocking", "uncertain"].includes(String(thread.disposition)) ||
        !isNonEmptyStringList(thread.evidence)
      ) {
        issues.push(issue("snapshot_thread_disposition_uncertain", `$.discussions.threads[${index}]`, "Every thread needs evidence-backed resolution, currentness, and disposition."));
      }
    }
  }

  if (
    !isRecord(linkedIssue) ||
    !["covered", "waived"].includes(String(linkedIssue.status)) ||
    !isNonEmptyStringList(linkedIssue.evidence)
  ) {
    issues.push(issue("snapshot_linked_issue_unavailable", "$.linked_issue", "Complete evidence requires covered or explicitly waived linked-issue evidence."));
  } else if (linkedIssue.status === "covered") {
    const linked = objectAt(linkedIssue.issue, "$.linked_issue.issue");
    if (
      linked === null ||
      typeof linked.repository !== "string" ||
      !isNonNegativeInteger(linked.number) ||
      linked.number < 1 ||
      typeof linked.url !== "string"
    ) {
      issues.push(issue("snapshot_linked_issue_ambiguous", "$.linked_issue.issue", "Covered linked-issue evidence must identify one exact issue."));
    }
  } else {
    const waiver = objectAt(linkedIssue.waiver, "$.linked_issue.waiver");
    if (
      !isRecord(waiver) ||
      typeof waiver.reason !== "string" ||
      waiver.reason.trim().length === 0 ||
      typeof waiver.source !== "string" ||
      waiver.source.trim().length === 0 ||
      typeof waiver.evidence !== "string" ||
      waiver.evidence.trim().length === 0
    ) {
      issues.push(issue("snapshot_linked_issue_waiver_incomplete", "$.linked_issue.waiver", "Waived linked-issue evidence must preserve a reason, source, and evidence."));
    }
  }

  if (
    !isRecord(mergeMethods) ||
    !["loaded", "empty", "not_used"].includes(String(mergeMethods.status)) ||
    !Array.isArray(mergeMethods.allowed) ||
    !isNonEmptyStringList(mergeMethods.evidence)
  ) {
    issues.push(issue("snapshot_merge_method_incomplete", "$.merge_methods", "Merge-method evidence must be complete when readiness uses it and explicitly not_used otherwise."));
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
  const readinessEvidence = objectAt(
    payload.readiness_evidence,
    "$.readiness_evidence",
  );
  issues.push(
    ...validatePullRequestReadinessEvidence(readinessEvidence ?? {}),
  );

  const snapshotPullRequest = objectAt(
    readinessEvidence?.pull_request,
    "$.readiness_evidence.pull_request",
  );
  const snapshotBase = objectAt(
    readinessEvidence?.base,
    "$.readiness_evidence.base",
  );
  const snapshotDiscussions = objectAt(
    readinessEvidence?.discussions,
    "$.readiness_evidence.discussions",
  );
  const snapshotThreads = arrayAt(
    snapshotDiscussions?.threads,
    "$.readiness_evidence.discussions.threads",
  ).filter(isRecord);

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
    [
      readinessEvidence?.schema === "PullRequestReadinessEvidence" &&
        readinessEvidence.version === 1 &&
        readinessEvidence.status === "complete" &&
        readinessEvidence.repository === payload.repository &&
        snapshotPullRequest?.number === pullRequest?.number &&
        normalizeSnapshotUrl(snapshotPullRequest?.url) ===
          normalizeSnapshotUrl(pullRequest?.url) &&
        typeof readinessEvidence.head_sha === "string" &&
        readinessEvidence.head_sha === payload.head_sha &&
        snapshotBase?.name === payload.base_branch,
      "$.readiness_evidence",
      "Ready requires one complete snapshot bound to the same pull-request, head, and base branch.",
    ],
    [
      snapshotThreads.every(
        (thread) =>
          thread.is_resolved === true || thread.disposition === "nonblocking",
      ),
      "$.readiness_evidence.discussions.threads",
      "Ready cannot retain an unresolved blocking or uncertain review thread.",
    ],
    [
      issueCoverage?.status !== "covered" ||
        (isRecord(issueCoverage.issue) &&
          isRecord(readinessEvidence?.linked_issue) &&
          readinessEvidence.linked_issue.status === "covered" &&
          isRecord(readinessEvidence.linked_issue.issue) &&
          issueCoverage.issue.repository === readinessEvidence.linked_issue.issue.repository &&
          issueCoverage.issue.number === readinessEvidence.linked_issue.issue.number &&
          normalizeSnapshotUrl(issueCoverage.issue.url) ===
            normalizeSnapshotUrl(readinessEvidence.linked_issue.issue.url)),
      "$.readiness_evidence.linked_issue",
      "Ready requires the embedded linked-issue evidence to match the diagnostic issue coverage.",
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
    readiness.version !== 3 ||
    readiness.status !== "ready"
  ) {
    issues.push(
      issue(
        "merge_readiness_mismatch",
        "$.readiness",
        "A merge handoff requires a current version-3 ready MergeReadiness with one complete readiness snapshot.",
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
  const pullRequest = objectAt(payload.pull_request, "$.pull_request");
  const preflight = objectAt(payload.preflight, "$.preflight");
  const expectedHead = payload.expected_head_sha;
  const expectedBase = payload.expected_base_sha;
  const requiredPassFields = [
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
  ];
  if (
    !isRecord(pullRequest) ||
    !isRecord(preflight) ||
    !isFullSha(expectedHead) ||
    !isFullSha(expectedBase) ||
    preflight.repository !== payload.repository ||
    preflight.pull_request_number !== pullRequest.number ||
    preflight.pull_request_url !== pullRequest.url ||
    preflight.head_branch !== pullRequest.head_branch ||
    preflight.base_branch !== pullRequest.base_branch ||
    !isFullSha(preflight.live_head_sha) ||
    preflight.live_head_sha.toLowerCase() !== expectedHead.toLowerCase() ||
    !isFullSha(preflight.live_base_sha) ||
    preflight.live_base_sha.toLowerCase() !== expectedBase.toLowerCase()
  ) {
    issues.push(
      issue(
        "merge_preflight_identity_mismatch",
        "$.preflight",
        "An approved PullRequestMerge must carry the exact final live preflight identity.",
      ),
    );
  }
  for (const field of requiredPassFields) {
    if (preflight?.[field] !== "pass") {
      issues.push(
        issue(
          "merge_preflight_not_pass",
          `$.preflight.${field}`,
          "Every final live PullRequestMerge preflight condition must be pass.",
        ),
      );
    }
  }
  if (!isNonEmptyStringList(preflight?.evidence)) {
    issues.push(
      issue(
        "merge_preflight_evidence_missing",
        "$.preflight.evidence",
        "The final live PullRequestMerge preflight must preserve non-empty evidence.",
      ),
    );
  }
  return issues;
};

const lifecycleOperations = new Set([
  "pre-commit",
  "pre-pr-create",
  "pre-review-submit",
  "pre-rebase-start",
  "pre-rebase-continue",
  "pre-rebase-skip",
  "pre-rebase-abort",
  "pre-pr-ready",
  "pre-reviewer-request",
  "pre-merge",
]);

const validateGateLifecycle = (
  payload: Record<string, unknown>,
  expectedOperations: string[],
): InvariantIssue[] => {
  const issues: InvariantIssue[] = [];
  const lifecycle = objectAt(payload.lifecycle, "$.lifecycle");
  const path = "$.lifecycle";
  const issuedAt = typeof lifecycle?.issued_at === "string" ? Date.parse(lifecycle.issued_at) : Number.NaN;
  const expiresAt = typeof lifecycle?.expires_at === "string" ? Date.parse(lifecycle.expires_at) : Number.NaN;
  if (
    lifecycle?.schema !== "GateLifecycle" ||
    lifecycle.version !== 1 ||
    !lifecycleOperations.has(String(lifecycle.operation)) ||
    !expectedOperations.includes(String(lifecycle.operation)) ||
    typeof lifecycle.nonce !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(lifecycle.nonce) ||
    lifecycle.state !== "authority" ||
    lifecycle.authorizes !== true ||
    lifecycle.consumed_at !== null ||
    lifecycle.receipt_expires_at !== null ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt - issuedAt !== 5 * 60 * 1000
  ) {
    issues.push(
      issue(
        "gate_lifecycle_invalid",
        path,
        "Every authorizing gate must carry one exact GateLifecycle authority with a five-minute TTL and an unconsumed nonce.",
      ),
    );
  }
  return issues;
};

const validatePreMergeGate = (
  payload: Record<string, unknown>,
): InvariantIssue[] => {
  const issues: InvariantIssue[] = [];
  if (payload.schema !== "PreMergeGate" || payload.version !== 4) {
    issues.push(
      issue(
        "premerge_gate_version_mismatch",
        "$.version",
        "A merge gate must use PreMergeGate version 4 with a final live preflight and lifecycle authority.",
      ),
    );
  }

  const pullRequest = objectAt(payload.pull_request, "$.pull_request");
  const workspace = objectAt(payload.workspace, "$.workspace");
  const preflight = objectAt(payload.preflight, "$.preflight");
  const expectedHead = payload.expected_head_sha;
  const expectedBase = payload.expected_base_sha;
  if (
    !isFullSha(expectedHead) ||
    !isFullSha(expectedBase) ||
    !isRecord(pullRequest) ||
    typeof pullRequest.base_branch !== "string" ||
    !isRecord(preflight)
  ) {
    issues.push(
      issue(
        "premerge_preflight_incomplete",
        "$.preflight",
        "PreMergeGate v4 must bind one complete live preflight to the exact PR and head/base revisions.",
      ),
    );
    return issues;
  }

  if (
    !isIsoTimestamp(preflight.checked_at) ||
    typeof preflight.repository !== "string" ||
    preflight.repository !== workspace?.repository ||
    preflight.pull_request_number !== pullRequest.number ||
    typeof preflight.pull_request_url !== "string" ||
    preflight.pull_request_url !== pullRequest.url ||
    preflight.head_branch !== pullRequest.head_branch ||
    !isFullSha(preflight.live_head_sha) ||
    preflight.live_head_sha.toLowerCase() !== expectedHead.toLowerCase() ||
    !isFullSha(preflight.live_base_sha) ||
    preflight.live_base_sha.toLowerCase() !== expectedBase.toLowerCase() ||
    preflight.base_branch !== pullRequest.base_branch
  ) {
    issues.push(
      issue(
        "premerge_preflight_identity_mismatch",
        "$.preflight",
        "The final preflight must carry the exact live repository, PR, branches, head, base, and base branch from the gate identity.",
      ),
    );
  }

  const requiredPassFields = [
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
  ];
  for (const field of requiredPassFields) {
    if (preflight[field] !== "pass") {
      issues.push(
        issue(
          "premerge_preflight_not_pass",
          `$.preflight.${field}`,
          "Every final live merge preflight condition must be pass before the gate is consumed.",
        ),
      );
    }
  }
  if (!isNonEmptyStringList(preflight.evidence)) {
    issues.push(
      issue(
        "premerge_preflight_evidence_missing",
        "$.preflight.evidence",
        "The final preflight must preserve non-empty source and provenance evidence.",
      ),
    );
  }

  const readiness = objectAt(payload.readiness, "$.readiness");
  if (
    readiness?.schema !== "MergeReadiness" ||
    readiness.version !== 3 ||
    readiness.status !== "ready" ||
    !isFullSha(readiness.head_sha) ||
    readiness.head_sha.toLowerCase() !== expectedHead.toLowerCase()
  ) {
    issues.push(
      issue(
        "premerge_readiness_mismatch",
        "$.readiness",
        "PreMergeGate v4 must carry current version-3 ready MergeReadiness bound to the expected head.",
      ),
    );
  }
  const observedAt = objectAt(
    objectAt(payload.readiness, "$.readiness")?.readiness_evidence,
    "$.readiness.readiness_evidence",
  )?.observed_at;
  if (
    isIsoTimestamp(preflight.checked_at) &&
    isIsoTimestamp(payload.written_at) &&
    isIsoTimestamp(observedAt)
  ) {
    if (Date.parse(preflight.checked_at) < Date.parse(observedAt)) {
      issues.push(
        issue(
          "premerge_preflight_before_snapshot",
          "$.preflight.checked_at",
          "The final preflight must be captured after the embedded readiness snapshot.",
        ),
      );
    }
    if (Date.parse(preflight.checked_at) > Date.parse(payload.written_at)) {
      issues.push(
        issue(
          "premerge_preflight_after_gate",
          "$.preflight.checked_at",
          "The gate must be written immediately after, not before, its final preflight.",
        ),
      );
    }
    if (Date.parse(preflight.checked_at) - Date.parse(observedAt) > 60_000) {
      issues.push(
        issue(
          "premerge_preflight_snapshot_stale",
          "$.preflight.checked_at",
          "The final preflight may not reuse a readiness snapshot outside the freshness window.",
        ),
      );
    }
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
    case "PullRequestReadinessEvidence":
      return validatePullRequestReadinessEvidence(payload);
    case "MergeReadiness":
      return validateMergeReadiness(payload);
    case "PullRequestMerge":
      return validatePullRequestMerge(payload);
    case "GateLifecycle":
      return validateGateLifecycle(
        { lifecycle: payload },
        [...lifecycleOperations],
      );
    case "PreCommitGate":
      return validateGateLifecycle(payload, ["pre-commit"]);
    case "PrePrCreateGate":
      return validateGateLifecycle(payload, ["pre-pr-create"]);
    case "PreReviewSubmitGate":
      return validateGateLifecycle(payload, ["pre-review-submit"]);
    case "PreRebaseGate":
      return validateGateLifecycle(payload, [
        "pre-rebase-start",
        "pre-rebase-continue",
        "pre-rebase-skip",
        "pre-rebase-abort",
      ]);
    case "PrePrReadyGate":
      return validateGateLifecycle(payload, ["pre-pr-ready", "pre-reviewer-request"]);
    case "PreMergeGate":
      return [
        ...validateGateLifecycle(payload, ["pre-merge"]),
        ...validatePreMergeGate(payload),
      ];
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
