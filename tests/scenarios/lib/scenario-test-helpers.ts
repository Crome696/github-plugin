import { beforeAll, describe, expect, it } from "vitest";
import { loadAllScenarios } from "./load-scenario.js";
import { runScenario, ScenarioRunResult } from "./run-scenario.js";
import { ScenarioDefinition } from "./scenario-types.js";
import { graphWrites, workflowGraphFor } from "./workflow-graphs.js";

export const expectScenarioResult = (result: ScenarioRunResult): void => {
  const expected = result.scenario.expected;
  expect(
    result.setupErrors,
    `${result.scenario.id}; setup=${JSON.stringify(result.setupErrors)}`,
  ).toEqual([]);
  expect(
    result.status,
    `${result.scenario.id}; events=${JSON.stringify(result.events)}`,
  ).toBe(expected.status);
  expect(result.successfulWrites, result.scenario.id).toEqual(
    expected.successful_writes,
  );
  expect(result.preservedArtifacts, result.scenario.id).toEqual(
    expected.preserved_artifacts,
  );
  expect(result.blockedOperation, result.scenario.id).toBe(
    expected.blocked_operation ?? null,
  );
  if (expected.events) {
    expect(
      result.events.map((event) => `${event.operation}:${event.outcome}`),
      result.scenario.id,
    ).toEqual(expected.events);
  }

  const writes = graphWrites(workflowGraphFor(result.scenario.command));
  for (const operation of result.successfulWrites) {
    expect(writes.has(operation), result.scenario.id).toBe(true);
  }
  const terminalIndex = result.events.findIndex(
    (event) => event.outcome === "blocked" || event.outcome === "api-error",
  );
  if (terminalIndex >= 0) {
    expect(
      result.events.slice(terminalIndex + 1).filter(
        (event) =>
          event.outcome === "recorded" || event.outcome === "preserved",
      ),
      result.scenario.id,
    ).toEqual([]);
  }
  expect(
    result.events.some((event) =>
      ["continue-rebase", "skip-rebase", "abort-rebase", "resolve-conflict"].includes(
        event.operation,
      ),
    ),
    result.scenario.id,
  ).toBe(false);
};

export const registerCommandScenarioTests = (command: string): void => {
  describe(`${command} end-to-end scenarios`, () => {
    let scenarios: ScenarioDefinition[] = [];

    beforeAll(async () => {
      scenarios = (await loadAllScenarios()).filter(
        (scenario) => scenario.command === command,
      );
    });

    it("defines at least one scenario for the command", () => {
      expect(scenarios.length, command).toBeGreaterThan(0);
    });

    it("executes every declared scenario through the fail-closed runner", async () => {
      for (const scenario of scenarios) {
        const result = await runScenario(scenario);
        expectScenarioResult(result);
      }
    });
  });
};
