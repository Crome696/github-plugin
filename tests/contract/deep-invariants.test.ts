import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { SchemaDocument, readAllSchemas } from "../lib/parse-schema.js";
import { loadFixture } from "../lib/load-fixtures.js";
import {
  InvariantIssue,
  validateContractInvariants,
} from "../lib/contract-invariants.js";
import { validatePayload } from "../lib/validate-payload.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(testDirectory, "..", "..", "plugin");
const schemaDirectory = join(pluginRoot, "shared", "schemas");

let schemas: SchemaDocument[] = [];
let fixtures = new Map<string, unknown>();

const clone = <T>(value: T): T => structuredClone(value);

const schema = (name: string): SchemaDocument => {
  const result = schemas.find((candidate) => candidate.schema === name);
  if (!result) throw new Error(`Missing schema ${name}`);
  return result;
};

const fixture = <T>(name: string): T =>
  clone(fixtures.get(name)) as T;

const expectStructurallyValid = (
  name: string,
  payload: unknown,
): void => {
  const result = validatePayload(schema(name), payload);
  expect(result.issues, name).toEqual([]);
  expect(result.valid, name).toBe(true);
};

const expectInvariant = (
  name: string,
  payload: unknown,
  code: string,
): InvariantIssue[] => {
  const issues = validateContractInvariants(name, payload);
  expect(
    issues.some((candidate) => candidate.code === code),
    `${name} should report ${code}`,
  ).toBe(true);
  return issues;
};

const validFinding = (): Record<string, unknown> => ({
  id: "F-001",
  status: "proposed",
  category: "correctness",
  severity: "major",
  confidence: "high",
  location: {
    path: "src/example.ts",
    start_line: 10,
    end_line: 10,
    side: "RIGHT",
    commit_sha: null,
  },
  evidence: "The changed branch returns an invalid value.",
  impact: "The pull request can produce an invalid result.",
  recommendation: "Guard the branch before returning the value.",
  verification: "Add and run the regression test.",
  sources: ["diff_analysis"],
  needs_discussion: false,
  discussion_reason: null,
  classification_rationale: "The changed branch directly demonstrates the issue.",
  merged_from: [],
  related_threads: [],
});

