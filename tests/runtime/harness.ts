import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

import {
  HOOK_NAMES,
  type ExactCommandRule,
  type FakeCommandConfig,
  type FakeCommandLogEntry,
  type FakeCommandRule,
  type GateOptions,
  type GraphqlCommandRule,
  type Host,
  type HookName,
  type RuntimeContext,
  type RuntimeExecution,
  type RuntimeMode,
} from "./types.js";

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(runtimeDirectory, "..", "..");
const pluginRoot = join(repositoryRoot, "plugin");
const generatorPath = join(pluginRoot, "hooks", "generate-project-hooks.mjs");
const fakeRunnerPath = join(runtimeDirectory, "fake-command-runner.mjs");
const fakeExecFileShimPath = join(runtimeDirectory, "fake-execfile-shim.cjs");
const runtimeTimeoutMs = 10_000;
const fakeCommandTimeoutMs = 500;
const stagedIndexFingerprintArgs = [
  "diff",
  "--cached",
  "--raw",
  "-z",
  "--no-renames",
  "--full-index",
  "--abbrev=40",
  "--no-ext-diff",
  "--no-textconv",
];
const commitMessage = "Runtime oracle\n\nExecute generated project hooks.\n";
const credentialsToRemove = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "GIT_ASKPASS",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "GIT_SSH_COMMAND",
  "GCM_INTERACTIVE",
  "GIT_CONFIG_COUNT",
];

const sha = (digit: string) => digit.repeat(40);
const now = () => new Date(Date.now() - 1_000).toISOString();

const isWindows = process.platform === "win32";
const pathEnvironmentKey = () =>
  Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";

const isolatedEnvironment = (root: string, shimDirectory?: string): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of credentialsToRemove) delete environment[key];

  const isolatedHome = join(root, ".runtime-home");
  const isolatedConfig = join(root, ".runtime-config");
  mkdirSync(isolatedHome, { recursive: true });
  mkdirSync(isolatedConfig, { recursive: true });
  writeFileSync(join(isolatedConfig, "global.gitconfig"), "", "utf8");

  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = join(isolatedConfig, "global.gitconfig");
  environment.XDG_CONFIG_HOME = isolatedConfig;
  environment.HOME = isolatedHome;
  environment.USERPROFILE = isolatedHome;
  environment.GH_CONFIG_DIR = join(isolatedConfig, "gh");
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.CI = "1";

  if (shimDirectory) {
    const key = pathEnvironmentKey();
    const originalPath = environment[key] ?? "";
    const pathValue = [shimDirectory, originalPath].filter(Boolean).join(sep);
    environment[key] = pathValue;
    environment.PATH = pathValue;
    environment.Path = pathValue;
  }
  return environment;
};

const runRealGit = (root: string, args: string[], environment: NodeJS.ProcessEnv) =>
  execFileSync("git", ["-C", root, ...args], {
    cwd: root,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: runtimeTimeoutMs,
  });

const runRealGitBuffer = (root: string, args: string[], environment: NodeJS.ProcessEnv) =>
  execFileSync("git", ["-C", root, ...args], {
    cwd: root,
    env: environment,
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: runtimeTimeoutMs,
  });

const sha256Bytes = (value: Buffer) => createHash("sha256").update(value).digest("hex");

