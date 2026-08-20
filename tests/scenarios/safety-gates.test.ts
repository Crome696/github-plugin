import { beforeAll, describe, expect, it } from "vitest";
import { loadAllScenarios } from "./lib/load-scenario.js";
import { runScenario } from "./lib/run-scenario.js";
import { ScenarioDefinition } from "./lib/scenario-types.js";
import { workflowGraphFor } from "./lib/workflow-graphs.js";

const clone = <T>(value: T): T => structuredClone(value);

const authorizationFor = (operation: string): string | null =>
  ({
    "create-github-issue": "issue_publication",
    "create-product-sub-issues": "issue_publication",
    "create-worktree": "workspace_creation",
    "create-commit": "commit",
    "push-branch": "push",
    "create-draft-pr": "draft_pr",
    "submit-pr-review": "review_event",
    "reply-to-review-thread": "feedback_reply",
    "resolve-review-thread": "feedback_resolution",
    "fetch-target-branch": "fetch",
    "rebase-branch": "rebase",
    "merge-pull-request": "merge",
    "mark-pr-ready": "pr_ready",
    "apply-issue-priority-titles": "issue_reprioritize",
    "delete-merged-branch": "branch_cleanup",
    "cleanup-worktree": "worktree_cleanup",
  })[operation] ?? null;

const happyScenario = (
  scenarios: ScenarioDefinition[],
  command: string,
): ScenarioDefinition => {
  const scenario = scenarios.find(
    (candidate) =>
      candidate.command === command && candidate.id.endsWith("happy-path"),
  );
  if (!scenario) throw new Error(`Missing happy-path scenario for ${command}`);
  return scenario;
};

