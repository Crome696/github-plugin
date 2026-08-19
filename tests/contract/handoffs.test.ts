import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  SchemaDocument,
  readAllSchemas,
} from "../lib/parse-schema.js";
import { loadFixture } from "../lib/load-fixtures.js";
import {
  AgentHandoff,
  CommandHandoff,
  ContractRef,
  SkillHandoff,
  agentHandoffs,
  allReferencedContracts,
  commandHandoffs,
  hookEmittedContracts,
  nestedContracts,
  skillHandoffs,
} from "../lib/handoff-graph.js";
import { validatePayload } from "../lib/validate-payload.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(testDirectory, "..", "..", "plugin");
const schemaDirectory = join(pluginRoot, "shared", "schemas");
const skillsDirectory = join(pluginRoot, "skills");
const agentsDirectory = join(pluginRoot, "agents");
const commandsDirectory = join(pluginRoot, "commands");

let schemas: SchemaDocument[] = [];
let fixtures = new Map<string, unknown>();
let skillSources = new Map<string, string>();
let agentSources = new Map<string, string>();
let commandSources = new Map<string, string>();

const uniqueRefs = (refs: ContractRef[]): ContractRef[] =>
  [...new Map(refs.map((ref) => [`${ref.name}:${ref.version}`, ref])).values()];

const versionMentioned = (source: string, version: number): boolean => {
  const patterns = [
    new RegExp(`version[-\\s:]${version}\\b`, "i"),
    new RegExp(`version\\s+${version}\\b`, "i"),
    new RegExp(`\\bv${version}\\b`, "i"),
  ];
  return patterns.some((pattern) => pattern.test(source));
};

const contractMentioned = (source: string, ref: ContractRef): boolean =>
  source.includes(ref.name) && versionMentioned(source, ref.version);

const namesFromFiles = (
  sources: Map<string, string>,
): string[] => [...sources.keys()].sort();

const loadNamedMarkdown = async (
  directory: string,
  suffix: string,
): Promise<Map<string, string>> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: Array<[string, string]> = [];
  for (const entry of entries) {
    const path = join(directory, entry.name, suffix);
    if (entry.isDirectory()) {
      files.push([entry.name, await readFile(path, "utf8")]);
    }
  }
  return new Map(files);
};

const loadAgentMarkdown = async (): Promise<Map<string, string>> => {
  const entries = await readdir(agentsDirectory);
  return new Map(
    await Promise.all(
      entries
        .filter((name) => name.endsWith(".md"))
        .map(
          async (name) =>
            [
              basename(name, ".md"),
              await readFile(join(agentsDirectory, name), "utf8"),
            ] as [string, string],
        ),
    ),
  );
};

const loadCommandMarkdown = async (): Promise<Map<string, string>> => {
  const entries = await readdir(commandsDirectory);
  return new Map(
    await Promise.all(
      entries
        .filter((name) => name.endsWith(".md"))
        .map(
          async (name) =>
            [
              basename(name, ".md"),
              await readFile(join(commandsDirectory, name), "utf8"),
            ] as [string, string],
        ),
    ),
  );
};

const refKey = (ref: ContractRef): string => `${ref.name}:${ref.version}`;

const getSchema = (name: string): SchemaDocument => {
  const schema = schemas.find((candidate) => candidate.schema === name);
  if (!schema) throw new Error(`Missing schema ${name}`);
  return schema;
};

const clone = <T>(value: T): T => structuredClone(value);

const bindIdentity = (payload: unknown): unknown => {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) return payload.map(bindIdentity);

  const source = payload as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "repository" && typeof value === "string") {
      result[key] = "octo-org/widgets";
    } else if (key === "head_sha" && typeof value === "string") {
      result[key] = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    } else if (key === "pull_request" && value && typeof value === "object") {
      const pullRequest = bindIdentity(value) as Record<string, unknown>;
      if (typeof pullRequest.number === "number") pullRequest.number = 42;
      if (typeof pullRequest.url === "string") {
        pullRequest.url = "https://github.com/octo-org/widgets/pull/42";
      }
      result[key] = pullRequest;
    } else {
      result[key] = bindIdentity(value);
    }
  }
  return result;
};

const expectValidFixture = (name: string): unknown => {
  const schema = getSchema(name);
  const payload = bindIdentity(clone(fixtures.get(name)));
  const result = validatePayload(schema, payload);
  expect(result.issues, name).toEqual([]);
  expect(result.valid, name).toBe(true);
  return payload;
};

const findSkill = (name: string): SkillHandoff => {
  const handoff = skillHandoffs.find((candidate) => candidate.name === name);
  if (!handoff) throw new Error(`Missing Skill handoff ${name}`);
  return handoff;
};

