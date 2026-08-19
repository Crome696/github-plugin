import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";

import { readHookInput } from "./lib/read-hook-input.mjs";

const GATE_RELATIVE_PATH = ".cursor/hooks/state/pre-pr-ready.json";
const MAX_GATE_BYTES = 2 * 1024 * 1024;
const ALLOWED_AUTHORIZATION_SOURCES = new Set([
  "explicit_user",
  "repository_policy",
]);
const SAFE_BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SAFE_LOGIN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_TEAM = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

class CommandError extends Error {
  constructor(operation) {
    super(`Command failed: ${operation}`);
    this.name = "CommandError";
    this.operation = operation;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40,64}$/i.test(value);
}

function isIsoTimestamp(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isHttpUrl(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function validateRepositoryName(value) {
  return isNonEmptyString(value) && /^[^/\s]+\/[^/\s]+$/.test(value);
}

function isSafeBranchName(value) {
  return (
    isNonEmptyString(value) &&
    SAFE_BRANCH_NAME.test(value) &&
    !value.includes("..") &&
    !value.includes("//") &&
    !value.includes("@{") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.endsWith(".lock")
  );
}

function normalizeRepository(value) {
  return isNonEmptyString(value) ? value.toLowerCase() : null;
}

function normalizeAbsolutePath(value) {
  return normalize(resolve(value)).toLowerCase();
}

function safeLabel(value) {
  return String(value).replace(/[^\w./:@-]+/g, " ").trim().slice(0, 120);
}

function addFinding(findings, requirement, nextStep) {
  const key = `${requirement}|${nextStep}`;
  if (findings.some((finding) => finding.key === key)) {
    return;
  }
  findings.push({ key, requirement, nextStep });
}

function makeDeny(findings) {
  const visibleFindings = findings.map(
    (finding) => `- ${finding.requirement} Next step: ${finding.nextStep}.`,
  );
  return {
    decision: "deny",
    message:
      "GitHub Ready-for-Review blocked by deterministic pre-pr-ready checks. " +
      "Missing or changed prerequisites:\n" +
      visibleFindings.join("\n") +
      "\nThe hook performed no Git, file, or GitHub write.",
  };
}

function makeAllow() {
  return { decision: "allow" };
}

function runCommand(executable, args, workingDirectory, operation) {
  try {
    return execFileSync(executable, args, {
      cwd: workingDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch {
    throw new CommandError(operation);
  }
}

function runGit(workingDirectory, args) {
  return runCommand("git", args, workingDirectory, args[0] ?? "git");
}

function runGh(workingDirectory, args) {
  return runCommand("gh", args, workingDirectory, args[0] ?? "gh");
}

function tokenizeCommand(command) {
  const tokens = [];
  let current = "";
  let tokenStarted = false;
  let quote = null;
  let escaped = false;

  const pushCurrent = () => {
    if (tokenStarted || current.length > 0) {
      tokens.push(current);
      current = "";
      tokenStarted = false;
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    const next = command[index + 1];

    if (quote === "'") {
      tokenStarted = true;
      if (character === "'") {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (quote === '"') {
      tokenStarted = true;
      if (escaped) {
        current += character;
        escaped = false;
      } else if (character === "\\" && (next === '"' || next === "\\")) {
        escaped = true;
      } else if (character === '"') {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (escaped) {
      tokenStarted = true;
      current += character;
      escaped = false;
      continue;
    }

    if (character === "'" || character === '"') {
      tokenStarted = true;
      quote = character;
      continue;
    }

    if (character === "\\" && (next === '"' || next === "'" || next === "\\")) {
      tokenStarted = true;
      escaped = true;
      continue;
    }

    if (/\s/.test(character)) {
      pushCurrent();
      continue;
    }

    if (character === "&" && next === "&") {
      pushCurrent();
      tokens.push("&&");
      index += 1;
      continue;
    }

    if (character === "|" && next === "|") {
      pushCurrent();
      tokens.push("||");
      index += 1;
      continue;
    }

    if ([";", "|", "&", "(", ")"].includes(character)) {
      pushCurrent();
      tokens.push(character);
      continue;
    }

    tokenStarted = true;
    current += character;
  }

  if (quote !== null || escaped) {
    return null;
  }

  pushCurrent();
  return tokens;
}

function splitCommandSegments(tokens) {
  const segments = [];
  let segment = [];
  const separators = new Set([";", "&&", "||", "|", "&", "(", ")"]);

  for (const token of tokens) {
    if (separators.has(token)) {
      if (segment.length > 0) {
        segments.push(segment);
      }
      segment = [];
      continue;
    }
    segment.push(token);
  }
  if (segment.length > 0) {
    segments.push(segment);
  }
  return segments;
}

function unwrapCommandWrappers(segment) {
  let index = 0;
  const wrappers = new Set(["sudo", "env", "command", "exec", "nohup"]);
  while (index < segment.length) {
    const name = segment[index]
      ?.replaceAll("\\", "/")
      .split("/")
      .at(-1)
      ?.toLowerCase();
    if (!wrappers.has(name)) {
      break;
    }
    index += 1;
  }
  return index;
}

function executableName(value) {
  return value?.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase();
}

function isGhCommand(segment, firstIndex) {
  return ["gh", "gh.exe", "gh.cmd", "gh.bat"].includes(
    executableName(segment[firstIndex]),
  );
}

function splitOption(token) {
  const separatorIndex = token.indexOf("=");
  if (separatorIndex < 0) {
    return { name: token.toLowerCase(), inlineValue: null };
  }
  return {
    name: token.slice(0, separatorIndex).toLowerCase(),
    inlineValue: token.slice(separatorIndex + 1),
  };
}

function parsePullRequestTarget(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  if (/^[1-9]\d*$/.test(value)) {
    return { number: Number(value), repository: null, url: null };
  }
  try {
    const url = new URL(value);
    const match = url.pathname.match(
      /^\/([^/\s]+)\/([^/\s]+)\/pull\/([1-9]\d*)\/?$/i,
    );
    if (match === null) {
      return null;
    }
    return {
      number: Number(match[3]),
      repository: `${match[1]}/${match[2]}`,
      url: value,
    };
  } catch {
    return null;
  }
}

function parseReviewersEndpoint(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  let candidate = value;
  try {
    if (/^https?:\/\//i.test(value)) {
      candidate = new URL(value).pathname;
    }
  } catch {
    return null;
  }
  candidate = candidate.replace(/^\/+/, "").replace(/\/+$/, "");
  const match = candidate.match(
    /^repos\/([^/\s]+)\/([^/\s]+)\/pulls\/([1-9]\d*)\/requested_reviewers$/i,
  );
  if (match === null) {
    return null;
  }
  return {
    repository: `${match[1]}/${match[2]}`,
    number: Number(match[3]),
  };
}

function findReviewersEndpoint(args) {
  for (const token of args) {
    const endpoint = parseReviewersEndpoint(token);
    if (endpoint !== null) {
      return endpoint;
    }
  }
  return null;
}

function identifyApiMethod(args) {
  let method = null;
  for (let index = 0; index < args.length; index += 1) {
    const option = splitOption(args[index]);
    if (option.name !== "--method" && option.name !== "-x" && option.name !== "-X") {
      continue;
    }
    method = option.inlineValue ?? args[index + 1] ?? null;
    if (option.inlineValue === null) {
      index += 1;
    }
  }
  return isNonEmptyString(method) ? method.toUpperCase() : null;
}

function likelyReadyCommand(command) {
  return /\bgh(?:\.exe|\.cmd|\.bat)?\b[\s\S]*\bpr\s+ready\b/i.test(command)
    || /\/pulls\/[1-9]\d*\/requested_reviewers\b/i.test(command);
}

function identifyReadyInvocations(command, initialDirectory) {
  if (!isNonEmptyString(initialDirectory)) {
    return {
      invocations: [],
      parseable: false,
      reason: "The hook did not receive the shell working directory.",
    };
  }

  const tokens = tokenizeCommand(command);
  if (tokens === null) {
    return {
      invocations: [],
      parseable: false,
      reason: "The shell command could not be parsed safely.",
    };
  }

  const invocations = [];
  for (const segment of splitCommandSegments(tokens)) {
    if (segment.length === 0) {
      continue;
    }
    const firstIndex = unwrapCommandWrappers(segment);
    if (!isGhCommand(segment, firstIndex)) {
      continue;
    }
    const commandName = segment[firstIndex + 1]?.toLowerCase();
    const subcommand = segment[firstIndex + 2]?.toLowerCase();
    if (commandName === "pr" && subcommand === "ready") {
      invocations.push({
        kind: "pr-ready",
        targetDirectory: resolve(initialDirectory),
        args: segment.slice(firstIndex + 3),
      });
      continue;
    }
    if (commandName === "api") {
      const args = segment.slice(firstIndex + 2);
      const endpoint = findReviewersEndpoint(args);
      const method = identifyApiMethod(args);
      const isWrite = method !== null && !["GET", "HEAD"].includes(method);
      if (endpoint !== null && isWrite) {
        invocations.push({
          kind: "api-reviewers",
          targetDirectory: resolve(initialDirectory),
          args,
          endpoint,
          method,
        });
      }
    }
  }

  return { invocations, parseable: true, reason: null };
}

function parseReadyArgs(args, findings) {
  let repository = null;
  let number = null;
  const blockedFlags = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const option = splitOption(token);
    if (option.name === "--repo" || option.name === "-R") {
      const value = option.inlineValue ?? args[index + 1];
      if (option.inlineValue === null) {
        index += 1;
      }
      repository = value;
      continue;
    }
    if (token.startsWith("-")) {
      blockedFlags.push(token);
      continue;
    }
    const target = parsePullRequestTarget(token);
    if (target !== null) {
      number = target.number;
      if (target.repository) {
        repository = target.repository;
      }
    }
  }
  if (blockedFlags.length > 0) {
    addFinding(
      findings,
      `The Ready-for-Review command includes unsupported flags ${blockedFlags.join(", ")}.`,
      "run only gh pr ready with --repo and the pull-request number",
    );
  }
  return { repository, number };
}

function readGate(repositoryRoot, findings) {
  const gatePath = resolve(repositoryRoot, ...GATE_RELATIVE_PATH.split("/"));
  if (!existsSync(gatePath)) {
    addFinding(
      findings,
      `The local PrePrReadyGate is missing at ${GATE_RELATIVE_PATH}.`,
      "run mark-pr-ready preflight and write a fresh PrePrReadyGate",
    );
    return null;
  }
  try {
    const stats = statSync(gatePath);
    if (!stats.isFile() || stats.size > MAX_GATE_BYTES) {
      throw new Error("invalid gate");
    }
    return JSON.parse(readFileSync(gatePath, "utf8"));
  } catch {
    addFinding(
      findings,
      `The local PrePrReadyGate is missing, too large, unreadable, or invalid at ${GATE_RELATIVE_PATH}.`,
      "run mark-pr-ready preflight and write a fresh PrePrReadyGate",
    );
    return null;
  }
}

function reviewerKey(reviewer) {
  return `${String(reviewer.kind).toLowerCase()}:${String(reviewer.login).toLowerCase()}`;
}

function validateReviewers(reviewers, findings) {
  if (!isRecord(reviewers) || !Array.isArray(reviewers.add)) {
    addFinding(
      findings,
      "PrePrReadyGate.reviewers.add is missing or malformed.",
      "preserve the exact authorized reviewer set, which may be empty",
    );
    return [];
  }
  const add = [];
  for (const entry of reviewers.add) {
    if (
      !isRecord(entry) ||
      (entry.kind !== "user" && entry.kind !== "team") ||
      !isNonEmptyString(entry.login)
    ) {
      addFinding(
        findings,
        "PrePrReadyGate.reviewers.add contains a malformed reviewer.",
        "use only confirmed user or team logins",
      );
      continue;
    }
    const pattern = entry.kind === "team" ? SAFE_TEAM : SAFE_LOGIN;
    if (!pattern.test(entry.login)) {
      addFinding(
        findings,
        `PrePrReadyGate reviewer login ${safeLabel(entry.login)} is not a safe identity.`,
        "request only exact confirmed GitHub user or team logins",
      );
      continue;
    }
    add.push({ kind: entry.kind, login: entry.login });
  }
  return add;
}

function validateGate(gate, repositoryRoot, findings) {
  if (!isRecord(gate)) {
    addFinding(
      findings,
      "PrePrReadyGate is not a JSON object.",
      "write a complete version-1 PrePrReadyGate snapshot",
    );
    return null;
  }
  if (gate.schema !== undefined && gate.schema !== "PrePrReadyGate") {
    addFinding(
      findings,
      "The local snapshot is not a PrePrReadyGate.",
      "write the Ready-for-Review gate, not a different host gate",
    );
  }
  if (gate.version !== undefined && gate.version !== 1) {
    addFinding(
      findings,
      "PrePrReadyGate.version is not 1.",
      "write a current version-1 PrePrReadyGate",
    );
  }
  if (!isIsoTimestamp(gate.written_at)) {
    addFinding(
      findings,
      "PrePrReadyGate.written_at is missing or not an ISO-8601 timestamp.",
      "write a fresh gate immediately before gh pr ready",
    );
  }
  const workspace = gate.workspace;
  if (
    !isRecord(workspace) ||
    !validateRepositoryName(workspace.repository) ||
    !isNonEmptyString(workspace.path) ||
    !isAbsolute(workspace.path)
  ) {
    addFinding(
      findings,
      "PrePrReadyGate.workspace is missing or malformed.",
      "preserve the verified repository and absolute worktree path",
    );
  } else if (
    normalizeAbsolutePath(workspace.path) !== normalizeAbsolutePath(repositoryRoot)
  ) {
    addFinding(
      findings,
      "PrePrReadyGate.workspace.path does not match the live Git worktree.",
      "write a gate for the exact worktree that runs gh pr ready",
    );
  }
  const pullRequest = gate.pull_request;
  if (
    !isRecord(pullRequest) ||
    !validateRepositoryName(pullRequest.repository) ||
    !Number.isInteger(pullRequest.number) ||
    pullRequest.number < 1 ||
    !isHttpUrl(pullRequest.url) ||
    !isSafeBranchName(pullRequest.base_branch) ||
    !isSafeBranchName(pullRequest.head_branch)
  ) {
    addFinding(
      findings,
      "PrePrReadyGate.pull_request is missing or malformed.",
      "preserve one exact repository, pull request, base branch, and head branch",
    );
    return null;
  }
  if (!isSha(gate.expected_head_sha)) {
    addFinding(
      findings,
      "PrePrReadyGate.expected_head_sha is missing or not a full Git SHA.",
      "bind the current pull-request head SHA",
    );
  }
  if (gate.is_draft !== true) {
    addFinding(
      findings,
      "PrePrReadyGate.is_draft must be true for a Ready-for-Review write.",
      "mark ready only from an authorized current Draft snapshot",
    );
  }
  const linkedIssue = gate.linked_issue;
  if (
    !isRecord(linkedIssue) ||
    !validateRepositoryName(linkedIssue.repository) ||
    !Number.isInteger(linkedIssue.number) ||
    linkedIssue.number < 1 ||
    !isHttpUrl(linkedIssue.url) ||
    linkedIssue.unique !== true
  ) {
    addFinding(
      findings,
      "PrePrReadyGate.linked_issue is missing, malformed, or not unique.",
      "bind exactly one unique linked issue before marking the pull request ready",
    );
  }
  const authorization = gate.authorization;
  if (
    !isRecord(authorization) ||
    authorization.exact_target !== true ||
    authorization.exact_ready_operation !== true ||
    authorization.ready_authorized !== true ||
    authorization.reviewers_authorized !== true ||
    !ALLOWED_AUTHORIZATION_SOURCES.has(authorization.source) ||
    !isNonEmptyString(authorization.evidence)
  ) {
    addFinding(
      findings,
      "PrePrReadyGate.authorization is missing, incomplete, or not independently authorized.",
      "record exact Ready-for-Review authorization for this pull request, head SHA, and reviewer set",
    );
  }
  const reviewers = validateReviewers(gate.reviewers, findings);
  if (findings.length > 0) {
    return null;
  }
  return {
    repository: pullRequest.repository,
    pullRequest,
    expectedHeadSha: gate.expected_head_sha,
    reviewers,
    workspace,
  };
}

function compareCommandToGate(spec, context, findings) {
  if (normalizeRepository(spec.repository) !== normalizeRepository(context.repository)) {
    addFinding(
      findings,
      "The command repository differs from PrePrReadyGate.",
      "run gh pr ready against the exact authorized repository",
    );
  }
  if (spec.number !== context.pullRequest.number) {
    addFinding(
      findings,
      "The command pull-request number differs from PrePrReadyGate.",
      "run the write against the exact authorized pull request",
    );
  }
  if (spec.kind === "api-reviewers" && context.reviewers.length === 0) {
    addFinding(
      findings,
      "A reviewer-request API write is not authorized because reviewers.add is empty.",
      "mark the pull request ready without requesting reviewers",
    );
  }
  if (spec.kind === "pr-ready" && spec.blocked) {
    addFinding(
      findings,
      "The Ready-for-Review command is not a bounded gh pr ready invocation.",
      "omit edit, reviewer, label, and assignee flags",
    );
  }
}

function readLivePullRequest(workingDirectory, repository, number, findings) {
  try {
    const output = runGh(workingDirectory, [
      "pr",
      "view",
      String(number),
      "--repo",
      repository,
      "--json",
      "number,url,isDraft,state,baseRefName,headRefName,headRefOid",
    ]);
    return JSON.parse(output);
  } catch {
    addFinding(
      findings,
      "The live pull request could not be read for Ready-for-Review verification.",
      "reload the exact pull request and rewrite PrePrReadyGate",
    );
    return null;
  }
}

function validateLivePullRequest(spec, context, livePullRequest, findings) {
  if (!isRecord(livePullRequest)) {
    return;
  }
  if (livePullRequest.number !== context.pullRequest.number) {
    addFinding(
      findings,
      "The live pull-request identity differs from PrePrReadyGate.",
      "reload the exact authorized pull request",
    );
  }
  if (String(livePullRequest.state ?? "").toLowerCase() !== "open") {
    addFinding(
      findings,
      "The target pull request is no longer open.",
      "mark ready only the exact open Draft pull request",
    );
  }
  if (
    isSha(livePullRequest.headRefOid) &&
    livePullRequest.headRefOid.toLowerCase() !== context.expectedHeadSha.toLowerCase()
  ) {
    addFinding(
      findings,
      "The live head SHA differs from PrePrReadyGate.expected_head_sha.",
      "refresh the authorized head SHA before marking the pull request ready",
    );
  }
  if (spec.kind === "pr-ready" && livePullRequest.isDraft !== true) {
    addFinding(
      findings,
      "The target pull request is not a Draft, so gh pr ready is not permitted.",
      "return already_ready without writing, or refresh the exact Draft target",
    );
  }
  if (spec.kind === "api-reviewers" && livePullRequest.isDraft !== false) {
    addFinding(
      findings,
      "Reviewer requests are permitted only after the pull request is non-Draft.",
      "run gh pr ready first, then request only the authorized reviewer set",
    );
  }
}

function evaluate(input) {
  if (!isRecord(input)) {
    return makeDeny([
      {
        key: "input",
        requirement: "Hook input is not a JSON object.",
        nextStep: "verify the host hook configuration",
      },
    ]);
  }

  const command =
    typeof input.command === "string"
      ? input.command
      : isRecord(input.tool_input) && typeof input.tool_input.command === "string"
        ? input.tool_input.command
        : null;
  if (command === null) {
    return makeDeny([
      {
        key: "command",
        requirement: "Hook input does not contain a shell command.",
        nextStep: "verify the host hook configuration",
      },
    ]);
  }

  const inputDirectory =
    typeof input.cwd === "string" && input.cwd.trim().length > 0
      ? input.cwd
      : isRecord(input.tool_input) &&
          typeof input.tool_input.cwd === "string" &&
          input.tool_input.cwd.trim().length > 0
        ? input.tool_input.cwd
        : null;
  const initialDirectory =
    inputDirectory === null ? null : resolve(inputDirectory);
  const parserDirectory = initialDirectory ?? process.cwd();
  const identified = identifyReadyInvocations(command, parserDirectory);

  if (identified.invocations.length === 0) {
    if (!identified.parseable && likelyReadyCommand(command)) {
      return makeDeny([
        {
          key: "parse",
          requirement:
            identified.reason ??
            "The command appears to contain a Ready-for-Review write that cannot be identified safely.",
          nextStep: "run one direct, explicit, parseable gh pr ready command",
        },
      ]);
    }
    return makeAllow();
  }

  const findings = [];
  if (identified.invocations.length > 1) {
    addFinding(
      findings,
      "The shell command contains more than one Ready-for-Review or reviewer-request invocation.",
      "run exactly one authorized gh pr ready or requested_reviewers command",
    );
  }
  if (initialDirectory === null) {
    addFinding(
      findings,
      "The hook did not receive the Ready-for-Review working directory.",
      "run the command from the verified worktree",
    );
  }

  const invocation = identified.invocations[0];
  let spec;
  if (invocation.kind === "pr-ready") {
    const parsed = parseReadyArgs(invocation.args, findings);
    spec = {
      kind: "pr-ready",
      repository: parsed.repository,
      number: parsed.number,
      blocked: findings.length > 0,
    };
  } else {
    spec = {
      kind: "api-reviewers",
      repository: invocation.endpoint.repository,
      number: invocation.endpoint.number,
      blocked: false,
    };
  }
  if (!validateRepositoryName(spec.repository) || !Number.isInteger(spec.number)) {
    addFinding(
      findings,
      "The Ready-for-Review command target identity is missing or malformed.",
      "use one exact owner/repository and positive pull-request number",
    );
    return makeDeny(findings);
  }

  let repositoryRoot;
  try {
    repositoryRoot = runGit(invocation.targetDirectory, ["rev-parse", "--show-toplevel"]);
  } catch {
    addFinding(
      findings,
      "The Ready-for-Review worktree is not a verifiable Git repository.",
      "run the command from the registered repository worktree",
    );
    return makeDeny(findings);
  }

  const gate = readGate(repositoryRoot, findings);
  if (gate === null) {
    return makeDeny(findings);
  }
  const context = validateGate(gate, repositoryRoot, findings);
  if (context === null) {
    return makeDeny(findings);
  }
  compareCommandToGate(spec, context, findings);
  if (findings.length > 0) {
    return makeDeny(findings);
  }

  const livePullRequest = readLivePullRequest(
    invocation.targetDirectory,
    context.repository,
    context.pullRequest.number,
    findings,
  );
  if (livePullRequest === null) {
    return makeDeny(findings);
  }
  validateLivePullRequest(spec, context, livePullRequest, findings);
  return findings.length > 0 ? makeDeny(findings) : makeAllow();
}

function writeResponse(input, result) {
  const isCodex =
    input?.hook_event_name === "PreToolUse" ||
    typeof input?.tool_name === "string" ||
    isRecord(input?.tool_input);

  if (isCodex) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: result.decision === "deny" ? "deny" : "allow",
          ...(result.decision === "deny"
            ? { permissionDecisionReason: result.message }
            : {}),
        },
      }) + "\n",
    );
    return;
  }

  if (result.decision === "deny") {
    process.stdout.write(
      JSON.stringify({
        permission: "deny",
        user_message: result.message,
        agent_message: result.message,
      }) + "\n",
    );
    return;
  }

  process.stdout.write(JSON.stringify({ permission: "allow" }) + "\n");
}

function main() {
  let input;
  try {
    input = readHookInput();
  } catch {
    const result = makeDeny([
      {
        key: "json",
        requirement: "Hook input is missing or invalid JSON.",
        nextStep: "verify the host hook configuration",
      },
    ]);
    writeResponse({}, result);
    process.exitCode = 2;
    return;
  }

  let result;
  try {
    result = evaluate(input);
  } catch (error) {
    const errorType =
      error instanceof Error ? safeLabel(error.name) : "unknown-error";
    result = makeDeny([
      {
        key: "unexpected",
        requirement: `The deterministic pre-pr-ready check failed closed with ${errorType}.`,
        nextStep: "verify the current Ready-for-Review gate and read-only GitHub evidence",
      },
    ]);
  }

  writeResponse(input, result);
  if (result.decision === "deny") {
    process.exitCode = 2;
  }
}

main();
