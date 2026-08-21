import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import {
  JsonValue,
  ScenarioDefinition,
  ScenarioFile,
  ScenarioHandoffSpec,
} from "./scenario-types.js";
import {
  SchemaDocument,
  readAllSchemas,
} from "../../lib/parse-schema.js";

const scenarioDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
);

export const githubPluginRoot = resolve(
  scenarioDirectory,
  "..",
  "..",
  "..",
  "plugin",
);
export const scenarioFixturesDirectory = scenarioDirectory;
export const contractFixturesDirectory = join(
  githubPluginRoot,
  "..",
  "tests",
  "fixtures",
  "valid",
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const expandMapping = (value: Record<string, unknown>): Record<string, unknown> => {
  const merged = value["<<"];
  if (!isRecord(merged)) return value;
  return {
    ...merged,
    ...value,
  };
};

const requireString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
};

const requireBooleanRecord = (
  value: unknown,
  path: string,
): Record<string, boolean> => {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  const entries = Object.entries(value);
  for (const [key, entry] of entries) {
    if (typeof entry !== "boolean") {
      throw new Error(`${path}.${key} must be a boolean`);
    }
  }
  return Object.fromEntries(entries) as Record<string, boolean>;
};

const requireStringList = (value: unknown, path: string): string[] => {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${path} must be a list of strings`);
  }
  return [...value] as string[];
};

const parseTarget = (value: unknown, path: string): ScenarioDefinition["target"] => {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  const targetValue = expandMapping(value);
  const target: ScenarioDefinition["target"] = {};
  for (const key of [
    "repository",
    "head_sha",
    "base_sha",
  ] as const) {
    const entry = targetValue[key];
    if (entry !== undefined && entry !== null && typeof entry !== "string") {
      throw new Error(`${path}.${key} must be a string or null`);
    }
    target[key] = (entry as string | null | undefined) ?? null;
  }
  for (const key of ["issue_number", "pull_request_number"] as const) {
    const entry = targetValue[key];
    if (
      entry !== undefined &&
      entry !== null &&
      (typeof entry !== "number" || !Number.isInteger(entry))
    ) {
      throw new Error(`${path}.${key} must be an integer or null`);
    }
    target[key] = (entry as number | null | undefined) ?? null;
  }
  if (targetValue.exact !== undefined && typeof targetValue.exact !== "boolean") {
    throw new Error(`${path}.exact must be a boolean`);
  }
  target.exact = targetValue.exact === undefined ? false : targetValue.exact;
  return target;
};

const parseFacts = (value: unknown, path: string): ScenarioDefinition["facts"] => {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  const facts: ScenarioDefinition["facts"] = {};
  for (const key of [
    "worktree_clean",
    "dirty_at_cleanup",
    "recoverable_work",
    "max_iterations_reached",
    "wait_timeout",
    "pending_as_pass",
    "optional_check_as_required",
    "ambiguous_live_match",
    "legacy_input",
    "mutation_after_approval",
    "parent_overwrite",
    "retry_matching_digest",
    "retry_digest_changed",
    "mode_required",
    "head_changed_after_push",
    "push_failed",
    "partial_fix",
    "reply_only",
    "no_change_follow_up",
    "reply_denied",
    "resolution_denied",
  ] as const) {
    const entry = value[key];
    if (entry !== undefined && typeof entry !== "boolean") {
      throw new Error(`${path}.${key} must be a boolean`);
    }
    if (entry !== undefined) facts[key] = entry;
  }
  if (value.feedback_mode !== undefined) {
    if (
      value.feedback_mode !== "fix" &&
      value.feedback_mode !== "full" &&
      value.feedback_mode !== "follow_up"
    ) {
      throw new Error(`${path}.feedback_mode must be fix, full, or follow_up`);
    }
    facts.feedback_mode = value.feedback_mode;
  }
  if (value.api_errors !== undefined) {
    facts.api_errors = requireStringList(value.api_errors, `${path}.api_errors`);
  }
  return facts;
};

const parseHandoff = (
  value: unknown,
  path: string,
): ScenarioHandoffSpec => {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  const handoff: ScenarioHandoffSpec = {};
  if (value.fixture !== undefined) {
    handoff.fixture = requireString(value.fixture, `${path}.fixture`);
  }
  if (value.patch !== undefined) {
    if (!isRecord(value.patch)) throw new Error(`${path}.patch must be an object`);
    handoff.patch = value.patch as Record<string, JsonValue>;
  }
  return handoff;
};

const parseActions = (
  value: unknown,
  path: string,
): ScenarioDefinition["actions"] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty list`);
  }
  return value.map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) throw new Error(`${entryPath} must be an object`);
    const operation = requireString(entry.operation, `${entryPath}.operation`);
    if (
      entry.effect !== "read" &&
      entry.effect !== "write" &&
      entry.effect !== "preserve"
    ) {
      throw new Error(`${entryPath}.effect must be read, write, or preserve`);
    }
    const action: ScenarioDefinition["actions"][number] = {
      operation,
      effect: entry.effect,
    };
    if (entry.handoff !== undefined) {
      action.handoff = requireString(entry.handoff, `${entryPath}.handoff`);
    }
    if (entry.phase !== undefined) {
      action.phase = requireString(entry.phase, `${entryPath}.phase`);
    }
    if (entry.result !== undefined) {
      if (entry.result !== "success" && entry.result !== "api-error") {
        throw new Error(`${entryPath}.result must be success or api-error`);
      }
      action.result = entry.result;
    }
    return action;
  });
};