const assertSkillRefs = (
  handoff: SkillHandoff,
  source: string,
): void => {
  for (const ref of uniqueRefs(handoff.consumes)) {
    expect(
      source.includes(ref.name),
      `${handoff.name} must mention consumed ${ref.name}`,
    ).toBe(true);
  }
  for (const alternativeSet of handoff.requiresOneOf ?? []) {
    expect(
      alternativeSet.length,
      `${handoff.name} must define a non-empty alternative set`,
    ).toBeGreaterThan(0);
    for (const ref of uniqueRefs(alternativeSet)) {
      expect(
        source.includes(ref.name),
        `${handoff.name} must mention alternative ${ref.name}`,
      ).toBe(true);
    }
  }
  for (const ref of uniqueRefs(handoff.produces)) {
    expect(
      contractMentioned(source, ref),
      `${handoff.name} must mention ${ref.name} version ${ref.version}`,
    ).toBe(true);
  }
};

const assertAgentRefs = (handoff: AgentHandoff, source: string): void => {
  for (const ref of uniqueRefs([...handoff.consumes, ...handoff.produces])) {
    expect(source, `${handoff.name} must mention ${ref.name}`).toContain(
      ref.name,
    );
  }
};

const assertCommandRefs = (handoff: CommandHandoff, source: string): void => {
  expect(source).toContain(handoff.agent);
  for (const ref of handoff.contracts) {
    expect(source, `${handoff.name} must mention ${ref.name}`).toContain(
      ref.name,
    );
  }
};