describe("deep shared-contract invariants", () => {
  beforeAll(async () => {
    schemas = await readAllSchemas(schemaDirectory);
    fixtures = new Map(
      await Promise.all(
        schemas.map(
          async (current) =>
            [current.schema, await loadFixture(current)] as [string, unknown],
        ),
      ),
    );
  });

  it("keeps ImplementationPlan failure, source-version, and capability boundaries explicit", () => {
    const valid = fixture<Record<string, unknown>>("ImplementationPlan");
    expectStructurallyValid("ImplementationPlan", valid);
    expect(validateContractInvariants("ImplementationPlan", valid)).toEqual([]);

    const blocked = clone(valid);
    blocked.status = "blocked";
    blocked.failure = null;
    expectStructurallyValid("ImplementationPlan", blocked);
    expectInvariant("ImplementationPlan", blocked, "blocked_failure_required");

    const foreignCapability = clone(valid);
    const capabilities = foreignCapability.capabilities as Record<string, unknown>;
    capabilities.required_skills = ["plugins/productivity/skills/unknown"];
    expectStructurallyValid("ImplementationPlan", foreignCapability);
    expectInvariant(
      "ImplementationPlan",
      foreignCapability,
      "cross_plugin_capability",
    );

    const externalCapability = clone(valid);
    const externalCapabilities = externalCapability.capabilities as Record<
      string,
      unknown
    >;
    externalCapabilities.required_skills = [
      "session:skill:typescript-implementation",
    ];
    externalCapabilities.applicable_rules = [
      "session:rule:project-testing",
    ];
    expectStructurallyValid("ImplementationPlan", externalCapability);
    expect(validateContractInvariants("ImplementationPlan", externalCapability))
      .toEqual([]);

    const mismatchedSource = clone(valid);
    mismatchedSource.source = {
      task_or_issue: null,
      issue: null,
      loaded_issue_version: 2,
      issue_analysis_version: null,
      issue_assessment_version: null,
      affected_areas_version: null,
      implementation_evaluation_version: null,
      context_capabilities_version: null,
      repository_context_version: null,
      repository_conventions_version: null,
      branch_workspace_version: null,
      target_branch_fetch_version: null,
      references: [],
      unavailable_inputs: [],
    };
    expectStructurallyValid("ImplementationPlan", mismatchedSource);
    expectInvariant(
      "ImplementationPlan",
      mismatchedSource,
      "source_version_mismatch",
    );
  });

  it("keeps ImplementationContext prose-only and scoped to feedback planning", async () => {
    const skillsDirectory = join(pluginRoot, "skills");
    const entries = await readdir(skillsDirectory, { withFileTypes: true });
    const matches: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(skillsDirectory, entry.name, "SKILL.md");
      const source = await readFile(path, "utf8");
      if (source.includes("ImplementationContext")) matches.push(entry.name);
    }

    expect(matches.sort()).toEqual([
      "build-feedback-resolution-plan",
      "resolve-feedback-capabilities",
    ]);
    expect(schemas.map((current) => current.schema)).not.toContain(
      "ImplementationContext",
    );
    for (const name of matches) {
      const source = await readFile(
        join(skillsDirectory, name, "SKILL.md"),
        "utf8",
      );
      expect(source).toMatch(/not a schema|prose/i);
    }
  });

  it("enforces ReviewFinding evidence and nested finding compatibility", () => {
    const finding = fixture<Record<string, unknown>>("ReviewFinding");
    expectStructurallyValid("ReviewFinding", finding);
    expect(validateContractInvariants("ReviewFinding", finding)).toEqual([]);

    const emptyLocation = clone(finding);
    (
      (emptyLocation.location as Record<string, unknown>).path as string
    ) = "";
    expectStructurallyValid("ReviewFinding", emptyLocation);
    expectInvariant("ReviewFinding", emptyLocation, "finding_location_required");

    const detected = fixture<Record<string, unknown>>("DetectedReviewFindings");
    detected.findings = [{ ...validFinding(), evidence: "" }];
    expectStructurallyValid("DetectedReviewFindings", detected);
    expectInvariant(
      "DetectedReviewFindings",
      detected,
      "finding_evidence_required",
    );

    const classified = fixture<Record<string, unknown>>(
      "ClassifiedReviewFindings",
    );
    classified.findings = [validFinding()];
    expectStructurallyValid("ClassifiedReviewFindings", classified);
    expect(validateContractInvariants("ClassifiedReviewFindings", classified))
      .toEqual([]);

    const nit = clone(classified);
    ((nit.findings as Array<Record<string, unknown>>)[0]!).severity = "nit";
    expect(validatePayload(schema("ClassifiedReviewFindings"), nit).valid).toBe(
      false,
    );
    expectInvariant("ClassifiedReviewFindings", nit, "nit_not_classified");

    const discussionWithoutReason = clone(classified);
    const discussionFinding = (
      discussionWithoutReason.findings as Array<Record<string, unknown>>
    )[0]!;
    discussionFinding.needs_discussion = true;
    discussionFinding.discussion_reason = null;
    expectStructurallyValid("ClassifiedReviewFindings", discussionWithoutReason);
    expectInvariant(
      "ClassifiedReviewFindings",
      discussionWithoutReason,
      "discussion_reason_required",
    );
  });

  it("prevents ValidationResult from claiming passed with incomplete evidence", () => {
    const valid = fixture<Record<string, unknown>>("ValidationResult");
    valid.status = "passed";
    valid.checks = [
      {
        id: "test",
        command: "npm test",
        category: "unit",
        result: "pass",
        required: true,
        evidence: "exit code 0",
        exit_code: 0,
      },
    ];
    valid.required_checks_passed = true;
    const evaluation = valid.evaluation as Record<string, unknown>;
    (evaluation.scope as Record<string, unknown>).status = "aligned";
    evaluation.acceptance_criteria = [
      { criterion: "criterion", status: "pass", evidence: ["test"] },
    ];
    evaluation.completion_criteria = [
      { criterion: "completion", status: "pass", evidence: ["test"] },
    ];
    evaluation.planned_steps = [
      { id: "step-1", status: "completed", evidence: ["test"] },
    ];
    expectStructurallyValid("ValidationResult", valid);
    expect(validateContractInvariants("ValidationResult", valid)).toEqual([]);

    const failedCheck = clone(valid);
    (failedCheck.checks as Array<Record<string, unknown>>)[0]!.result = "fail";
    failedCheck.required_checks_passed = false;
    expectStructurallyValid("ValidationResult", failedCheck);
    expectInvariant(
      "ValidationResult",
      failedCheck,
      "passed_with_failed_required_check",
    );

    const summaryMismatch = clone(valid);
    summaryMismatch.required_checks_passed = false;
    expectStructurallyValid("ValidationResult", summaryMismatch);
    expectInvariant(
      "ValidationResult",
      summaryMismatch,
      "required_check_summary_mismatch",
    );

    const drift = clone(valid);
    (drift.evaluation as Record<string, unknown>).scope = {
      status: "drift",
      evidence: ["foreign path"],
    };
    expectStructurallyValid("ValidationResult", drift);
    expectInvariant("ValidationResult", drift, "passed_with_unaligned_scope");

    const blocked = clone(valid);
    blocked.status = "blocked";
    blocked.failure = null;
    expectStructurallyValid("ValidationResult", blocked);
    expectInvariant("ValidationResult", blocked, "blocked_failure_required");

    const explicitMissing = clone(valid);
    explicitMissing.evidence_requirements = [
      {
        id: "settings-ui",
        requirement: "Provide the settings UI screenshot.",
        source: { kind: "issue", reference: "issue:42" },
        expected_kind: "ui_screenshot",
        location: "docs/ui/settings.png",
        status: "missing",
        evidence: ["The declared evidence location is absent."],
      },
    ];
    expectStructurallyValid("ValidationResult", explicitMissing);
    expectInvariant(
      "ValidationResult",
      explicitMissing,
      "passed_with_unmet_evidence",
    );

    const legacy = clone(valid);
    legacy.version = 1;
    expect(validatePayload(schema("ValidationResult"), legacy).valid).toBe(
      false,
    );

    const missingRequirements = clone(valid);
    delete missingRequirements.evidence_requirements;
    expect(
      validatePayload(schema("ValidationResult"), missingRequirements).valid,
    ).toBe(false);
  });

  it("requires current evidence before MergeReadiness can be ready", () => {
    const valid = fixture<Record<string, unknown>>("MergeReadiness");
    valid.status = "ready";
    valid.head_sha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    valid.mergeability = "mergeable";
    valid.pull_request = {
      number: 42,
      url: "https://github.com/octo-org/widgets/pull/42",
      state: "open",
      draft: false,
    };
    valid.checks = [
      {
        name: "required-test",
        result: "pass",
        required: true,
        evidence: "head check passed",
        head_sha: valid.head_sha,
      },
    ];
    valid.review_state = {
      approval_count: 1,
      change_request_count: 0,
      comment_count: 0,
      required_approvals_met: true,
      required_approvals: 1,
      unresolved_threads: 0,
      outdated_threads: 0,
      evidence_status: "known",
      approval_inspection_status: "inspected",
      approval_policy_evidence: ["branch protection"],
      evidence: ["approval inspected"],
    };
    valid.issue_coverage = {
      status: "covered",
      issue: {
        repository: "octo-org/widgets",
        number: 1,
        url: "https://github.com/octo-org/widgets/issues/1",
      },
      evidence: ["explicit issue link"],
      acceptance_criteria: [],
      unavailable_reason: null,
    };
    valid.evidence = {
      head_sha: valid.head_sha,
      status: "complete",
      sources: [
        {
          name: "pull_request",
          status: "loaded",
          evidence: ["current head"],
          unavailable_reason: null,
        },
      ],
    };
    valid.blockers = [];
    expectStructurallyValid("MergeReadiness", valid);
    expect(validateContractInvariants("MergeReadiness", valid)).toEqual([]);

    const unknownMergeability = clone(valid);
    unknownMergeability.mergeability = "unknown";
    expectStructurallyValid("MergeReadiness", unknownMergeability);
    expectInvariant(
      "MergeReadiness",
      unknownMergeability,
      "ready_condition_unmet",
    );

    const unavailableEvidence = clone(valid);
    (unavailableEvidence.evidence as Record<string, unknown>).status =
      "unavailable";
    expectStructurallyValid("MergeReadiness", unavailableEvidence);
    expectInvariant(
      "MergeReadiness",
      unavailableEvidence,
      "ready_condition_unmet",
    );

    const failedRequiredCheck = clone(valid);
    (failedRequiredCheck.checks as Array<Record<string, unknown>>)[0]!.result =
      "fail";
    expectStructurallyValid("MergeReadiness", failedRequiredCheck);
    expectInvariant(
      "MergeReadiness",
      failedRequiredCheck,
      "ready_condition_unmet",
    );
  });

  it("keeps MergeReadiness diagnostic and merge authorization separate", () => {
    const merge = fixture<Record<string, unknown>>("PullRequestMerge");
    merge.status = "approved";
    expectStructurallyValid("PullRequestMerge", merge);
    expectInvariant("PullRequestMerge", merge, "merge_authorization_required");

    const authorized = clone(merge);
    const authorization = authorized.authorization as Record<string, unknown>;
    authorization.exact_target = true;
    authorization.exact_merge_operation = true;
    authorization.merge_authorized = true;
    authorization.delete_branch_authorized = false;
    const readiness = authorized.readiness as Record<string, unknown>;
    readiness.schema = "MergeReadiness";
    readiness.version = 2;
    readiness.status = "ready";
    expect(validateContractInvariants("PullRequestMerge", authorized)).toEqual([]);
  });

  it("keeps CleanupResult authorization and recoverable targets fail-closed", () => {
    const cleanup = fixture<Record<string, unknown>>("CleanupResult");
    cleanup.status = "completed";
    cleanup.actions = [
      {
        target: "worktree",
        identifier: "C:/worktrees/github",
        action: "remove",
        result: "pass",
        evidence: "path removed and unregistered",
        reason: null,
      },
    ];
    expectStructurallyValid("CleanupResult", cleanup);
    expectInvariant(
      "CleanupResult",
      cleanup,
      "cleanup_authorization_required",
    );

    const authorized = clone(cleanup);
    (authorized.authorization as Record<string, unknown>).explicit = true;
    expect(validateContractInvariants("CleanupResult", authorized)).toEqual([]);

    const primary = clone(authorized);
    (primary.actions as Array<Record<string, unknown>>)[0]!.identifier =
      "primary checkout";
    expectInvariant("CleanupResult", primary, "primary_checkout_protected");

    const unverified = clone(authorized);
    (unverified.actions as Array<Record<string, unknown>>)[0]!.result = "unknown";
    expectStructurallyValid("CleanupResult", unverified);
    expectInvariant(
      "CleanupResult",
      unverified,
      "completed_cleanup_unverified",
    );
  });

  it("keeps ProductSubIssuePublication mapping, parent protection, and published completeness fail-closed", () => {
    const valid = fixture<Record<string, unknown>>("ProductSubIssuePublication");
    expectStructurallyValid("ProductSubIssuePublication", valid);
    expect(validateContractInvariants("ProductSubIssuePublication", valid)).toEqual(
      [],
    );

    const parentMapped = clone(valid);
    (parentMapped.mapping as Array<Record<string, unknown>>)[0]!.issue_number =
      123;
    expectStructurallyValid("ProductSubIssuePublication", parentMapped);
    expectInvariant(
      "ProductSubIssuePublication",
      parentMapped,
      "parent_issue_protected",
    );

    const publishedFailure = clone(valid);
    publishedFailure.failure = {
      code: "create_failure",
      message: "A create did not complete.",
      phase: "create",
      retryable: true,
      evidence: ["create-github-issue returned partial"],
    };
    expectStructurallyValid("ProductSubIssuePublication", publishedFailure);
    expectInvariant(
      "ProductSubIssuePublication",
      publishedFailure,
      "published_failure_forbidden",
    );

    const incompleteLink = clone(valid);
    (
      (incompleteLink.relationships as Record<string, unknown>)
        .parent_links as Array<Record<string, unknown>>
    )[0]!.status = "failed";
    expectStructurallyValid("ProductSubIssuePublication", incompleteLink);
    expectInvariant(
      "ProductSubIssuePublication",
      incompleteLink,
      "published_parent_link_incomplete",
    );

    const blocked = clone(valid);
    blocked.status = "blocked";
    blocked.mapping = [];
    blocked.relationships = { parent_links: [], dependencies: [] };
    blocked.failure = {
      code: "approval_missing",
      message: "Exact-set approval is absent.",
      phase: "input",
      retryable: false,
      evidence: ["ProductPlannerRun.authorization.publication_authorized is false"],
    };
    expectStructurallyValid("ProductSubIssuePublication", blocked);
    expect(validateContractInvariants("ProductSubIssuePublication", blocked)).toEqual(
      [],
    );

    const blockedWithMapping = clone(blocked);
    blockedWithMapping.mapping = (valid.mapping as unknown[]).slice();
    expectStructurallyValid("ProductSubIssuePublication", blockedWithMapping);
    expectInvariant(
      "ProductSubIssuePublication",
      blockedWithMapping,
      "blocked_mapping_forbidden",
    );

    const partialWithoutFailure = clone(valid);
    partialWithoutFailure.status = "partial";
    expectStructurallyValid("ProductSubIssuePublication", partialWithoutFailure);
    expectInvariant(
      "ProductSubIssuePublication",
      partialWithoutFailure,
      "failure_required",
    );
  });
});
