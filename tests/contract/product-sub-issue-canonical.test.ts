import { beforeAll, describe, expect, it } from "vitest";
import { loadFixture } from "../lib/load-fixtures.js";
import { productSubIssueDigest } from "../lib/product-sub-issue-digest.js";
import { evaluateWriteGate, GateContext } from "../scenarios/lib/write-gates.js";
import { ScenarioDefinition } from "../scenarios/lib/scenario-types.js";

type Payload = Record<string, any>;

const clone = <T>(value: T): T => structuredClone(value);

let draftFixture: Payload;
let plannerFixture: Payload;

const baseScenario = (): ScenarioDefinition => ({
  id: "canonical-draft-gate",
  command: "plan-product",
  description: "canonical draft publication gate",
  expected: {
    status: "completed",
    successful_writes: [],
    preserved_artifacts: [],
  },
  target: {
    repository: "octo-org/widgets",
    issue_number: 123,
    exact: true,
  },
  facts: {},
  authorizations: {
    routine: true,
    issue_publication: true,
  },
  handoffs: {},
  actions: [],
});

const approvedContext = (
  drafts: Payload = clone(draftFixture),
  planner: Payload = clone(plannerFixture),
): GateContext => ({
  scenario: baseScenario(),
  handoffs: new Map([
    ["ProductSubIssueDrafts", drafts],
    ["ProductPlannerRun", planner],
  ]),
  successfulWrites: new Set(),
  completedOperations: new Set(["product-planner-agent"]),
});

const publicationAction = {
  operation: "create-product-sub-issues",
  effect: "write" as const,
};

const gate = (drafts: Payload, planner: Payload = clone(plannerFixture)) =>
  evaluateWriteGate(approvedContext(drafts, planner), publicationAction);

const approvePlanner = (planner: Payload): Payload => {
  planner.status = "publication_handed_off";
  planner.authorization.exact_payload = true;
  planner.authorization.exact_set = true;
  planner.authorization.publication_authorized = true;
  planner.authorization.canonical_set_digest =
    planner.canonical_set.digest;
  return planner;
};

describe("ProductSubIssueDrafts v2 canonical identity", () => {
  beforeAll(async () => {
    draftFixture = (await loadFixture({
      schema: "ProductSubIssueDrafts",
      version: 2,
      description: "fixture",
      required: [],
      fields: {},
      invariants: [],
      path: "",
    })) as Payload;
    plannerFixture = (await loadFixture({
      schema: "ProductPlannerRun",
      version: 2,
      description: "fixture",
      required: [],
      fields: {},
      invariants: [],
      path: "",
    })) as Payload;
    approvePlanner(plannerFixture);
  });

  it("allows only the unchanged approved canonical set", () => {
    const result = gate(clone(draftFixture));
    expect(result.allowed).toBe(true);
    expect(result.code).toBe("allowed");
  });

  it.each([
    ["unit ID", (draft: Payload) => { draft.drafts[0].unit_id = "unit-mutated"; }],
    ["title", (draft: Payload) => { draft.drafts[0].title += " (changed)"; }],
    ["body", (draft: Payload) => { draft.drafts[0].body += "\nChanged."; }],
    ["label addition", (draft: Payload) => { draft.drafts[0].labels.add.push("priority:must"); }],
    ["label removal", (draft: Payload) => { draft.drafts[0].labels.remove.push("legacy"); }],
    ["label preservation", (draft: Payload) => { draft.drafts[0].labels.preserve.push("billing"); }],
    ["parent repository", (draft: Payload) => { draft.drafts[0].sections.parent_reference.repository = "other-org/widgets"; }],
    ["parent number", (draft: Payload) => { draft.drafts[0].sections.parent_reference.number = 124; }],
    ["parent URL", (draft: Payload) => { draft.drafts[0].sections.parent_reference.url = "https://github.com/octo-org/widgets/issues/124"; }],
    ["source repository", (draft: Payload) => { draft.source.repository = "other-org/widgets"; }],
    ["source number", (draft: Payload) => { draft.source.number = 124; }],
    ["source URL", (draft: Payload) => { draft.source.url = "https://github.com/octo-org/widgets/issues/124"; }],
    ["parent relationship", (draft: Payload) => { draft.drafts[0].sections.parent_reference.relationship = "related"; }],
    ["hard predecessor", (draft: Payload) => { draft.drafts[0].sections.dependencies.hard_predecessors.push({ unit_id: "unit-other", relation: "requires", rationale: "changed", evidence: "test" }); }],
    ["hard successor", (draft: Payload) => { draft.drafts[0].sections.dependencies.hard_successors.push({ unit_id: "unit-other", relation: "blocks", rationale: "changed", evidence: "test" }); }],
    ["priority class", (draft: Payload) => { draft.drafts[0].sections.priority.class = "should"; }],
    ["priority rationale", (draft: Payload) => { draft.drafts[0].sections.priority.rationale += " Changed."; }],
    ["traceability", (draft: Payload) => { draft.drafts[0].sections.traceability.requirement_ids.push("req-new"); }],
  ])("blocks publication after changing %s", (_label, mutate) => {
    const mutated = clone(draftFixture);
    const before = productSubIssueDigest(mutated);
    mutate(mutated);
    const after = productSubIssueDigest(mutated);
    expect(after).not.toBe(before);
    expect(gate(mutated).allowed).toBe(false);
  });

  it("excludes lifecycle and diagnostic-only metadata from the digest", () => {
    const mutated = clone(draftFixture);
    mutated.status = "partial";
    mutated.failure = {
      code: "composition_failure",
      message: "diagnostic",
      operation: "test",
      retryable: true,
    };
    mutated.source.loaded_issue_version = 999;
    expect(productSubIssueDigest(mutated)).toBe(productSubIssueDigest(draftFixture));
  });

  it("blocks digest mismatch between Planner approval and the supplied canonical set", () => {
    const planner = approvePlanner(clone(plannerFixture));
    planner.authorization.canonical_set_digest =
      "0000000000000000000000000000000000000000000000000000000000000000";
    expect(gate(clone(draftFixture), planner).allowed).toBe(false);
  });

  it("blocks missing exact-set approval and legacy v1 input", () => {
    const planner = clone(plannerFixture);
    planner.status = "drafts_ready";
    planner.authorization.exact_payload = false;
    planner.authorization.exact_set = false;
    planner.authorization.publication_authorized = false;
    planner.authorization.canonical_set_digest = null;
    expect(gate(clone(draftFixture), planner).allowed).toBe(false);

    const legacy = clone(draftFixture);
    legacy.version = 1;
    expect(gate(legacy).allowed).toBe(false);
  });

  it("blocks duplicate units and parent overwrite targets", () => {
    const duplicate = clone(draftFixture);
    duplicate.drafts.push(clone(duplicate.drafts[0]));
    expect(gate(duplicate).allowed).toBe(false);

    const parentTarget = clone(draftFixture);
    parentTarget.drafts[0].issue = {
      repository: "octo-org/widgets",
      number: 123,
      url: "https://github.com/octo-org/widgets/issues/123",
    };
    expect(gate(parentTarget).allowed).toBe(false);
  });
});