describe("GitHub command safety and approval gates", () => {
  let scenarios: ScenarioDefinition[] = [];

  beforeAll(async () => {
    scenarios = await loadAllScenarios();
  });

  it("blocks every routine or hard write when its exact authorization is removed", async () => {
    const candidates = scenarios.filter((scenario) =>
      scenario.id.endsWith("happy-path"),
    );
    for (const source of candidates) {
      const graph = workflowGraphFor(source.command);
      for (const action of source.actions.filter(
        (candidate) => candidate.effect === "write",
      )) {
        const key =
          source.command === "auto-review-fix-pr" &&
          action.operation === "create-worktree"
            ? "workspace_attachment"
            : source.command === "auto-ci-fix-pr" &&
              action.operation === "create-worktree"
              ? "workspace_attachment"
              : authorizationFor(action.operation);
        if (!key) continue;
        const scenario = clone(source);
        scenario.authorizations[key] = false;
        const result = await runScenario(scenario);
        expect(result.setupErrors, `${source.id}:${action.operation}`).toEqual(
          [],
        );
        expect(
          result.successfulWrites,
          `${source.id}:${action.operation}`,
        ).not.toContain(action.operation);
        expect(
          result.blockedOperation,
          `${source.id}:${action.operation}`,
        ).toBe(action.operation);
        expect(
          graph.forbiddenOperations,
          `${source.id}:${action.operation}`,
        ).not.toContain(action.operation);
      }
    }
  }, 120_000);

  it("does not treat rebase approval as merge approval", async () => {
    const scenario = clone(happyScenario(scenarios, "integrate-pr"));
    scenario.authorizations.merge = false;
    const result = await runScenario(scenario);

    expect(result.status).toBe("blocked");
    expect(result.blockedOperation).toBe("merge-pull-request");
    expect(result.successfulWrites).not.toContain("merge-pull-request");
    expect(result.successfulWrites).not.toContain("delete-merged-branch");
    expect(result.successfulWrites).not.toContain("cleanup-worktree");
  });

  it("does not treat readiness or feedback authorization as merge authorization", async () => {
    const scenario = clone(happyScenario(scenarios, "address-pr-feedback"));
    scenario.actions.push({
      operation: "merge-pull-request",
      effect: "write",
    });
    const result = await runScenario(scenario);

    expect(result.status).toBe("blocked");
    expect(result.blockedOperation).toBe("merge-pull-request");
    expect(result.successfulWrites).not.toContain("merge-pull-request");
  });

  it("rejects REQUEST_CHANGES without its independent review-event approval", async () => {
    const scenario = clone(happyScenario(scenarios, "review-pr"));
    scenario.authorizations.review_request_changes = false;
    const reviewPatch = scenario.handoffs.ReviewDecision?.patch;
    if (!reviewPatch || typeof reviewPatch !== "object") {
      throw new Error("Happy review scenario lacks its ReviewDecision patch");
    }
    reviewPatch.proposed_event = "REQUEST_CHANGES";
    const result = await runScenario(scenario);

    expect(result.status).toBe("blocked");
    expect(result.blockedOperation).toBe("submit-pr-review");
    expect(result.successfulWrites).not.toContain("submit-pr-review");
  });

  it("does not treat Ready-for-Review authorization as merge, draft, or review authorization", async () => {
    const scenario = clone(happyScenario(scenarios, "ready-pr"));
    scenario.actions.push({
      operation: "merge-pull-request",
      effect: "write",
    });
    const result = await runScenario(scenario);

    expect(result.status).toBe("blocked");
    expect(result.blockedOperation).toBe("merge-pull-request");
    expect(result.successfulWrites).not.toContain("merge-pull-request");
    expect(result.successfulWrites).not.toContain("create-draft-pr");
    expect(result.successfulWrites).not.toContain("submit-pr-review");
  });

  it("never executes a command operation outside its registered graph", async () => {
    for (const command of [
      "create-issue",
      "refine-issue",
      "prepare-issue",
      "publish-draft-pr",
      "review-pr",
      "address-pr-feedback",
      "implement-auto-issue",
      "refine-auto-issue",
      "auto-review-fix-pr",
      "integrate-pr",
      "ready-pr",
      "plan-product",
      "reprioritize-issues",
    ]) {
      const scenario = clone(happyScenario(scenarios, command));
      const forbidden = workflowGraphFor(command).forbiddenOperations[0]!;
      scenario.actions.push({
        operation: forbidden,
        effect: "write",
      });
      const result = await runScenario(scenario);

      expect(result.status, command).toBe("blocked");
      expect(result.blockedOperation, command).toBe(forbidden);
      expect(result.successfulWrites, command).not.toContain(forbidden);
    }
  });

  it("does not allow a write operation to be reclassified as read-only", async () => {
    const scenario = clone(happyScenario(scenarios, "integrate-pr"));
    const merge = scenario.actions.find(
      (action) => action.operation === "merge-pull-request",
    );
    if (!merge) throw new Error("Happy integration scenario lacks merge action");
    merge.effect = "read";
    const result = await runScenario(scenario);

    expect(result.status).toBe("blocked");
    expect(result.blockedOperation).toBe("merge-pull-request");
    expect(result.events.at(-1)?.outcome).toBe("blocked");
    expect(result.successfulWrites).not.toContain("merge-pull-request");
  });

  it("preserves recoverable work during cleanup and never records removal", async () => {
    const scenario = scenarios.find(
      (candidate) => candidate.id === "integrate-pr-uncommitted-cleanup",
    );
    if (!scenario) throw new Error("Missing uncommitted cleanup scenario");
    const result = await runScenario(scenario);

    expect(
      result.status,
      `setup=${JSON.stringify(result.setupErrors)} events=${JSON.stringify(result.events)}`,
    ).toBe("partial");
    expect(result.preservedArtifacts).toEqual(["cleanup-worktree"]);
    expect(result.successfulWrites).not.toContain("cleanup-worktree");
    expect(
      result.events.some(
        (event) =>
          event.operation === "cleanup-worktree" &&
          event.outcome === "preserved",
      ),
    ).toBe(true);
  });

  it("leaves a rebase conflict stopped without merge, push, or cleanup", async () => {
    const scenario = scenarios.find(
      (candidate) => candidate.id === "integrate-pr-rebase-conflict",
    );
    if (!scenario) throw new Error("Missing rebase conflict scenario");
    const result = await runScenario(scenario);

    expect(result.status).toBe("blocked");
    expect(result.blockedOperation).toBe("rebase-branch");
    expect(result.successfulWrites).toEqual(["fetch-target-branch"]);
    expect(result.successfulWrites).not.toContain("push-branch");
    expect(result.successfulWrites).not.toContain("merge-pull-request");
    expect(result.successfulWrites).not.toContain("cleanup-worktree");
  });
});