describe("Skill, Agent, and Command handoffs", () => {
  beforeAll(async () => {
    schemas = await readAllSchemas(schemaDirectory);
    fixtures = new Map(
      await Promise.all(
        schemas.map(
          async (schema) =>
            [schema.schema, await loadFixture(schema)] as [string, unknown],
        ),
      ),
    );
    skillSources = await loadNamedMarkdown(skillsDirectory, "SKILL.md");
    agentSources = await loadAgentMarkdown();
    commandSources = await loadCommandMarkdown();
  });

  it("keeps the registry aligned with every Skill, Agent, and Command file", () => {
    expect(skillHandoffs).toHaveLength(82);
    expect(namesFromFiles(skillSources)).toEqual(
      skillHandoffs.map((handoff) => handoff.name).sort(),
    );
    expect(namesFromFiles(agentSources)).toEqual(
      agentHandoffs.map((handoff) => handoff.name).sort(),
    );
    expect(namesFromFiles(commandSources)).toEqual(
      commandHandoffs.map((handoff) => handoff.name).sort(),
    );
  });

  it("covers every Shared Contract with a producer, nested use, or hook", () => {
    const produced = new Set(
      [
        ...skillHandoffs.flatMap((handoff) =>
          handoff.produces.map((ref) => ref.name),
        ),
        ...agentHandoffs.flatMap((handoff) =>
          handoff.produces.map((ref) => ref.name),
        ),
      ],
    );
    const referenced = new Set(allReferencedContracts().map((ref) => ref.name));
    const covered = new Set([
      ...produced,
      ...nestedContracts,
      ...hookEmittedContracts,
    ]);
    const missing = schemas
      .map((schema) => schema.schema)
      .filter((name) => !covered.has(name));

    expect(missing).toEqual([]);
    expect([...referenced].sort()).toEqual(
      schemas
        .map((schema) => schema.schema)
        .filter((name) => !nestedContracts.has(name) && !hookEmittedContracts.has(name))
        .sort()
        .filter((name) => referenced.has(name)),
    );
  });

  it("requires every registered Skill contract reference in its Markdown source", () => {
    for (const handoff of skillHandoffs) {
      const source = skillSources.get(handoff.name);
      expect(source).toBeDefined();
      assertSkillRefs(handoff, source!);
    }
  });

  it("requires every Agent to list its Skills and handoff contracts", () => {
    for (const handoff of agentHandoffs) {
      const source = agentSources.get(handoff.name);
      expect(source).toBeDefined();
      for (const skill of handoff.skills) {
        expect(source, `${handoff.name} must list ${skill}`).toContain(
          `plugin/skills/${skill}/SKILL.md`,
        );
        expect(skillSources.has(skill), `Unknown Skill ${skill}`).toBe(true);
      }
      assertAgentRefs(handoff, source!);
    }
  });

  it("keeps the lifecycle orchestrator limited to delivery Agents", () => {
    const handoff = agentHandoffs.find(
      (candidate) => candidate.name === "lifecycle-agent",
    );
    expect(handoff).toBeDefined();
    expect(handoff!.startsAgents).toEqual([
      "issue-agent",
      "preparation-agent",
      "delivery-agent",
    ]);
    const source = agentSources.get("lifecycle-agent");
    expect(source).toBeDefined();
    for (const agent of handoff!.startsAgents ?? []) {
      expect(source, `lifecycle-agent must start ${agent}`).toContain(agent);
      expect(agentHandoffs.some((candidate) => candidate.name === agent)).toBe(
        true,
      );
    }
    expect(source).toMatch(/Do not start `review-agent`/);
    expect(source).toContain("review-agent");
    expect(source).toContain("feedback-agent");
    expect(source).toContain("integration-agent");
    expect(source).toContain("pr-ready-agent");
    expect(source).toContain("issue-reprioritize-agent");
  });

  it("keeps Commands thin and pointed at exactly one Agent", () => {
    const agentNames = agentHandoffs.map((handoff) => handoff.name);
    for (const handoff of commandHandoffs) {
      const source = commandSources.get(handoff.name);
      expect(source).toBeDefined();
      assertCommandRefs(handoff, source!);
      expect(source).toMatch(/thin entry point|thin command|thin/i);
      for (const otherAgent of agentNames.filter(
        (agent) => agent !== handoff.agent,
      )) {
        expect(source, `${handoff.name} mentions ${otherAgent}`).not.toContain(
          otherAgent,
        );
      }
    }
  });

  it("preserves same-contract versions for in-place producer/consumer reuse", () => {
    for (const handoff of skillHandoffs) {
      const consumed = new Map(
        handoff.consumes.map((ref) => [ref.name, ref.version]),
      );
      for (const produced of handoff.produces) {
        if (!consumed.has(produced.name)) continue;
        expect(produced.version, handoff.name).toBe(
          consumed.get(produced.name),
        );
      }
    }
  });

  it("validates the delivery handoff chain against the local fixtures", () => {
    const chain = [
      "ImplementationPlan",
      "WorkingTreeInspection",
      "ChangeClassification",
      "UnrelatedChangeDetection",
      "ValidationResult",
      "CommitProposal",
      "BranchPush",
      "PullRequestIssueLink",
      "PullRequestDraft",
    ];
    const payloads = chain.map(expectValidFixture);
    const repositories = payloads
      .map((payload) => (payload as Record<string, unknown>).repository)
      .filter((value): value is string => typeof value === "string");
    expect(new Set(repositories).size).toBeLessThanOrEqual(1);
  });

  it("validates review and feedback handoff chains with one bound PR identity", () => {
    const chains = [
      [
        "PullRequestDiffAnalysis",
        "DetectedReviewFindings",
        "DeduplicatedReviewFindings",
        "ClassifiedReviewFindings",
        "ReviewDecision",
      ],
      [
        "CollectedReviewFeedback",
        "ClassifiedReviewFeedback",
        "FeedbackResolutionCapabilities",
        "FeedbackResolutionPlan",
        "FeedbackResolutionValidation",
        "FeedbackResolutionSummary",
      ],
    ];
    for (const chain of chains) {
      const payloads = chain.map(expectValidFixture);
      const pullRequests = payloads
        .map((payload) => (payload as Record<string, unknown>).pull_request)
        .filter(
          (value): value is Record<string, unknown> =>
            !!value && typeof value === "object",
        );
      expect(new Set(pullRequests.map((pr) => pr.number)).size).toBeLessThanOrEqual(
        1,
      );
      const heads = payloads
        .map((payload) => (payload as Record<string, unknown>).head_sha)
        .filter((value): value is string => typeof value === "string");
      expect(new Set(heads).size).toBeLessThanOrEqual(1);
    }
  });

  it("keeps merge readiness diagnostic and cleanup independently handed off", () => {
    const readiness = expectValidFixture("MergeReadiness") as Record<
      string,
      unknown
    >;
    const merge = expectValidFixture("PullRequestMerge") as Record<
      string,
      unknown
    >;
    const cleanup = expectValidFixture("CleanupResult") as Record<
      string,
      unknown
    >;

    expect(readiness.status).toBe("ready");
    expect(merge.status).not.toBe("merged");
    expect(cleanup.authorization).toBeDefined();
    expect(validatePayload(getSchema("MergeReadiness"), readiness).valid).toBe(
      true,
    );
    expect(validatePayload(getSchema("PullRequestMerge"), merge).valid).toBe(
      true,
    );
    expect(validatePayload(getSchema("CleanupResult"), cleanup).valid).toBe(
      true,
    );
  });
});
