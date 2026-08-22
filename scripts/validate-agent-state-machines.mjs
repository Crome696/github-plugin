import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const expectedAgents = [
  "ci-fix-agent",
  "delivery-agent",
  "feedback-agent",
  "host-hooks-agent",
  "integration-agent",
  "issue-agent",
  "issue-close-agent",
  "issue-reprioritize-agent",
  "lifecycle-agent",
  "pr-ready-agent",
  "preparation-agent",
  "product-planner-agent",
  "review-agent",
  "review-fix-agent",
];

const requiredSections = [
  "Activation boundary",
  "Accepted inputs and produced outputs",
  "States and typed transitions",
  "Ordered Skill transitions",
  "Authorization checkpoints",
  "Recovery and resume behavior",
  "Forbidden operations",
  "Terminal outputs",
];

const failures = [];

function relative(filePath) {
  return path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/");
}
function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  const filePath = path.join(repositoryRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    fail("Missing required file: " + relativePath);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function escaped(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

const agentDirectory = path.join(repositoryRoot, "plugin", "agents");
const actualAgents = fs.existsSync(agentDirectory)
  ? fs.readdirSync(agentDirectory)
      .filter((entry) => entry.endsWith(".md"))
      .map((entry) => entry.slice(0, -3))
      .sort()
  : [];

if (actualAgents.length !== expectedAgents.length) {
  fail(
    "Expected exactly " + expectedAgents.length +
      " agent files, found " + actualAgents.length,
  );
}

for (const agent of expectedAgents) {
  if (!actualAgents.includes(agent)) {
    fail("Missing expected agent file: plugin/agents/" + agent + ".md");
  }
}

const skillDirectory = path.join(repositoryRoot, "plugin", "skills");
const skillNames = fs.existsSync(skillDirectory)
  ? fs.readdirSync(skillDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

const schemaDirectory = path.join(repositoryRoot, "plugin", "shared", "schemas");
const schemaVersions = new Map();
if (fs.existsSync(schemaDirectory)) {
  for (const entry of fs.readdirSync(schemaDirectory)) {
    if (!entry.endsWith(".yaml")) continue;
    const content = fs.readFileSync(path.join(schemaDirectory, entry), "utf8");
    const match = content.match(/^version:\s*(\d+)\s*$/m);
    if (match) schemaVersions.set(entry.slice(0, -5), Number(match[1]));
  }
}

const agentNames = new Set(expectedAgents);
for (const agent of expectedAgents) {
  const filePath = path.join(agentDirectory, agent + ".md");
  if (!fs.existsSync(filePath)) continue;
  const content = fs.readFileSync(filePath, "utf8");
  const label = relative(filePath);

  for (const section of requiredSections) {
    const heading = "## " + section;
    if (!content.includes(heading)) {
      fail(label + " is missing required section: " + heading);
    }
  }

  const referencedSkills = skillNames.filter((skill) =>
    new RegExp(
      "(^|[^a-z0-9-])" + escaped(skill) + "([^a-z0-9-]|$)",
      "i",
    ).test(content),
  );
  if (
    !["lifecycle-agent", "review-fix-agent"].includes(agent) &&
    referencedSkills.length === 0
  ) {
    fail(label + " has no reference to an existing Skill");
  }

  const contractReferences = [
    ...content.matchAll(/\b([A-Z][A-Za-z]+)\s+v(\d+)\b/g),
  ];
  for (const match of contractReferences) {
    const contract = match[1];
    const requestedVersion = Number(match[2]);
    const actualVersion = schemaVersions.get(contract);
    if (actualVersion === undefined) {
      fail(
        label + " references unknown contract " + contract + " v" +
          requestedVersion,
      );
    } else if (actualVersion !== requestedVersion) {
      fail(
        label + " references " + contract + " v" + requestedVersion +
          ", existing schema is v" + actualVersion,
      );
    }
  }

  const executableProcedureLines = content
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:git|gh)(?:\s|$)/i.test(line));
  if (executableProcedureLines.length > 0) {
    fail(label + " contains executable Git/GitHub procedure lines");
  }
  if (/\b(?:git|gh)\s+[a-z][^\r\n]*/.test(content)) {
    fail(label + " contains an inline Git/GitHub command procedure");
  }

  const crossAgentReferences = [...agentNames].filter(
    (other) => other !== agent && content.includes(other),
  );
  if (agent === "lifecycle-agent") {
    const allowed = new Set([
      "issue-agent",
      "preparation-agent",
      "delivery-agent",
    ]);
    for (const reference of crossAgentReferences) {
      if (!allowed.has(reference)) {
        fail(label + " references disallowed cross-Agent owner " + reference);
      }
    }
  } else if (agent === "review-fix-agent") {
    for (const reference of crossAgentReferences) {
      if (reference !== "feedback-agent") {
        fail(label + " references disallowed router target " + reference);
      }
    }
  } else if (crossAgentReferences.length > 0) {
    fail(
      label + " contains cross-Agent references: " +
        crossAgentReferences.join(", "),
    );
  }
}

const graphYaml = read("plugin/shared/graphs/handoff-graph.yaml");
const graphMmd = read("plugin/shared/graphs/handoff-graph.mmd");
if (!graphYaml.includes("version: 1")) {
  fail("handoff-graph.yaml is not HandoffGraph v1");
}
if (
  !graphYaml.includes(
    'base_commit: "9f926cee06e514404423eb2c351f533505a5df23"',
  )
) {
  fail("handoff-graph.yaml is not synchronized to the verified master base");
}
for (const agent of expectedAgents) {
  if (!graphYaml.includes("agent:" + agent)) {
    fail("handoff-graph.yaml is missing agent node agent:" + agent);
  }
  if (!graphMmd.includes("agent: " + agent)) {
    fail("handoff-graph.mmd is missing agent projection agent: " + agent);
  }
}
if (!graphYaml.includes("agent_state_machine_policy:")) {
  fail("handoff-graph.yaml is missing agent state-machine policy metadata");
}
if (
  !graphYaml.includes('compatibility_router: "agent:review-fix-agent"')
) {
  fail("handoff-graph.yaml is missing the review-fix compatibility router");
}
if (!graphYaml.includes('consumer: "agent:review-fix-agent"')) {
  fail("handoff-graph.yaml does not route auto-review-fix-pr through review-fix-agent");
}
if (!graphYaml.includes('id: "edge:handoff:review-fix-agent:feedback"')) {
  fail("handoff-graph.yaml is missing the review-fix to feedback handoff");
}

const scenario = read("plugin/docs/workflows/agent-state-machine-scenarios.md");
for (const agent of expectedAgents) {
  if (!scenario.includes("| " + agent + " |")) {
    fail("Scenario matrix is missing agent row: " + agent);
  }
}
for (const phrase of [
  "Happy path",
  "Missing or conflicting identity",
  "Missing or denied authorization",
  "Partial or unverified external result",
  "Resumable state",
  "Terminal outcomes and source",
]) {
  if (!scenario.includes(phrase)) {
    fail("Scenario matrix is missing column: " + phrase);
  }
}

const codexManifestPath = path.join(
  repositoryRoot,
  "plugin",
  ".codex-plugin",
  "plugin.json",
);
try {
  const manifest = JSON.parse(fs.readFileSync(codexManifestPath, "utf8"));
  const prompts = manifest?.interface?.defaultPrompt;
  if (!Array.isArray(prompts)) {
    fail("Codex manifest has no interface.defaultPrompt array");
  } else {
    for (const prompt of prompts) {
      if (/^Start the thin\b/i.test(prompt)) {
        fail("Codex defaultPrompt still contains a step-by-step Agent activation");
      }
      if (/^\s*(?:git|gh)(?:\s|$)/im.test(prompt)) {
        fail("Codex defaultPrompt contains an executable Git/GitHub command");
      }
    }
  }
} catch (error) {
  fail("Codex manifest is not valid JSON: " + error.message);
}

for (const forbidden of ["package.json", "plugin/package.json"]) {
  if (fs.existsSync(path.join(repositoryRoot, forbidden))) {
    fail("Repository-local runtime metadata must remain absent: " + forbidden);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error("FAIL: " + failure);
  process.exitCode = 1;
} else {
  console.log(
    "PASS: " + expectedAgents.length +
      " orchestration Agents, graph coverage, scenario coverage, contract references, and host-prompt boundaries verified.",
  );
}