const parseScenario = (value: unknown, path: string): ScenarioDefinition => {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  const expectedValue = value.expected;
  if (!isRecord(expectedValue)) throw new Error(`${path}.expected must be an object`);
  const expectedStatus = expectedValue.status;
  if (
    expectedStatus !== "completed" &&
    expectedStatus !== "partial" &&
    expectedStatus !== "blocked"
  ) {
    throw new Error(`${path}.expected.status is invalid`);
  }

  const handoffsValue = value.handoffs;
  if (!isRecord(handoffsValue)) {
    throw new Error(`${path}.handoffs must be an object`);
  }
  const expandedHandoffs = expandMapping(handoffsValue);
  const handoffs = Object.fromEntries(
    Object.entries(expandedHandoffs)
      .filter(([name]) => name !== "<<")
      .map(([name, spec]) => [
      name,
      parseHandoff(spec, `${path}.handoffs.${name}`),
      ]),
  );

  const successfulWrites = requireStringList(
    expectedValue.successful_writes ?? [],
    `${path}.expected.successful_writes`,
  );
  const preservedArtifacts = requireStringList(
    expectedValue.preserved_artifacts ?? [],
    `${path}.expected.preserved_artifacts`,
  );
  const expected: ScenarioDefinition["expected"] = {
    status: expectedStatus,
    successful_writes: successfulWrites,
    preserved_artifacts: preservedArtifacts,
  };
  if (expectedValue.blocked_operation !== undefined) {
    expected.blocked_operation =
      expectedValue.blocked_operation === null
        ? null
        : requireString(
            expectedValue.blocked_operation,
            `${path}.expected.blocked_operation`,
          );
  }
  if (expectedValue.events !== undefined) {
    expected.events = requireStringList(
      expectedValue.events,
      `${path}.expected.events`,
    );
  }

  return {
    id: requireString(value.id, `${path}.id`),
    command: requireString(value.command, `${path}.command`),
    description: requireString(value.description, `${path}.description`),
    expected,
    target: parseTarget(value.target, `${path}.target`),
    facts: parseFacts(value.facts, `${path}.facts`),
    authorizations: requireBooleanRecord(
      value.authorizations,
      `${path}.authorizations`,
    ),
    handoffs,
    actions: parseActions(value.actions, `${path}.actions`),
  };
};

