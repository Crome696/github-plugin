import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const failures = [];

function repositoryPath(relativePath) {
  return resolve(repositoryRoot, relativePath);
}

function readRepositoryFile(relativePath) {
  try {
    return readFileSync(repositoryPath(relativePath), "utf8");
  } catch (error) {
    failures.push(`${relativePath}: cannot read file (${error.message})`);
    return "";
  }
}

function check(name, condition, evidence) {
  if (condition) {
    console.log(`PASS ${name}`);
    return;
  }

  failures.push(`${name}: ${evidence}`);
  console.error(`FAIL ${name}: ${evidence}`);
}

function requiresText(name, text, pattern, evidence) {
  check(name, pattern.test(text), evidence);
}

function selectBaseBranch({ verifiedDefaultBranch, explicitTarget }) {
  if (typeof explicitTarget === "string" && explicitTarget.length > 0) {
    return { status: "explicit", baseBranch: explicitTarget };
  }

  if (["main", "master"].includes(verifiedDefaultBranch)) {
    return { status: "default", baseBranch: verifiedDefaultBranch };
  }

  return { status: "blocked", baseBranch: null };
}

function evaluateExistingPullRequest({ existingBaseBranch, requiredBaseBranch }) {
  if (existingBaseBranch === requiredBaseBranch) {
    return { status: "matching", silentlyRetarget: false };
  }

  return { status: "mismatch", silentlyRetarget: false };
}

const policy = readRepositoryFile("plugin/rules/pull-request-policy.mdc");
const draftSchema = readRepositoryFile("plugin/shared/schemas/PullRequestDraft.yaml");
const repositoryContext = readRepositoryFile("plugin/shared/schemas/RepositoryContext.yaml");
const repositoryConventions = readRepositoryFile("plugin/shared/schemas/RepositoryConventions.yaml");
const createDraftSkill = readRepositoryFile("plugin/skills/create-draft-pr/SKILL.md");
const preCreateHook = readRepositoryFile("plugin/hooks/pre-pr-create.mjs");

check(
  "always-on MDC rule",
  /^alwaysApply:\s*true\s*$/m.test(policy),
  "plugin/rules/pull-request-policy.mdc must keep alwaysApply: true",
);

const policyClauses = [
  [
    "verified default branch source",
    /verify the\s+repository's configured default branch from repository metadata/i,
    "the policy must require repository-metadata verification",
  ],
  [
    "main/master default",
    /If the verified default branch is `main` or `master`[\s\S]*?use that exact branch[\s\S]*?base_branch/i,
    "the verified main/master branch must be the default base",
  ],
  [
    "no main/master guessing",
    /MUST NOT\s+guess between `main` and `master`[\s\S]*?(local branch|remote name|GitHub CLI default)/i,
    "the policy must forbid inferred main/master selection",
  ],
  [
    "explicit alternative preservation",
    /non-default base branch is allowed only when its exact name is explicitly[\s\S]*?Carry that exact value through[\s\S]*?post-creation verification/i,
    "an explicit alternative must remain exact through creation and verification",
  ],
  [
    "unrecognized default blocks",
    /verified default branch is neither `main` nor `master`[\s\S]*?MUST block[\s\S]*?explicitly supplied and verified/i,
    "a non-main/master default must block without an explicit verified target",
  ],
  [
    "existing PR retargeting is not silent",
    /existing pull request whose base branch does not match[\s\S]*?NOT be silently retargeted/i,
    "mismatched existing pull requests must be returned for explicit resolution",
  ],
  [
    "head push is separate",
    /Pushing the implementation\/head branch is a separate operation[\s\S]*?read-only/i,
    "head publication must remain separate from base-branch selection",
  ],
];

for (const [name, pattern, evidence] of policyClauses) {
  requiresText(`policy clause: ${name}`, policy, pattern, evidence);
}

check(
  "RepositoryContext default branch carrier",
  /repository:[\s\S]*?default_branch:\s*\n\s*type:\s*string \| null/i.test(repositoryContext),
  "RepositoryContext must expose repository.default_branch",
);
check(
  "RepositoryConventions default branch carrier",
  /repository:[\s\S]*?default_branch:\s*\n\s*type:\s*string \| null/i.test(repositoryConventions),
  "RepositoryConventions must expose repository.default_branch",
);

const requiredBlock = draftSchema.match(/required:\s*([\s\S]*?)\nfields:/i)?.[1] ?? "";
check(
  "PullRequestDraft base branch field",
  /-\s*base_branch\b/.test(requiredBlock) && /\n\s*base_branch:\s*\n\s*type:\s*string/i.test(draftSchema),
  "PullRequestDraft must require a typed base_branch",
);
check(
  "PullRequestDraft post-create base verification",
  /base branch, head branch, and head SHA are verified after creation/i.test(draftSchema) &&
    /base_branch_match:/i.test(draftSchema),
  "the Draft contract must carry and verify the exact base branch",
);
check(
  "create-draft-pr explicit base command",
  /gh pr create[^\n]*--base <base_branch>[^\n]*--head <head_branch>/i.test(createDraftSkill),
  "create-draft-pr must pass --base explicitly",
);
check(
  "create-draft-pr live base verification",
  /baseRefName.*base_branch/i.test(createDraftSkill) && /base_branch_match/i.test(createDraftSkill),
  "create-draft-pr must compare the live baseRefName with base_branch",
);
check(
  "pre-pr-create command-to-gate base comparison",
  /const commandBase = commandValues\.get\("--base"\)[\s\S]*?commandBase !== draft\.base_branch/i.test(preCreateHook),
  "pre-pr-create must reject a command base that differs from the approved gate",
);

const scenarios = [
  {
    name: "verified main defaults to main",
    input: { verifiedDefaultBranch: "main", explicitTarget: null },
    expected: { status: "default", baseBranch: "main" },
  },
  {
    name: "verified master defaults to master",
    input: { verifiedDefaultBranch: "master", explicitTarget: null },
    expected: { status: "default", baseBranch: "master" },
  },
  {
    name: "unrecognized default blocks without an explicit target",
    input: { verifiedDefaultBranch: "trunk", explicitTarget: null },
    expected: { status: "blocked", baseBranch: null },
  },
  {
    name: "explicit alternative is preserved exactly",
    input: { verifiedDefaultBranch: "master", explicitTarget: "release/2026-08" },
    expected: { status: "explicit", baseBranch: "release/2026-08" },
    evaluate: selectBaseBranch,
  },
  {
    name: "existing mismatched base requires explicit resolution",
    input: { existingBaseBranch: "develop", requiredBaseBranch: "master" },
    expected: { status: "mismatch", silentlyRetarget: false },
    evaluate: evaluateExistingPullRequest,
  },
];

for (const scenario of scenarios) {
  const actual = (scenario.evaluate ?? selectBaseBranch)(scenario.input);
  check(
    `scenario: ${scenario.name}`,
    actual.status === scenario.expected.status && actual.baseBranch === scenario.expected.baseBranch,
    `expected ${JSON.stringify(scenario.expected)} but received ${JSON.stringify(actual)}`,
  );
}

if (failures.length > 0) {
  console.error(`Pull-request policy validation failed with ${failures.length} finding(s).`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${policyClauses.length} policy clauses, typed base-branch carriers, creation gates, and ${scenarios.length} selection scenarios.`);
}