const createRepositoryAtRoot = (root: string): RuntimeContext => {
  const environment = isolatedEnvironment(root);
  execFileSync("git", ["init", "--initial-branch", "master", root], {
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: runtimeTimeoutMs,
  });
  runRealGit(root, ["config", "user.name", "CromeSDK Runtime Oracle"], environment);
  runRealGit(root, ["config", "user.email", "runtime@example.invalid"], environment);

  const runtimeFileRelativePath = "runtime-oracle.txt";
  const runtimeFilePath = join(root, runtimeFileRelativePath);
  const bodyPath = join(root, "draft-pr-body.md");
  const messageDirectory = mkdtempSync(join(tmpdir(), "cromesdk-commit-message-"));
  const messagePath = join(messageDirectory, "message files", "runtime-commit-message.txt");
  mkdirSync(dirname(messagePath), { recursive: true });
  const reviewPayloadPath = join(root, "review-payload.json");
  writeFileSync(join(root, "README.md"), "runtime-oracle baseline\n", "utf8");
  writeFileSync(runtimeFilePath, "runtime oracle fixture\n", "utf8");
  runRealGit(root, ["add", "README.md"], environment);
  runRealGit(root, ["commit", "-m", "runtime oracle baseline"], environment);
  writeFileSync(messagePath, commitMessage, "utf8");
  runRealGit(root, ["add", runtimeFileRelativePath], environment);
  const stagedIndexDiff = runRealGitBuffer(root, stagedIndexFingerprintArgs, environment);

  const repository = "Crome696/github-plugin";
  const branch = "feature/runtime-oracle";
  const baseBranch = "master";
  const pullRequestNumber = 1;
  const pullRequestUrl = `https://github.com/${repository}/pull/${pullRequestNumber}`;
  const issueNumber = 1;
  const issueUrl = `https://github.com/${repository}/issues/${issueNumber}`;
  const body = [
    "## Problem / issue context",
    "The runtime oracle needs an executable fixture.",
    "",
    "## Solution summary",
    "Run generated hooks in isolated repositories.",
    "",
    "## Key changes",
    "Add deterministic fake GitHub reads.",
    "",
    "## Tests and validations",
    "The generated entrypoints are executed.",
    "",
    "## Known limitations",
    "The fake command layer is read-only.",
    "",
    "## Risks",
    "No network access is permitted.",
    "",
    "## Issue linkage",
    `Fixes ${repository}#${issueNumber}`,
    "",
  ].join("\n");
  writeFileSync(bodyPath, body, "utf8");

  const baseSha = sha("b");
  const mergeCommitSha = sha("c");
  const headSha = runRealGit(root, ["rev-parse", "HEAD"], environment).trim();
  writeFileSync(
    reviewPayloadPath,
    JSON.stringify(
      {
        commit_id: headSha,
        body: "Runtime oracle review",
        event: "APPROVE",
        comments: [],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const shimDirectory = join(root, ".runtime-shims");
  const fakeConfigPath = join(root, ".runtime-fake-config.json");
  const fakeLogPath = join(root, ".runtime-fake-log.jsonl");
  mkdirSync(shimDirectory, { recursive: true });
  writeFileSync(fakeLogPath, "", "utf8");

  return {
    repositoryRoot: root,
    repository,
    branch,
    baseBranch,
    headSha,
    baseSha,
    mergeCommitSha,
    pullRequestNumber,
    pullRequestUrl,
    issueNumber,
    issueUrl,
    bodyPath,
    messageDirectory,
    messagePath,
    stagedIndexDiff,
    reviewPayloadPath,
    runtimeFilePath,
    runtimeFileRelativePath,
    fakeConfigPath,
    fakeLogPath,
    shimDirectory,
    fakeRunnerPath,
  };
};

const createRepository = (): RuntimeContext => {
  const root = mkdtempSync(join(tmpdir(), "cromesdk-github-hook-runtime-"));
  try {
    return createRepositoryAtRoot(root);
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
};

const createShims = (context: RuntimeContext) => {
  const nodePath = process.execPath;
  const runner = context.fakeRunnerPath;
  if (isWindows) {
    for (const name of ["git", "gh"]) {
      writeFileSync(
        join(context.shimDirectory, `${name}.cmd`),
        `@echo off\r\n"${nodePath}" "${runner}" ${name} %*\r\nexit /b %ERRORLEVEL%\r\n`,
        "utf8",
      );
    }
  } else {
    for (const name of ["git", "gh"]) {
      const path = join(context.shimDirectory, name);
      writeFileSync(
        path,
        `#!/bin/sh\nexec ${JSON.stringify(nodePath)} ${JSON.stringify(runner)} ${name} "$@"\n`,
        "utf8",
      );
      execFileSync("chmod", ["+x", path], { encoding: "utf8" });
    }
  }
};

export const cleanupRuntimeRepository = (context: RuntimeContext) => {
  rmSync(context.repositoryRoot, { recursive: true, force: true });
  rmSync(context.messageDirectory, { recursive: true, force: true });
};

export const createRuntimeContext = (): RuntimeContext => {
  const context = createRepository();
  try {
    createShims(context);
    const generation = spawnSync(
      process.execPath,
      [generatorPath, "--target", context.repositoryRoot, "--hosts", "both"],
      {
        cwd: pluginRoot,
        env: isolatedEnvironment(context.repositoryRoot),
        encoding: "utf8",
        timeout: runtimeTimeoutMs,
        windowsHide: true,
      },
    );
    if (generation.error || generation.status !== 0) {
      throw new Error(
        `Project-hook generation failed: ${generation.error?.message ?? generation.stderr ?? generation.stdout}`,
      );
    }
    const result = JSON.parse(generation.stdout) as { hosts?: string[]; status?: string };
    if (result.status !== "written" || result.hosts?.join(",") !== "cursor,codex") {
      throw new Error(`Project-hook generation returned an unexpected result: ${generation.stdout}`);
    }
    return context;
  } catch (error) {
    cleanupRuntimeRepository(context);
    throw error;
  }
};

const exact = (
  executable: "git" | "gh",
  args: string[],
  stdout = "",
  options: Omit<ExactCommandRule, "executable" | "args" | "stdout"> = {},
): ExactCommandRule => ({ executable, args, stdout, ...options });

const graphql = (
  queryIncludes: string,
  stdout: unknown,
  options: Omit<GraphqlCommandRule, "executable" | "match" | "queryIncludes" | "stdout"> = {},
): GraphqlCommandRule => ({
  executable: "gh",
  match: "graphql",
  queryIncludes,
  stdout: JSON.stringify(stdout),
  ...options,
});

const writeFakeConfig = (
  context: RuntimeContext,
  rules: FakeCommandRule[],
) => {
  writeFileSync(
    context.fakeConfigPath,
    JSON.stringify({ rules } satisfies FakeCommandConfig, null, 2),
    "utf8",
  );
  writeFileSync(context.fakeLogPath, "", "utf8");
};

const readFakeLog = (context: RuntimeContext): FakeCommandLogEntry[] =>
  readFileSync(context.fakeLogPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeCommandLogEntry);

const baseChildEnvironment = (context: RuntimeContext): NodeJS.ProcessEnv => {
  const environment = isolatedEnvironment(context.repositoryRoot, context.shimDirectory);
  environment.CROMESDK_RUNTIME_FAKE_CONFIG = context.fakeConfigPath;
  environment.CROMESDK_RUNTIME_FAKE_LOG = context.fakeLogPath;
  environment.CROMESDK_RUNTIME_FAKE_RUNNER = context.fakeRunnerPath;
  environment.CROMESDK_RUNTIME_FAKE_TIMEOUT_MS = String(fakeCommandTimeoutMs);
  environment.NODE_OPTIONS = `--require=${fakeExecFileShimPath}`;
  return environment;
};

const writeGate = (context: RuntimeContext, hook: HookName, gate: unknown) => {
  const path = join(context.repositoryRoot, ".cursor", "hooks", "state", `${hook}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(gate, null, 2), "utf8");
};

const removeGate = (context: RuntimeContext, hook: HookName) => {
  const path = join(context.repositoryRoot, ".cursor", "hooks", "state", `${hook}.json`);
  if (existsSync(path)) unlinkSync(path);
};

const gatePath = (context: RuntimeContext, hook: HookName) =>
  join(context.repositoryRoot, ".cursor", "hooks", "state", `${hook}.json`);

export const mutateGate = (
  context: RuntimeContext,
  hook: HookName,
  mutate: (gate: Record<string, unknown>) => void,
) => {
  const path = gatePath(context, hook);
  const gate = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  mutate(gate);
  writeFileSync(path, JSON.stringify(gate, null, 2), "utf8");
};

export const overwriteCommitMessage = (context: RuntimeContext, value: string) => {
  writeFileSync(context.messagePath, value, "utf8");
};

const cursorPayload = (command: string, cwd: string) => ({
  hook_event_name: "beforeShellExecution",
  command,
  cwd,
});

const codexPayload = (command: string, cwd: string, post = false) => ({
  hook_event_name: post ? "PostToolUse" : "PreToolUse",
  tool_name: "Bash",
  tool_input: { command, cwd },
});

export const payloadFor = (
  host: Host,
  command: string,
  cwd: string,
  post = false,
) => (host === "cursor" ? cursorPayload(command, cwd) : codexPayload(command, cwd, post));

export const commandFor = (context: RuntimeContext, hook: HookName): string => {
  switch (hook) {
    case "pre-commit":
      return `git -C "${context.repositoryRoot}" commit --cleanup=verbatim --file="${context.messagePath}"`;
    case "pre-pr-create":
      return `gh pr create --draft --repo ${context.repository} --base ${context.baseBranch} --head ${context.branch} --title \"Runtime Oracle\" --body-file draft-pr-body.md`;
    case "pre-review-submit":
      return `gh api repos/${context.repository}/pulls/${context.pullRequestNumber}/reviews --method POST --input review-payload.json`;
    case "pre-rebase":
      return `git rebase ${context.baseSha}`;
    case "pre-pr-ready":
      return `gh pr ready ${context.pullRequestNumber} --repo ${context.repository}`;
    case "pre-merge":
      return `gh pr merge ${context.pullRequestNumber} --repo ${context.repository} --merge`;
    case "post-merge":
      return `gh pr merge ${context.pullRequestNumber} --repo ${context.repository} --merge`;
  }
};

export const irrelevantCommandFor = (hook: HookName) => {
  if (hook === "pre-rebase") return "git status --short";
  if (hook === "post-merge") return "git status --short";
  return "printf runtime-oracle-irrelevant";
};

export const malformedCommandFor = (hook: HookName) => {
  switch (hook) {
    case "pre-commit":
      return "git commit \"unterminated";
    case "pre-pr-create":
      return "gh pr create --draft && echo unsupported";
    case "pre-review-submit":
      return "gh api repos/Crome696/github-plugin/pulls/1/reviews --method POST --input review-payload.json | echo unsupported";
    case "pre-rebase":
      return "git rebase master && echo unsupported";
    case "pre-pr-ready":
      return "gh pr ready 1 --repo Crome696/github-plugin && echo unsupported";
    case "pre-merge":
      return "gh pr merge 1 --repo Crome696/github-plugin --merge && echo unsupported";
    case "post-merge":
      return "gh pr merge 1 --repo Crome696/github-plugin --merge && echo unsupported";
  }
};

const validationSource = {
  implementation_plan_version: 1,
  working_tree_inspection_version: 1,
  change_classification_version: 1,
  unrelated_change_detection_version: 1,
  loaded_issue_version: 1,
  issue_analysis_version: 1,
  branch_workspace_version: 1,
  references: [],
  unavailable_inputs: [],
};

const validationResult = (context: RuntimeContext, draftReady: boolean) => ({
  schema: "ValidationResult",
  version: 1,
  status: "passed",
  workspace: {
    path: context.repositoryRoot,
    branch: context.branch,
    head_sha: context.headSha,
  },
  source: validationSource,
  checks: [],
  required_checks_passed: true,
  evaluation: {
    scope: { status: "aligned", evidence: ["runtime oracle fixture"] },
    acceptance_criteria: [],
    completion_criteria: [],
    planned_steps: [],
    unexpected_changes: [],
    documented_deviations: [],
  },
  blockers: [],
  warnings: [],
  readiness: {
    commit_preparation_allowed: true,
    draft_pr_preparation_allowed: draftReady,
    reasons: [],
  },
  failure: null,
  recommended_next_skill: null,
});

const issueIdentity = (context: RuntimeContext) => ({
  repository: context.repository,
  number: context.issueNumber,
  url: context.issueUrl,
});

const pullRequestIdentity = (context: RuntimeContext) => ({
  repository: context.repository,
  number: context.pullRequestNumber,
  url: context.pullRequestUrl,
});

const preCommitGate = (context: RuntimeContext) => ({
  schema: "PreCommitGate",
  version: 2,
  workspace: {
    repository: context.repository,
    path: context.repositoryRoot,
    branch: context.branch,
    head_sha: context.headSha,
  },
  validation: validationResult(context, false),
  commit_proposal: {
    schema: "CommitProposal",
    version: 1,
    status: "approved",
    repository: context.repository,
    branch: context.branch,
    files: {
      added: [context.runtimeFileRelativePath],
      modified: [],
      deleted: [],
    },
    message: {
      subject: "Runtime oracle",
      body: "Execute generated project hooks.",
    },
    authorization: {
      exact_scope_approved: true,
      commit_authorized: true,
      source: "explicit_user",
      task_scope: "Issue #3 runtime oracle",
      evidence: "The runtime fixture authorizes one exact commit scope.",
    },
    base_sha: null,
    validation: {
      result_status: "passed",
      evidence: ["runtime fixture validation"],
    },
  },
  commit_binding: {
    message_file: {
      path: context.messagePath,
      sha256: sha256Bytes(Buffer.from(commitMessage, "utf8")),
      byte_length: Buffer.byteLength(commitMessage, "utf8"),
    },
    staged_index: {
      format: "git-diff-cached-raw-z-no-renames-full-index-abbrev-40-v1",
      sha256: sha256Bytes(context.stagedIndexDiff),
      byte_length: context.stagedIndexDiff.length,
    },
  },
  written_at: now(),
});

const prePrCreateGate = (context: RuntimeContext) => {
  const issue = issueIdentity(context);
  const body = readFileSync(context.bodyPath, "utf8");
  return {
    schema: "PrePrCreateGate",
    version: 1,
    workspace: {
      repository: context.repository,
      path: context.repositoryRoot,
      branch: context.branch,
      head_sha: context.headSha,
    },
    validation: validationResult(context, true),
    commit_proposal: {
      schema: "CommitProposal",
      version: 1,
      status: "created",
      repository: context.repository,
      branch: context.branch,
      files: {
        added: [context.runtimeFileRelativePath],
        modified: [],
        deleted: [],
      },
      message: { subject: "Runtime oracle", body: "Execute generated hooks." },
      authorization: {
        exact_scope_approved: true,
        commit_authorized: true,
        source: "explicit_user",
        task_scope: "Issue #3 runtime oracle",
        evidence: "The created commit is bound to the runtime fixture.",
      },
      commit: {
        sha: context.headSha,
        created_at: now(),
        files_committed: [context.runtimeFileRelativePath],
      },
      validation: {
        result_status: "passed",
        evidence: ["runtime fixture validation"],
      },
    },
    branch_push: {
      schema: "BranchPush",
      version: 1,
      status: "verified",
      repository: context.repository,
      branch_name: context.branch,
      worktree_path: context.repositoryRoot,
      remote: {
        name: "origin",
        owner_repository: context.repository,
      },
      upstream: {
        exists: true,
        ref: `refs/remotes/origin/${context.branch}`,
        ahead: 0,
        behind: 0,
      },
      local: {
        head_sha: context.headSha,
        branch_match: true,
        detached: false,
        in_progress_operation: null,
        dirty: false,
      },
      push: {
        attempted: true,
        forced: false,
        force_mode: null,
        remote_ref: `refs/heads/${context.branch}`,
        remote_sha: context.headSha,
        result: "success",
      },
      authorization: {
        push_authorized: true,
        force_push_authorized: false,
      },
      verification: {
        repository_match: "pass",
        branch_match: "pass",
        remote_branch_exists: "pass",
        sha_match: "pass",
        upstream_configured: "pass",
      },
      failure: null,
    },
    pull_request_draft: {
      schema: "PullRequestDraft",
      version: 1,
      status: "draft",
      repository: context.repository,
      title: "Runtime Oracle",
      body,
      base_branch: context.baseBranch,
      head_branch: context.branch,
      head_sha: context.headSha,
      draft: true,
      linked_issues: [issue],
      validation: {
        result_status: "passed",
        evidence: ["runtime fixture validation"],
      },
      authorization: {
        push_authorized: true,
        draft_pull_request_authorized: true,
        source: "explicit_user",
        task_scope: "Issue #3 runtime oracle",
        evidence: "The exact Draft PR payload is authorized for the fixture.",
      },
    },
    issue_link: {
      schema: "PullRequestIssueLink",
      version: 1,
      status: "linked",
      repository: context.repository,
      issue,
      pull_request: {
        repository: context.repository,
        number: context.pullRequestNumber,
        url: context.pullRequestUrl,
        base_branch: context.baseBranch,
        head_branch: context.branch,
        head_sha: context.headSha,
        draft: true,
      },
      linkage_kind: "fixes",
      closes_issue_on_merge: true,
      keyword_text: `Fixes ${context.repository}#${context.issueNumber}`,
      linked_issues: [issue],
      evidence: ["runtime fixture issue linkage"],
      rationale: "One exact issue is linked by the approved body.",
      blockers: [],
      ambiguous_candidates: [],
      failure: null,
    },
    written_at: now(),
  };
};

const preReviewSubmitGate = (context: RuntimeContext) => ({
  schema: "PreReviewSubmitGate",
  version: 1,
  workspace: {
    repository: context.repository,
    path: context.repositoryRoot,
    branch: context.branch,
  },
  review_decision: {
    schema: "ReviewDecision",
    version: 1,
    status: "approved",
    repository: context.repository,
    pull_request: pullRequestIdentity(context),
    head_sha: context.headSha,
    proposed_event: "APPROVE",
    summary: "Runtime oracle review",
    findings: [],
    inline_comments: [],
    approval: {
      exact_payload: true,
      explicit_event_authorization: true,
      approved_at: now(),
    },
  },
  classified_findings: {
    schema: "ClassifiedReviewFindings",
    version: 1,
    status: "classified",
    repository: context.repository,
    pull_request: pullRequestIdentity(context),
    head_sha: context.headSha,
    findings: [],
  },
  deduplicated_findings: {
    schema: "DeduplicatedReviewFindings",
    version: 1,
    status: "deduplicated",
    repository: context.repository,
    pull_request: pullRequestIdentity(context),
    head_sha: context.headSha,
    findings: [],
    suppressed: [],
  },
  confirmation: {
    repository: context.repository,
    pull_request_number: context.pullRequestNumber,
    head_sha: context.headSha,
    confirmed_at: now(),
    entries: [],
  },
  freshness: {
    head_sha: context.headSha,
    pull_request_state: "open",
    verified_at: now(),
    findings: [],
    inline_comments: [],
  },
  written_at: now(),
});

const preRebaseGate = (context: RuntimeContext) => ({
  schema: "PreRebaseGate",
  version: 1,
  workspace: {
    repository: context.repository,
    path: context.repositoryRoot,
    branch: context.branch,
    head_sha: context.headSha,
  },
  pull_request: {
    ...pullRequestIdentity(context),
    base_branch: context.baseBranch,
    base_branch_candidates: [context.baseBranch],
    head_branch: context.branch,
    head_sha: context.headSha,
  },
  target_fetch: {
    schema: "TargetBranchFetch",
    version: 1,
    status: "verified",
    repository: context.repository,
    remote: {
      name: "origin",
      owner_repository: context.repository,
      fetch_url_sanitized: `https://github.com/${context.repository}.git`,
    },
    branch_name: context.baseBranch,
    remote_ref: `refs/heads/${context.baseBranch}`,
    tracking_ref: `refs/remotes/origin/${context.baseBranch}`,
    remote_sha: context.baseSha,
    tracking_sha: context.baseSha,
    authorization: { approved: true, evidence: "runtime target fetch" },
    fetch: { attempted: true, result: "success", evidence: ["runtime fetch"] },
    verification: {
      repository_match: "pass",
      remote_branch_exists: "pass",
      tracking_ref_exists: "pass",
      sha_match: "pass",
    },
    failure: null,
    recommended_next_skill: null,
  },
  authorization: {
    approved: true,
    exact_target: true,
    exact_operation: true,
    source: "explicit_user",
    evidence: "The exact runtime rebase target is authorized.",
    approved_at: now(),
  },
  written_at: now(),
});

const prePrReadyGate = (context: RuntimeContext) => ({
  schema: "PrePrReadyGate",
  version: 1,
  workspace: {
    repository: context.repository,
    path: context.repositoryRoot,
  },
  pull_request: {
    ...pullRequestIdentity(context),
    base_branch: context.baseBranch,
    head_branch: context.branch,
  },
  expected_head_sha: context.headSha,
  is_draft: true,
  linked_issue: { ...issueIdentity(context), unique: true },
  reviewers: { add: [] },
  authorization: {
    exact_target: true,
    exact_ready_operation: true,
    ready_authorized: true,
    reviewers_authorized: true,
    source: "explicit_user",
    evidence: "The exact Ready-for-Review operation is authorized.",
  },
  written_at: now(),
});

const preMergeGate = (context: RuntimeContext) => ({
  schema: "PreMergeGate",
  version: 1,
  workspace: {
    repository: context.repository,
    path: context.repositoryRoot,
  },
  pull_request: {
    ...pullRequestIdentity(context),
    base_branch: context.baseBranch,
    head_branch: context.branch,
  },
  expected_head_sha: context.headSha,
  expected_base_sha: context.baseSha,
  merge: {
    method: "merge",
    delete_branch: false,
    commit_title: null,
    commit_message: null,
  },
  authorization: {
    exact_target: true,
    exact_merge_operation: true,
    merge_authorized: true,
    delete_branch_authorized: false,
    source: "explicit_user",
    evidence: "The exact merge operation is authorized.",
    approved_at: now(),
  },
  readiness: {
    schema: "MergeReadiness",
    version: 2,
    status: "ready",
    repository: context.repository,
    pull_request: pullRequestIdentity(context),
    head_sha: context.headSha,
    base_branch: context.baseBranch,
    mergeability: "mergeable",
    blockers: [],
    remaining_conditions: [],
    uncertainties: [],
    checks: [],
    review_state: {
      approval_count: 0,
      change_request_count: 0,
      evidence_status: "known",
      approval_inspection_status: "inspected",
      required_approvals: 0,
      required_approvals_met: true,
      unresolved_threads: 0,
      approval_policy_evidence: ["runtime review policy"],
    },
    issue_coverage: {
      status: "covered",
      issue: issueIdentity(context),
      evidence: ["runtime issue relationship"],
    },
    evidence: {
      status: "complete",
      head_sha: context.headSha,
      sources: [{ name: "runtime", status: "loaded", evidence: ["fixture"] }],
    },
  },
  written_at: now(),
});

export const buildGate = (
  context: RuntimeContext,
  hook: HookName,
  options: GateOptions = {},
) => {
  if (options.malformed) {
    return { schema: hook, version: 999, malformed: true };
  }
  let gate: Record<string, unknown>;
  switch (hook) {
    case "pre-commit":
      gate = preCommitGate(context);
      break;
    case "pre-pr-create":
      gate = prePrCreateGate(context);
      break;
    case "pre-review-submit":
      gate = preReviewSubmitGate(context);
      break;
    case "pre-rebase":
      gate = preRebaseGate(context);
      break;
    case "pre-pr-ready":
      gate = prePrReadyGate(context);
      break;
    case "pre-merge":
      gate = preMergeGate(context);
      break;
    case "post-merge":
      gate = preMergeGate(context);
      break;
  }
  if (options.stale) {
    if (hook === "pre-merge") gate.expected_head_sha = sha("d");
    else if (hook === "pre-pr-ready") gate.expected_head_sha = sha("d");
    else if (hook === "pre-rebase") gate.workspace = { ...(gate.workspace as object), head_sha: sha("d") };
    else if (hook === "pre-commit") gate.workspace = { ...(gate.workspace as object), head_sha: sha("d") };
    else if (hook === "pre-pr-create") gate.workspace = { ...(gate.workspace as object), head_sha: sha("d") };
    else if (hook === "pre-review-submit") {
      gate.review_decision = { ...(gate.review_decision as object), head_sha: sha("d") };
    }
  }
  if (options.mismatched && hook === "pre-rebase") {
    gate.pull_request = {
      ...(gate.pull_request as Record<string, unknown>),
      base_branch: "release/2.x",
      base_branch_candidates: ["release/2.x"],
    };
  }
  return gate;
};

const gitIdentityRules = (context: RuntimeContext, includeBranch = true): ExactCommandRule[] => [
  exact("git", ["rev-parse", "--show-toplevel"], context.repositoryRoot),
  ...(includeBranch ? [exact("git", ["branch", "--show-current"], context.branch)] : []),
  exact("git", ["rev-parse", "--verify", "HEAD^{commit}"], context.headSha),
  exact("git", ["-C", context.repositoryRoot, "rev-parse", "--show-toplevel"], context.repositoryRoot),
  ...(includeBranch
    ? [exact("git", ["-C", context.repositoryRoot, "branch", "--show-current"], context.branch)]
    : []),
  exact(
    "git",
    ["-C", context.repositoryRoot, "rev-parse", "--verify", "HEAD^{commit}"],
    context.headSha,
  ),
];

const stagedDiffForMode = (context: RuntimeContext, mode: RuntimeMode): Buffer => {
  const original = context.stagedIndexDiff;
  const text = original.toString("utf8");
  if (mode === "staged-path") {
    return Buffer.from(text.replaceAll(context.runtimeFileRelativePath, "other-runtime-oracle.txt"), "utf8");
  }
  if (mode === "staged-mode") {
    return Buffer.from(text.replace(":000000 100644", ":000000 100755"), "utf8");
  }
  if (mode === "staged-blob") {
    const match = /(:\d{6} \d{6} [0-9a-f]{40} )([0-9a-f]{40})/.exec(text);
    if (!match) throw new Error("The runtime staged diff did not contain a full blob id.");
    return Buffer.from(text.replace(match[0], `${match[1]}${"f".repeat(40)}`), "utf8");
  }
  if (mode === "staged-deletion") {
    const match = /:000000 100644 0{40} ([0-9a-f]{40})/.exec(text);
    if (!match) throw new Error("The runtime staged diff did not contain the expected added file.");
    return Buffer.from(
      `:100644 000000 ${match[1]} ${"0".repeat(40)} D\0${context.runtimeFileRelativePath}\0`,
      "utf8",
    );
  }
  return original;
};

const preCommitStateRules = (
  context: RuntimeContext,
  state: "clean" | "unmerged" = "clean",
  stagedDiff = context.stagedIndexDiff,
): ExactCommandRule[] => [
  ...["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "rebase-merge", "rebase-apply", "sequencer"].map(
    (marker) =>
      exact(
        "git",
        ["-C", context.repositoryRoot, "rev-parse", "--git-path", marker],
        marker === "MERGE_HEAD" && state === "unmerged" ? ".git/MERGE_HEAD" : `.git/${marker}`,
      ),
  ),
  exact(
    "git",
    ["-C", context.repositoryRoot, ...stagedIndexFingerprintArgs],
    stagedDiff.toString("utf8"),
  ),
  exact(
    "git",
    ["-C", context.repositoryRoot, "status", "--porcelain=v1", "--untracked-files=all", "-z"],
    state === "clean" ? "A  runtime-oracle.txt\0" : "UU runtime-oracle.txt\0",
  ),
  exact("git", ["-C", context.repositoryRoot, "ls-files", "-u"], state === "unmerged" ? "100644 deadbeef\t1\truntime-oracle.txt\n" : ""),
  exact("git", ["-C", context.repositoryRoot, "show", ":runtime-oracle.txt"], "runtime oracle fixture\n"),
];

const remoteBranchRules = (context: RuntimeContext): ExactCommandRule[] => [
  exact(
    "git",
    ["-C", context.repositoryRoot, "ls-remote", "--heads", "origin", context.branch],
    `${context.headSha}\trefs/heads/${context.branch}\n`,
  ),
];

const preReviewLivePullRequest = (context: RuntimeContext) =>
  JSON.stringify({
    headRefOid: context.headSha,
    state: "OPEN",
    url: context.pullRequestUrl,
  });

const prePrReadyLivePullRequest = (context: RuntimeContext) =>
  JSON.stringify({
    number: context.pullRequestNumber,
    url: context.pullRequestUrl,
    isDraft: true,
    state: "OPEN",
    baseRefName: context.baseBranch,
    headRefName: context.branch,
    headRefOid: context.headSha,
  });

const preMergeLivePullRequest = (context: RuntimeContext) =>
  JSON.stringify({
    number: context.pullRequestNumber,
    url: context.pullRequestUrl,
    state: "OPEN",
    isDraft: false,
    baseRefName: context.baseBranch,
    baseRefOid: context.baseSha,
    headRefName: context.branch,
    headRefOid: context.headSha,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviews: [],
    reviewDecision: null,
    statusCheckRollup: [],
    body: `Fixes ${context.repository}#${context.issueNumber}`,
  });

const preMergeReviewThreadsGraphql = {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  },
};

const preMergeClosingIssuesGraphql = (context: RuntimeContext) => ({
  data: {
    repository: {
      pullRequest: {
        closingIssuesReferences: {
          nodes: [
            {
              number: context.issueNumber,
              url: context.issueUrl,
              repository: { nameWithOwner: context.repository },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  },
});

const preMergeRules = (context: RuntimeContext): FakeCommandRule[] => [
  ...gitIdentityRules(context, false),
  exact(
    "gh",
    [
      "pr",
      "view",
      String(context.pullRequestNumber),
      "--repo",
      context.repository,
      "--json",
      "number,url,state,isDraft,baseRefName,baseRefOid,headRefName,headRefOid,mergeable,mergeStateStatus,reviews,reviewDecision,statusCheckRollup,body",
    ],
    preMergeLivePullRequest(context),
  ),
  exact(
    "gh",
    ["api", `repos/${context.repository}/branches/${context.baseBranch}`],
    JSON.stringify({ commit: { sha: context.baseSha } }),
  ),
  graphql("reviewThreads", preMergeReviewThreadsGraphql),
  graphql("closingIssuesReferences", preMergeClosingIssuesGraphql(context)),
  exact(
    "gh",
    ["api", `repos/${context.repository}/issues/${context.issueNumber}`],
    JSON.stringify({ number: context.issueNumber, html_url: context.issueUrl, state: "open" }),
  ),
];

const preRebaseRules = (context: RuntimeContext, activeOperation = false): FakeCommandRule[] => [
  ...gitIdentityRules(context),
  exact(
    "git",
    ["-C", context.repositoryRoot, "worktree", "list", "--porcelain"],
    [
      `worktree ${join(context.repositoryRoot, "primary-checkout")}`,
      `HEAD ${context.baseSha}`,
      "branch refs/heads/master",
      "",
      `worktree ${context.repositoryRoot}`,
      `HEAD ${context.headSha}`,
      `branch refs/heads/${context.branch}`,
      "",
    ].join("\n"),
  ),
  exact("git", ["-C", context.repositoryRoot, "status", "--porcelain=v1", "--untracked-files=all"], ""),
  exact("git", ["-C", context.repositoryRoot, "ls-files", "--unmerged"], ""),
  ...["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "rebase-merge", "rebase-apply", "sequencer"].map(
    (marker) =>
      exact(
        "git",
        ["-C", context.repositoryRoot, "rev-parse", "--git-path", marker],
        activeOperation && marker === "MERGE_HEAD" ? ".git/MERGE_HEAD" : `.git/${marker}`,
      ),
  ),
  exact("git", ["-C", context.repositoryRoot, "remote"], "origin\n"),
  exact(
    "git",
    ["-C", context.repositoryRoot, "remote", "get-url", "--all", "origin"],
    `https://github.com/${context.repository}.git\n`,
  ),
  exact(
    "git",
    ["-C", context.repositoryRoot, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    "origin/master\n",
  ),
  exact(
    "git",
    ["-C", context.repositoryRoot, "rev-parse", "--verify", `refs/remotes/origin/${context.baseBranch}^{commit}`],
    context.baseSha,
  ),
  exact(
    "git",
    ["-C", context.repositoryRoot, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    `refs/remotes/origin/${context.branch}`,
  ),
  exact(
    "git",
    ["-C", context.repositoryRoot, "rev-parse", "--verify", `refs/remotes/origin/${context.branch}^{commit}`],
    context.headSha,
  ),
];

const postMergeRules = (context: RuntimeContext): FakeCommandRule[] => [
  ...gitIdentityRules(context, false),
  exact(
    "gh",
    [
      "pr",
      "view",
      String(context.pullRequestNumber),
      "--repo",
      context.repository,
      "--json",
      "number,url,state,mergedAt,mergeCommit,baseRefName,baseRefOid,headRefName,headRefOid,body",
    ],
    JSON.stringify({
      number: context.pullRequestNumber,
      url: context.pullRequestUrl,
      state: "MERGED",
      mergedAt: "2026-08-19T12:00:00.000Z",
      mergeCommit: context.mergeCommitSha,
      baseRefName: context.baseBranch,
      baseRefOid: context.baseSha,
      headRefName: context.branch,
      headRefOid: context.headSha,
      body: `Fixes ${context.repository}#${context.issueNumber}`,
    }),
  ),
  exact(
    "gh",
    ["repo", "view", context.repository, "--json", "nameWithOwner,defaultBranchRef"],
    JSON.stringify({ nameWithOwner: context.repository, defaultBranchRef: { name: "master" } }),
  ),
  exact(
    "gh",
    [
      "api",
      `repos/${context.repository}/compare/${encodeURIComponent(context.mergeCommitSha)}...${encodeURIComponent(context.baseBranch)}`,
    ],
    JSON.stringify({ status: "ahead" }),
  ),
  graphql("closingIssuesReferences", {
    data: {
      repository: {
        pullRequest: {
          closingIssuesReferences: {
            nodes: [
              {
                number: context.issueNumber,
                url: context.issueUrl,
                repository: { nameWithOwner: context.repository },
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    },
  }),
  exact(
    "gh",
    ["api", `repos/${context.repository}/issues/${context.issueNumber}`],
    JSON.stringify({
      number: context.issueNumber,
      html_url: context.issueUrl,
      state: "closed",
      closed_at: "2026-08-19T13:00:00.000Z",
    }),
  ),
  exact(
    "gh",
    [
      "api",
      "--paginate",
      "--slurp",
      `repos/${context.repository}/issues/${context.issueNumber}/timeline`,
      "-H",
      "Accept: application/vnd.github+json",
    ],
    JSON.stringify([
      [
        {
          event: "cross-referenced",
          source: { issue: { pull_request: { url: context.pullRequestUrl } } },
          commit_id: context.mergeCommitSha,
        },
      ],
    ]),
  ),
  exact("git", ["-C", context.repositoryRoot, "worktree", "list", "--porcelain"], ""),
  exact(
    "git",
    ["-C", context.repositoryRoot, "show-ref", "--verify", "--quiet", `refs/heads/${context.branch}`],
    "",
  ),
  exact("git", ["show-ref", "--verify", "--quiet", `refs/heads/${context.branch}`], ""),
  exact(
    "gh",
    ["api", `repos/${context.repository}/branches/${encodeURIComponent(context.branch)}`],
    JSON.stringify({ name: context.branch }),
  ),
  exact("git", ["worktree", "list", "--porcelain"], ""),
];

const reviewLiveRule = (context: RuntimeContext) =>
  exact(
    "gh",
    [
      "pr",
      "view",
      String(context.pullRequestNumber),
      "--repo",
      context.repository,
      "--json",
      "headRefOid,state,url",
    ],
    preReviewLivePullRequest(context),
  );

const readyLiveRule = (context: RuntimeContext) =>
  exact(
    "gh",
    [
      "pr",
      "view",
      String(context.pullRequestNumber),
      "--repo",
      context.repository,
      "--json",
      "number,url,isDraft,state,baseRefName,headRefName,headRefOid",
    ],
    prePrReadyLivePullRequest(context),
  );

const rulesFor = (
  context: RuntimeContext,
  hook: HookName,
  mode: RuntimeMode,
): FakeCommandRule[] => {
  if (mode === "irrelevant") return [];
  switch (hook) {
    case "pre-commit":
      return [
        ...gitIdentityRules(context),
        ...(mode === "allow" || mode === "unmerged-index" || mode === "message-bytes" || mode === "message-source" || mode.startsWith("staged-")
          ? preCommitStateRules(
              context,
              mode === "unmerged-index" ? "unmerged" : "clean",
              stagedDiffForMode(context, mode),
            )
          : []),
      ];
    case "pre-pr-create":
      return [...gitIdentityRules(context), ...remoteBranchRules(context)];
    case "pre-review-submit":
      return [...gitIdentityRules(context), reviewLiveRule(context)];
    case "pre-rebase":
      return preRebaseRules(context, mode === "active-operation");
    case "pre-pr-ready":
      return [...gitIdentityRules(context, false), readyLiveRule(context)];
    case "pre-merge":
      return preMergeRules(context);
    case "post-merge":
      return postMergeRules(context);
  }
};

const alterCliRule = (rules: FakeCommandRule[], mode: RuntimeMode) => {
  const rule = rules.find(
    (candidate): candidate is ExactCommandRule =>
      candidate.executable === "gh" && "args" in candidate && candidate.args[0] === "pr" && candidate.args[1] === "view",
  );
  if (!rule) return;
  if (mode === "cli-invalid-json") {
    rule.stdout = "not-json\n";
    rule.stderr = "";
    rule.exitCode = 0;
  } else if (mode === "cli-failure" || mode === "cli-auth-failure") {
    rule.stdout = "";
    rule.stderr = mode === "cli-auth-failure" ? "HTTP 401 Bad credentials\n" : "fake GitHub CLI failure\n";
    rule.exitCode = 1;
  } else if (mode === "cli-delay") {
    rule.delayMs = 80;
  }
};

const prepareMode = (context: RuntimeContext, hook: HookName, mode: RuntimeMode) => {
  removeGate(context, hook);
  if (mode !== "irrelevant" && mode !== "missing-gate") {
    writeGate(context, hook, buildGate(context, hook, {
      malformed: mode === "malformed-gate",
      stale: mode === "stale-gate",
      mismatched: mode === "mismatched-gate",
    }));
  }
  const rules = rulesFor(context, hook, mode);
  alterCliRule(rules, mode);
  writeFakeConfig(context, rules);
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const generatedConfigPath = (context: RuntimeContext, host: Host) =>
  join(context.repositoryRoot, `.${host}`, "hooks.json");

const configCommandFor = (context: RuntimeContext, host: Host, hook: HookName) => {
  const config = JSON.parse(readFileSync(generatedConfigPath(context, host), "utf8")) as JsonRecord;
  const hooks = isRecord(config.hooks) ? config.hooks : {};
  const eventName = host === "cursor"
    ? hook === "post-merge" ? "afterShellExecution" : "beforeShellExecution"
    : hook === "post-merge" ? "PostToolUse" : "PreToolUse";
  const operationIndex = hook === "post-merge" ? 0 : HOOK_NAMES.indexOf(hook);
  const definitions = hooks[eventName];
  if (!Array.isArray(definitions) || operationIndex < 0) return null;
  const definition = definitions[operationIndex];
  if (host === "cursor") {
    return isRecord(definition) && typeof definition.command === "string" ? definition.command : null;
  }
  if (!isRecord(definition) || !Array.isArray(definition.hooks)) return null;
  const nested = definition.hooks[0];
  return isRecord(nested) && typeof nested.command === "string" ? nested.command : null;
};

const routeFromCommand = (command: string | null) => {
  if (command === null) return null;
  const match = command.match(/\.(cursor|codex)[/\\]hooks[/\\]([^\s"']+\.mjs)/i);
  return match ? { host: match[1].toLowerCase() as Host, file: match[2] } : null;
};

const entrypointFor = (context: RuntimeContext, host: Host, hook: HookName) => {
  const command = configCommandFor(context, host, hook);
  const route = routeFromCommand(command);
  if (!route || route.host !== host) {
    return { command, route: route?.file ?? null, entrypoint: null };
  }
  return {
    command,
    route: route.file,
    entrypoint: join(context.repositoryRoot, `.${host}`, "hooks", route.file),
  };
};

const logsFor = (context: RuntimeContext) => {
  try {
    return readFakeLog(context);
  } catch {
    return [];
  }
};

export const prepareRuntimeMode = (
  context: RuntimeContext,
  hook: HookName,
  mode: RuntimeMode,
) => prepareMode(context, hook, mode);

export const executeProjectedHook = (
  context: RuntimeContext,
  host: Host,
  hook: HookName,
  mode: RuntimeMode,
  payload: unknown,
): RuntimeExecution => {
  const projection = entrypointFor(context, host, hook);
  if (projection.entrypoint === null) {
    return {
      host,
      hook,
      mode,
      entrypoint: null,
      route: projection.route,
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      logs: logsFor(context),
    };
  }

  const child = spawnSync(process.execPath, [projection.entrypoint], {
    cwd: context.repositoryRoot,
    env: baseChildEnvironment(context),
    input: payload === undefined ? "" : `${JSON.stringify(payload)}\n`,
    encoding: "utf8",
    timeout: runtimeTimeoutMs,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  const timedOut = child.error?.name === "Error" && /timed out|ETIMEDOUT/i.test(child.error.message);
  return {
    host,
    hook,
    mode,
    entrypoint: projection.entrypoint,
    route: projection.route,
    status: child.status,
    signal: child.signal,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? child.error?.message ?? "",
    timedOut,
    logs: logsFor(context),
  };
};

const parseSingleJsonLine = (execution: RuntimeExecution): unknown => {
  if (execution.entrypoint === null) throw new Error("Configured hook entrypoint is missing or cannot be resolved.");
  if (!existsSync(execution.entrypoint)) throw new Error("Configured hook entrypoint is missing or cannot be started.");
  if (execution.route !== `${execution.hook}.mjs`) {
    throw new Error(`Generated manifest routed ${execution.hook} to ${execution.route ?? "no file"}.`);
  }
  if (execution.timedOut) throw new Error("Hook process exceeded the bounded runtime timeout.");
  if (execution.status === null || execution.signal !== null) {
    throw new Error(`Hook process could not start or terminated abnormally: ${execution.stderr}`);
  }
  if (execution.status !== 0 && execution.stdout.trim().length === 0) {
    throw new Error(`Hook process could not start or terminated abnormally: ${execution.stderr}`);
  }
  const lines = execution.stdout.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length !== 1) {
    throw new Error(`Hook stdout must contain exactly one JSON line; received ${lines.length}.`);
  }
  try {
    return JSON.parse(lines[0]);
  } catch {
    throw new Error("Hook stdout is not valid JSON.");
  }
};

const expectRecordKeys = (value: unknown, keys: string[]) => {
  if (!isRecord(value)) throw new Error("Hook output is not a JSON object.");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Hook output keys differ: expected ${expected.join(",")}, received ${actual.join(",")}.`);
  }
  return value;
};

const expectNonEmptyString = (value: unknown, label: string) => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
};

export const assertPreResponse = (execution: RuntimeExecution, allow: boolean) => {
  const output = parseSingleJsonLine(execution);
  const expectedStatus = allow ? 0 : 2;
  if (execution.status !== expectedStatus) {
    throw new Error(
      `Expected pre-hook exit ${expectedStatus}, received ${execution.status}: ${execution.stderr}; stdout=${execution.stdout}; logs=${JSON.stringify(execution.logs)}`,
    );
  }
  if (execution.host === "cursor") {
    if (allow) {
      const value = expectRecordKeys(output, ["permission"]);
      if (value.permission !== "allow") throw new Error("Cursor allow response has the wrong permission.");
    } else {
      const value = expectRecordKeys(output, ["agent_message", "permission", "user_message"]);
      if (value.permission !== "deny") throw new Error("Cursor deny response has the wrong permission.");
      expectNonEmptyString(value.user_message, "Cursor user_message");
      expectNonEmptyString(value.agent_message, "Cursor agent_message");
    }
  } else {
    const value = expectRecordKeys(output, ["hookSpecificOutput"]);
    const specific = expectRecordKeys(
      value.hookSpecificOutput,
      allow ? ["hookEventName", "permissionDecision"] : ["hookEventName", "permissionDecision", "permissionDecisionReason"],
    );
    if (specific.hookEventName !== "PreToolUse") throw new Error("Codex pre-hook event name is wrong.");
    if (specific.permissionDecision !== (allow ? "allow" : "deny")) throw new Error("Codex pre-hook decision is wrong.");
    if (!allow) expectNonEmptyString(specific.permissionDecisionReason, "Codex permissionDecisionReason");
  }
  return output;
};

export const assertPostResponse = (execution: RuntimeExecution, relevant: boolean) => {
  if (execution.status !== 0) throw new Error(`Expected post-hook exit 0, received ${execution.status}.`);
  const output = parseSingleJsonLine(execution);
  if (!relevant) {
    if (JSON.stringify(output) !== "{}") throw new Error("Irrelevant post-hook output must be an empty object.");
    return output;
  }
  if (execution.host === "cursor") {
    const value = expectRecordKeys(output, ["additional_context"]);
    expectNonEmptyString(value.additional_context, "Cursor additional_context");
    return value;
  }
  const value = expectRecordKeys(output, ["hookSpecificOutput"]);
  const specific = expectRecordKeys(value.hookSpecificOutput, ["additionalContext", "hookEventName"]);
  if (specific.hookEventName !== "PostToolUse") throw new Error("Codex post-hook event name is wrong.");
  expectNonEmptyString(specific.additionalContext, "Codex additionalContext");
  return value;
};

export const assertRuntimeResponse = (execution: RuntimeExecution, allow: boolean, relevantPost = false) =>
  execution.hook === "post-merge"
    ? assertPostResponse(execution, relevantPost)
    : assertPreResponse(execution, allow);

export const assertNonDefaultBaseSemantics = (
  execution: RuntimeExecution,
  context: RuntimeContext,
) => {
  const output = execution.host === "cursor"
    ? assertPostResponse(execution, true)
    : assertPostResponse(execution, true);
  const additional = isRecord(output) && "additional_context" in output
    ? output.additional_context
    : isRecord(output) && isRecord(output.hookSpecificOutput)
      ? output.hookSpecificOutput.additionalContext
      : null;
  if (typeof additional !== "string" || additional.length === 0) {
    throw new Error("serialized PostMergeStatus must be a non-empty string.");
  }
  const status = load(additional) as JsonRecord;
  const merge = isRecord(status.merge) ? status.merge : null;
  const issueClosure = isRecord(status.issue_closure) ? status.issue_closure : null;
  if (!merge || merge.target_branch !== context.baseBranch || merge.target_contains_merge_commit !== "verified") {
    throw new Error(`PostMergeStatus did not preserve the live non-default base and verified containment: ${JSON.stringify(status)}`);
  }
  if (issueClosure?.expected !== false) {
    throw new Error("PostMergeStatus incorrectly treated the non-default base as issue-closure eligible.");
  }
  const compare = execution.logs.find(
    (entry) => entry.executable === "gh" && entry.args[0] === "api" && entry.args[1]?.includes("/compare/"),
  );
  if (!compare) throw new Error("The merge-containment compare request was not recorded.");
  const expectedRoute = `repos/${context.repository}/compare/${encodeURIComponent(context.mergeCommitSha)}...${encodeURIComponent(context.baseBranch)}`;
  if (compare.args[1] !== expectedRoute || compare.args[1].includes("...master")) {
    throw new Error(`Merge containment did not use the live base branch: ${compare.args[1]}`);
  }
  const defaultBranch = execution.logs.find(
    (entry) => entry.executable === "gh" && entry.args[0] === "repo" && entry.args[1] === "view",
  );
  if (!defaultBranch) throw new Error("The repository default-branch read was not recorded.");
};

export const readHookOutput = (execution: RuntimeExecution) => parseSingleJsonLine(execution);

export const generatedEntrypoint = (context: RuntimeContext, host: Host, hook: HookName) => entrypointFor(context, host, hook);

export const overwriteGeneratedEntrypoint = (context: RuntimeContext, host: Host, hook: HookName, source: string) => {
  const projection = entrypointFor(context, host, hook);
  if (!projection.entrypoint) throw new Error("Cannot mutate a missing generated entrypoint.");
  writeFileSync(projection.entrypoint, source, "utf8");
};

export const deleteGeneratedEntrypoint = (context: RuntimeContext, host: Host, hook: HookName) => {
  const projection = entrypointFor(context, host, hook);
  if (!projection.entrypoint) throw new Error("Cannot delete a missing generated entrypoint.");
  unlinkSync(projection.entrypoint);
};

export const redirectGeneratedRoute = (context: RuntimeContext, host: Host, hook: HookName, targetHook: HookName) => {
  const path = generatedConfigPath(context, host);
  const config = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
  const replace = (value: unknown): unknown => {
    if (typeof value === "string" && value.toLowerCase().includes(`${hook}.mjs`)) {
      return value.replace(new RegExp(`${hook}\\.mjs`, "gi"), `${targetHook}.mjs`);
    }
    if (Array.isArray(value)) return value.map(replace);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
    return value;
  };
  writeFileSync(path, `${JSON.stringify(replace(config), null, 2)}\n`, "utf8");
};

export const writeActiveGitMarker = (context: RuntimeContext, marker = "MERGE_HEAD") => {
  const markerPath = join(context.repositoryRoot, ".git", marker);
  writeFileSync(markerPath, "runtime marker\n", "utf8");
};

export const fakeCommandLogs = (context: RuntimeContext) => readFakeLog(context);

export const assertNoUnexpectedFakeCommands = (context: RuntimeContext) => {
  const unexpected = readFakeLog(context).filter((entry) => !entry.matched);
  if (unexpected.length > 0) {
    throw new Error(`Unexpected fake command invocation: ${JSON.stringify(unexpected[0])}`);
  }
};

export const gateFileExists = (context: RuntimeContext, hook: HookName) => existsSync(gatePath(context, hook));

export const allHookNames = HOOK_NAMES;