export const loadScenarioFile = async (path: string): Promise<ScenarioFile> => {
  const raw = load(await readFile(path, "utf8"));
  if (!isRecord(raw)) throw new Error(`${path} must contain a YAML object`);
  if (raw.schema !== "CommandScenario" || raw.version !== 1) {
    throw new Error(`${path} must use CommandScenario version 1`);
  }
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length === 0) {
    throw new Error(`${path}.scenarios must be a non-empty list`);
  }
  return {
    schema: "CommandScenario",
    version: 1,
    scenarios: raw.scenarios.map((scenario, index) =>
      parseScenario(scenario, `${path}.scenarios[${index}]`),
    ),
  };
};

export const loadAllScenarios = async (): Promise<ScenarioDefinition[]> => {
  const commandDirectories = await readdir(scenarioDirectory, {
    withFileTypes: true,
  });
  const paths: string[] = [];
  for (const entry of commandDirectories) {
    if (!entry.isDirectory()) continue;
    const directory = join(scenarioDirectory, entry.name);
    const files = await readdir(directory, { withFileTypes: true });
    for (const file of files) {
      if (file.isFile() && file.name.endsWith(".yaml")) {
        paths.push(join(directory, file.name));
      }
    }
  }
  const loaded = await Promise.all(paths.sort().map(loadScenarioFile));
  return loaded.flatMap((file) => file.scenarios);
};

const clone = <T>(value: T): T => structuredClone(value);

export const deepMerge = (base: unknown, patch: unknown): unknown => {
  if (!isRecord(base) || !isRecord(patch)) return clone(patch);
  const result: Record<string, unknown> = clone(base);
  for (const [key, value] of Object.entries(patch)) {
    result[key] =
      isRecord(result[key]) && isRecord(value)
        ? deepMerge(result[key], value)
        : clone(value);
  }
  return result;
};

const synchronizeScenarioReadinessSnapshot = (
  readiness: unknown,
  target: Record<string, unknown>,
): void => {
  if (!isRecord(readiness)) return;
  if (readiness.readiness_evidence === null) return;
  if (!isRecord(readiness.readiness_evidence)) return;

  const pullRequest = isRecord(readiness.pull_request)
    ? readiness.pull_request
    : {};
  const repository =
    typeof readiness.repository === "string"
      ? readiness.repository
      : target.repository;
  const number =
    Number.isInteger(pullRequest.number)
      ? pullRequest.number
      : target.pull_request_number;
  const url =
    typeof pullRequest.url === "string"
      ? pullRequest.url
      : `https://github.com/${String(repository)}/pull/${String(number)}`;
  const headSha =
    typeof readiness.head_sha === "string"
      ? readiness.head_sha
      : target.head_sha;
  const baseBranch =
    typeof readiness.base_branch === "string"
      ? readiness.base_branch
      : typeof pullRequest.base_branch === "string"
        ? pullRequest.base_branch
        : "master";
  const baseSha =
    typeof target.base_sha === "string"
      ? target.base_sha
      : isRecord(readiness.readiness_evidence.base) &&
          typeof readiness.readiness_evidence.base.oid === "string"
        ? readiness.readiness_evidence.base.oid
        : null;
  const snapshot = readiness.readiness_evidence;
  const snapshotPullRequest = isRecord(snapshot.pull_request)
    ? snapshot.pull_request
    : {};
  const snapshotBase = isRecord(snapshot.base) ? snapshot.base : {};
  snapshot.repository = repository;
  snapshot.pull_request = {
    ...snapshotPullRequest,
    number,
    url,
    state: pullRequest.state ?? "open",
    draft: pullRequest.draft ?? false,
  };
  snapshot.head_sha = headSha;
  snapshot.base = {
    ...snapshotBase,
    name: baseBranch,
    ...(typeof baseSha === "string" ? { oid: baseSha } : {}),
  };
  if (Array.isArray(snapshot.sources)) {
    for (const source of snapshot.sources) {
      if (!isRecord(source)) continue;
      const identity = isRecord(source.identity) ? source.identity : {};
      source.identity = {
        ...identity,
        repository,
        number,
        node_id: snapshotPullRequest.node_id,
        url,
        head_sha: headSha,
        base_branch: baseBranch,
        ...(typeof baseSha === "string" ? { base_sha: baseSha } : {}),
      };
    }
  }
};

