export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ScenarioStatus = "completed" | "partial" | "blocked";
export type ScenarioActionEffect = "read" | "write" | "preserve";
export type ScenarioActionResult = "success" | "api-error";

export interface ScenarioHandoffSpec {
  fixture?: string;
  patch?: Record<string, JsonValue>;
}

export interface ScenarioTarget {
  repository?: string | null;
  issue_number?: number | null;
  pull_request_number?: number | null;
  head_sha?: string | null;
  base_sha?: string | null;
  exact?: boolean;
}

export interface ScenarioFacts {
  worktree_clean?: boolean;
  dirty_at_cleanup?: boolean;
  recoverable_work?: boolean;
  max_iterations_reached?: boolean;
  wait_timeout?: boolean;
  pending_as_pass?: boolean;
  optional_check_as_required?: boolean;
  api_errors?: string[];
}

export interface ScenarioAction {
  operation: string;
  effect: ScenarioActionEffect;
  handoff?: string;
  phase?: string;
  result?: ScenarioActionResult;
}

export interface ScenarioExpected {
  status: ScenarioStatus;
  successful_writes: string[];
  blocked_operation?: string | null;
  preserved_artifacts: string[];
  events?: string[];
}

export interface ScenarioDefinition {
  id: string;
  command: string;
  description: string;
  expected: ScenarioExpected;
  target: ScenarioTarget;
  facts: ScenarioFacts;
  authorizations: Record<string, boolean>;
  handoffs: Record<string, ScenarioHandoffSpec>;
  actions: ScenarioAction[];
}

export interface ScenarioFile {
  schema: "CommandScenario";
  version: 1;
  scenarios: ScenarioDefinition[];
}

export interface ScenarioEvent {
  operation: string;
  outcome: "read" | "recorded" | "blocked" | "api-error" | "preserved";
  reason?: string;
}
