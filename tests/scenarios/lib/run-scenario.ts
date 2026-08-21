import { join } from "node:path";
import { readAllSchemas, SchemaDocument } from "../../lib/parse-schema.js";
import {
  InvariantIssue,
  validateContractInvariants,
} from "../../lib/contract-invariants.js";
import {
  PayloadValidationResult,
  validatePayload,
} from "../../lib/validate-payload.js";
import {
  loadScenarioHandoffs,
  githubPluginRoot,
} from "./load-scenario.js";
import {
  ScenarioAction,
  ScenarioDefinition,
  ScenarioEvent,
  ScenarioStatus,
} from "./scenario-types.js";
import {
  assertActionBelongsToGraph,
  assertWorkflowRegistry,
  workflowGraphFor,
} from "./workflow-graphs.js";
import {
  evaluateReadGate,
  evaluateWriteGate,
  GateContext,
  isPreservationSafe,
} from "./write-gates.js";

export interface HandoffValidation {
  name: string;
  fixture: string;
  schema: PayloadValidationResult;
  invariants: InvariantIssue[];
}

export interface ScenarioRunResult {
  scenario: ScenarioDefinition;
  status: ScenarioStatus;
  successfulWrites: string[];
  events: ScenarioEvent[];
  preservedArtifacts: string[];
  blockedOperation: string | null;
  handoffs: Map<string, unknown>;
  handoffValidation: HandoffValidation[];
  setupErrors: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const setStatus = (
  current: ScenarioStatus,
  next: ScenarioStatus,
): ScenarioStatus => {
  if (current === "blocked" || current === "partial") return current;
  return next;
};

const updateHandoffAfterWrite = (
  context: GateContext,
  operation: string,
): void => {
  if (operation === "create-github-issue") {
    const draft = context.handoffs.get("IssueDraft");
    if (isRecord(draft)) {
      const issue = isRecord(draft.issue) ? draft.issue : {};
      draft.issue = {
        ...issue,
        number:
          typeof issue.number === "number"
            ? issue.number
            : context.scenario.target.issue_number ?? 42,
        url:
          typeof issue.url === "string" && issue.url.length > 0
            ? issue.url
            : "https://github.com/octo-org/widgets/issues/42",
      };
      if (context.scenario.command === "implement-auto-issue") {
        draft.mode = "edit";
        draft.status = "approved";
      } else {
        draft.status = "published";
      }
    }
    return;
  }
  if (operation === "create-worktree") {
    const workspace = context.handoffs.get("BranchWorkspace");
    if (isRecord(workspace)) workspace.status = "active";
    const lifecycle = context.handoffs.get("FeedbackLifecycleRun");
    if (isRecord(lifecycle)) lifecycle.status = "running";
    return;
  }
  if (operation === "create-commit") {
    const proposal = context.handoffs.get("CommitProposal");
    if (isRecord(proposal)) {
      proposal.status = "created";
      proposal.commit = {
        sha:
          context.scenario.target.head_sha ??
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        created_at: "2026-01-01T00:00:00.000Z",
        files_committed: [],
      };
    }
    const lifecycle = context.handoffs.get("FeedbackLifecycleRun");
    if (isRecord(lifecycle)) lifecycle.status = "awaiting_validation";
    return;
  }
  if (operation === "push-branch") {
    const push = context.handoffs.get("BranchPush");
    if (isRecord(push)) {
      push.status = "verified";
      const pushPayload = isRecord(push.push) ? push.push : {};
      push.push = {
        ...pushPayload,
        attempted: true,
        forced: false,
        result: "success",
      };
      push.authorization = {
        ...(isRecord(push.authorization) ? push.authorization : {}),
        push_authorized: true,
      };
    }
    const lifecycle = context.handoffs.get("FeedbackLifecycleRun");
    if (isRecord(lifecycle)) lifecycle.status = "awaiting_validation";
    return;
  }
  if (operation === "reply-to-review-thread") {
    const lifecycle = context.handoffs.get("FeedbackLifecycleRun");
    if (isRecord(lifecycle)) lifecycle.status = "replied";
    return;
  }
  if (operation === "resolve-review-thread") {
    const lifecycle = context.handoffs.get("FeedbackLifecycleRun");
    if (isRecord(lifecycle)) lifecycle.status = "resolved";
    return;
  }
  if (operation === "rebase-branch") {
    const rebase = context.handoffs.get("BranchRebase");
    if (isRecord(rebase)) {
      rebase.status = "rebased";
      const rebasePayload = isRecord(rebase.rebase) ? rebase.rebase : {};
      rebase.rebase = {
        ...rebasePayload,
        attempted: true,
        result: "success",
      };
    }
    return;
  }
  if (operation === "merge-pull-request") {
    const merge = context.handoffs.get("PullRequestMerge");
    if (isRecord(merge)) merge.status = "merged";
    return;
  }
  if (operation === "mark-pr-ready") {
    const ready = context.handoffs.get("PullRequestReady");
    if (isRecord(ready) && ready.status !== "already_ready") {
      ready.status = "ready";
      const draftState = isRecord(ready.draft_state) ? ready.draft_state : {};
      ready.draft_state = {
        ...draftState,
        after: false,
      };
    }
  }
};

const validateHandoffs = (
  scenario: ScenarioDefinition,
  handoffs: Map<string, unknown>,
  schemas: SchemaDocument[],
): HandoffValidation[] => {
  const schemaByName = new Map(schemas.map((schema) => [schema.schema, schema]));
  return [...handoffs.entries()].map(([name, payload]) => {
    const fixtureName = scenario.handoffs[name]?.fixture ?? name;
    const schema = schemaByName.get(fixtureName);
    if (!schema) {
      return {
        name,
        fixture: fixtureName,
        schema: {
          valid: false,
          issues: [
            {
              path: "$",
              code: "invalid_schema",
              message: `Unknown contract ${fixtureName}`,
            },
          ],
        },
        invariants: [],
      };
    }
    return {
      name,
      fixture: fixtureName,
      schema: validatePayload(schema, payload),
      invariants: validateContractInvariants(fixtureName, payload),
    };
  });
};

const validationErrors = (validations: HandoffValidation[]): string[] =>
  validations.flatMap((validation) => [
    ...validation.schema.issues.map(
      (issue) =>
        `${validation.name} ${issue.path}: ${issue.message}`,
    ),
    ...validation.invariants.map(
      (issue) =>
        `${validation.name} ${issue.path}: ${issue.message}`,
    ),
  ]);

const actionHasApiError = (
  scenario: ScenarioDefinition,
  action: ScenarioAction,
): boolean =>
  action.result === "api-error" ||
  scenario.facts.api_errors?.includes(action.operation) === true;

export const runScenario = async (
  scenario: ScenarioDefinition,
  schemas?: SchemaDocument[],
): Promise<ScenarioRunResult> => {
  assertWorkflowRegistry();
  const graph = workflowGraphFor(scenario.command);
  const resolvedSchemas =
    schemas ??
    (await readAllSchemas(join(githubPluginRoot, "shared", "schemas")));
  const handoffs = await loadScenarioHandoffs(scenario, resolvedSchemas);
  const handoffValidation = validateHandoffs(
    scenario,
    handoffs,
    resolvedSchemas,
  );
  const setupErrors = validationErrors(handoffValidation);
  const context: GateContext = {
    scenario,
    handoffs,
    successfulWrites: new Set<string>(),
    completedOperations: new Set<string>(),
  };
  const events: ScenarioEvent[] = [];
  const successfulWrites: string[] = [];
  const preservedArtifacts: string[] = [];
  let status: ScenarioStatus = setupErrors.length > 0 ? "blocked" : "completed";
  let blockedOperation: string | null =
    setupErrors.length > 0 ? "handoff-validation" : null;

  if (setupErrors.length === 0) {
    for (const action of scenario.actions) {
      try {
        assertActionBelongsToGraph(graph, action);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        events.push({
          operation: action.operation,
          outcome: "blocked",
          reason,
        });
        status = "blocked";
        blockedOperation = action.operation;
        break;
      }

      if (action.effect === "read") {
        if (
          action.operation === "reload-feedback-head" ||
          (action.operation === "load-pull-request" &&
            action.phase === "post-push")
        ) {
          const lifecycle = context.handoffs.get("FeedbackLifecycleRun");
          if (isRecord(lifecycle)) {
            if (scenario.facts.head_changed_after_push === true) {
              lifecycle.current_head_sha = "cccccccccccccccccccccccccccccccccccccccc";
              lifecycle.status = "blocked";
            } else if (scenario.facts.partial_fix === true) {
              lifecycle.status = "partial";
            } else if (lifecycle.status === "awaiting_validation") {
              lifecycle.status = "follow_up_ready";
            }
          }
        }
        if (
          scenario.command === "auto-review-fix-pr" &&
          action.operation === "load-pull-request" &&
          action.phase === "iteration-2"
        ) {
          const workspace = context.handoffs.get("BranchWorkspace");
          if (isRecord(workspace)) workspace.status = "planned";
          const proposal = context.handoffs.get("CommitProposal");
          if (isRecord(proposal)) proposal.status = "approved";
        }
        const readGate = evaluateReadGate(context, action);
        if (!readGate.allowed) {
          events.push({
            operation: action.operation,
            outcome: "blocked",
            reason: `${readGate.code}: ${readGate.reason}`,
          });
          status = "blocked";
          blockedOperation = action.operation;
          break;
        }
        if (actionHasApiError(scenario, action)) {
          events.push({
            operation: action.operation,
            outcome: "api-error",
            reason: "The simulated read API returned an error.",
          });
          status = "partial";
          blockedOperation = action.operation;
          break;
        }
        events.push({ operation: action.operation, outcome: "read" });
        context.completedOperations.add(action.operation);
        continue;
      }

      if (action.effect === "preserve") {
        const preservation = isPreservationSafe(context);
        if (!preservation.allowed) {
          events.push({
            operation: action.operation,
            outcome: "blocked",
            reason: preservation.reason,
          });
          status = "blocked";
          blockedOperation = action.operation;
          break;
        }
        events.push({
          operation: action.operation,
          outcome: "preserved",
          reason: preservation.reason,
        });
        preservedArtifacts.push(action.operation);
        context.completedOperations.add(action.operation);
        status = setStatus(status, "partial");
        continue;
      }

      const gate = evaluateWriteGate(context, action);
      if (!gate.allowed) {
        events.push({
          operation: action.operation,
          outcome: "blocked",
          reason: `${gate.code}: ${gate.reason}`,
        });
        if (gate.code === "rebase_conflict") {
          preservedArtifacts.push("rebase");
        }
        status = "blocked";
        blockedOperation = action.operation;
        break;
      }

      if (actionHasApiError(scenario, action)) {
        events.push({
          operation: action.operation,
          outcome: "api-error",
          reason: "The simulated write API returned an error.",
        });
        status = "partial";
        blockedOperation = action.operation;
        break;
      }

      events.push({ operation: action.operation, outcome: "recorded" });
      successfulWrites.push(action.operation);
      context.successfulWrites.add(action.operation);
      context.completedOperations.add(action.operation);
      updateHandoffAfterWrite(context, action.operation);
    }
  }

  if (
    (scenario.command === "auto-review-fix-pr" ||
      scenario.command === "auto-ci-fix-pr") &&
    scenario.facts.max_iterations_reached === true &&
    status === "completed"
  ) {
    status = "partial";
  }

  if (
    scenario.command === "auto-ci-fix-pr" &&
    scenario.facts.wait_timeout === true &&
    status === "completed"
  ) {
    status = "partial";
  }

  if (
    scenario.command === "auto-ci-fix-pr" &&
    scenario.facts.pending_as_pass === true &&
    status === "completed"
  ) {
    status = "blocked";
    blockedOperation = "wait-required-checks";
  }

  const lifecycle = handoffs.get("FeedbackLifecycleRun");
  if (isRecord(lifecycle) && status === "completed") {
    if (lifecycle.status === "partial") status = "partial";
    if (lifecycle.status === "blocked") {
      status = "blocked";
      blockedOperation ??= "reload-feedback-head";
    }
  }

  return {
    scenario,
    status,
    successfulWrites,
    events,
    preservedArtifacts,
    blockedOperation,
    handoffs,
    handoffValidation,
    setupErrors,
  };
};