const synchronizeScenarioHandoffs = (
  scenario: ScenarioDefinition,
  handoffs: Map<string, unknown>,
): void => {
  const target = scenario.target as Record<string, unknown>;
  const readiness = handoffs.get("MergeReadiness");
  synchronizeScenarioReadinessSnapshot(readiness, target);

  for (const name of ["PullRequestMerge", "PreMergeGate"]) {
    const handoff = handoffs.get(name);
    if (!isRecord(handoff)) continue;
    const nestedReadiness = handoff.readiness;
    if (isRecord(nestedReadiness)) {
      delete nestedReadiness.pull_request_number;
      delete nestedReadiness.assessed_head_sha;
      if (Array.isArray(nestedReadiness.evidence)) {
        nestedReadiness.evidence = {
          head_sha: nestedReadiness.head_sha ?? target.head_sha,
          status: "complete",
          sources: [
            {
              name: "readiness-snapshot",
              status: "loaded",
              evidence: ["Current readiness is bound to the rebased head."],
            },
          ],
        };
      }
      synchronizeScenarioReadinessSnapshot(nestedReadiness, target);
    }
    if (name === "PullRequestMerge" || name === "PreMergeGate") {
      const preflight = handoff.preflight;
      const pullRequest = handoff.pull_request;
      if (isRecord(preflight)) {
        if (isRecord(pullRequest)) {
          preflight.repository =
            pullRequest.repository ?? handoff.repository ?? target.repository;
          preflight.pull_request_number = pullRequest.number;
          preflight.pull_request_url = pullRequest.url;
          preflight.head_branch = pullRequest.head_branch;
          preflight.base_branch = pullRequest.base_branch;
        }
        if (typeof target.head_sha === "string") {
          preflight.live_head_sha = target.head_sha;
        } else if (typeof handoff.expected_head_sha === "string") {
          preflight.live_head_sha = handoff.expected_head_sha;
        }
        if (typeof target.base_sha === "string") {
          preflight.live_base_sha = target.base_sha;
        } else if (typeof handoff.expected_base_sha === "string") {
          preflight.live_base_sha = handoff.expected_base_sha;
        }
        if (typeof target.base_branch === "string") {
          preflight.base_branch = target.base_branch;
        } else if (isRecord(pullRequest) && typeof pullRequest.base_branch === "string") {
          preflight.base_branch = pullRequest.base_branch;
        }
      }
    }
  }
};

export const loadScenarioHandoffs = async (
  scenario: ScenarioDefinition,
  schemas?: SchemaDocument[],
): Promise<Map<string, unknown>> => {
  const resolvedSchemas =
    schemas ??
    (await readAllSchemas(join(githubPluginRoot, "shared", "schemas")));
  const schemaByName = new Map(
    resolvedSchemas.map((schema) => [schema.schema, schema]),
  );
  const handoffs = new Map<string, unknown>();
  for (const [name, spec] of Object.entries(scenario.handoffs)) {
    const fixtureName = spec.fixture ?? name;
    const schema = schemaByName.get(fixtureName);
    if (!schema) {
      throw new Error(`${scenario.id}: unknown contract fixture ${fixtureName}`);
    }
    const fixturePath = join(contractFixturesDirectory, `${fixtureName}.yaml`);
    const fixture = load(await readFile(fixturePath, "utf8"));
    handoffs.set(name, spec.patch ? deepMerge(fixture, spec.patch) : fixture);
  }
  synchronizeScenarioHandoffs(scenario, handoffs);
  return handoffs;
};
