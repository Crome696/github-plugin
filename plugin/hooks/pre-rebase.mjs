import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";

import { readHookInput } from "./lib/read-hook-input.mjs";

const GATE_RELATIVE_PATH = ".cursor/hooks/state/pre-rebase.json";
const MAX_GATE_BYTES = 2 * 1024 * 1024;
const ALLOWED_AUTHORIZATION_SOURCES = new Set([
  "explicit_user",
  "repository_policy",
]);
const SAFE_REMOTE_NAME = /^[A-Za-z0-9._-]+$/;
const SAFE_BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const ACTIVE_OPERATION_MARKERS = [
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["sequencer", "sequencer"],
  ["BISECT_LOG", "bisect"],
];

class GitCommandError extends Error {
  constructor(operation) {
    super(`Git operation failed: ${operation}`);
    this.name = "GitCommandError";
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
  return String(value).replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 120);
}

function addFinding(findings, requirement, nextStep) {
  const key = `${requirement}\u0000${nextStep}`;
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
      "Local rebase blocked by deterministic pre-rebase checks. " +
      "Missing or invalid prerequisites:\n" +
      visibleFindings.join("\n") +
      "\nThe hook performed no Git, file, or GitHub write.",
  };
}

function makeAllow() {
  return { decision: "allow" };
}

function runGit(worktreePath, args) {
  try {
    return execFileSync("git", ["-C", worktreePath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  } catch {
    throw new GitCommandError(args[0] ?? "unknown");
  }
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
        segment = [];
      }
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
  const wrappers = new Set([
    "command",
    "env",
    "exec",
    "nice",
    "nohup",
    "setsid",
    "sudo",
  ]);
  let index = 0;

  while (index < segment.length) {
    const token = segment[index].toLowerCase();
    if (token === "env") {
      index += 1;
      while (
        index < segment.length &&
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[index])
      ) {
        index += 1;
      }
      continue;
    }

    if (wrappers.has(token)) {
      index += 1;
      continue;
    }

    break;
  }

  return index;
}

function resolveCommandDirectory(currentDirectory, value) {
  if (!isNonEmptyString(value) || value.includes("\0")) {
    return null;
  }
  if (value === "~" || value.startsWith("~")) {
    return null;
  }
  return resolve(currentDirectory, value);
}

function findUnsafeEnvironmentAssignment(segment, firstIndex) {
  for (let index = 0; index < firstIndex; index += 1) {
    const match = segment[index].match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match && /^GIT_/i.test(match[1])) {
      return match[1];
    }
  }
  return null;
}

function parseGitSegment(segment, currentDirectory) {
  const firstIndex = unwrapCommandWrappers(segment);
  const first = segment[firstIndex]?.toLowerCase();
  const firstExecutable = first?.replaceAll("\\", "/").split("/").at(-1);

  if (!["git", "git.exe", "git.cmd", "git.bat"].includes(firstExecutable)) {
    return null;
  }

  let index = firstIndex + 1;
  let targetDirectory = currentDirectory;
  const unsafeEnvironment = findUnsafeEnvironmentAssignment(segment, firstIndex);
  let unsupportedTarget = null;
  let unsupportedGlobalOption = null;
  let parseError = null;

  while (index < segment.length) {
    const token = segment[index];
    if (token === "-C") {
      const directoryArgument = segment[index + 1];
      const resolvedDirectory = resolveCommandDirectory(
        currentDirectory,
        directoryArgument,
      );
      if (resolvedDirectory === null) {
        parseError = "The Git -C target directory is missing or invalid.";
        break;
      }
      targetDirectory = resolvedDirectory;
      index += 2;
      continue;
    }

    if (token.startsWith("-C") && token.length > 2) {
      const resolvedDirectory = resolveCommandDirectory(
        currentDirectory,
        token.slice(2),
      );
      if (resolvedDirectory === null) {
        parseError = "The Git -C target directory is invalid.";
        break;
      }
      targetDirectory = resolvedDirectory;
      index += 1;
      continue;
    }

    if (
      token === "--git-dir" ||
      token.startsWith("--git-dir=") ||
      token === "--work-tree" ||
      token.startsWith("--work-tree=")
    ) {
      unsupportedTarget = token;
      index += 1;
      if (
        (token === "--git-dir" || token === "--work-tree") &&
        index < segment.length
      ) {
        index += 1;
      }
      continue;
    }

    if (token === "--") {
      unsupportedGlobalOption = token;
      index += 1;
      break;
    }

    if (token.startsWith("-")) {
      unsupportedGlobalOption ??= token;
      index += 1;
      if (
        ["-c", "--config-env", "--exec-path", "--upload-pack"].includes(token) &&
        index < segment.length
      ) {
        index += 1;
      }
      continue;
    }

    break;
  }

  const subcommand = segment[index]?.toLowerCase();
  if (subcommand !== "rebase") {
    return null;
  }

  return {
    targetDirectory,
    args: segment.slice(index + 1),
    unsafeEnvironment,
    unsupportedTarget,
    unsupportedGlobalOption,
    parseError,
  };
}

function identifyRebaseInvocations(command, initialDirectory) {
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

  let currentDirectory = resolve(initialDirectory);
  let parseError = null;
  const invocations = [];

  for (const segment of splitCommandSegments(tokens)) {
    if (segment.length === 0) {
      continue;
    }

    const firstIndex = unwrapCommandWrappers(segment);
    const first = segment[firstIndex]?.toLowerCase();

    if (first === "cd" || first === "pushd" || first === "set-location") {
      const directoryIndex =
        segment[firstIndex + 1]?.toLowerCase() === "/d"
          ? firstIndex + 2
          : firstIndex + 1;
      const resolvedDirectory = resolveCommandDirectory(
        currentDirectory,
        segment[directoryIndex],
      );
      if (resolvedDirectory === null) {
        parseError = "The rebase target directory could not be resolved safely.";
      } else {
        currentDirectory = resolvedDirectory;
      }
      continue;
    }

    const invocation = parseGitSegment(segment, currentDirectory);
    if (invocation === null) {
      continue;
    }

    invocations.push({
      ...invocation,
      parseError: invocation.parseError ?? parseError,
    });
    parseError = null;
  }

  return { invocations, parseable: true, reason: null };
}

function likelyRebaseCommand(command) {
  return /\bgit(?:\.exe|\.cmd|\.bat)?\b[\s\S]*\brebase(?:\s|$)/i.test(
    command,
  );
}

function readGate(repositoryRoot, findings) {
  const gatePath = resolve(repositoryRoot, ...GATE_RELATIVE_PATH.split("/"));
  try {
    const stats = statSync(gatePath);
    if (!stats.isFile() || stats.size > MAX_GATE_BYTES) {
      throw new Error("invalid gate file");
    }
    return JSON.parse(readFileSync(gatePath, "utf8"));
  } catch {
    addFinding(
      findings,
      `The local PreRebaseGate is missing, too large, unreadable, or invalid at ${GATE_RELATIVE_PATH}.`,
      "run rebase-branch preflight and write a fresh PreRebaseGate",
    );
    return null;
  }
}

function validateWorkspace(workspace, findings) {
  if (!isRecord(workspace)) {
    addFinding(
      findings,
      "PreRebaseGate.workspace is missing.",
      "verify the exact implementation worktree before rebasing",
    );
    return;
  }

  if (!validateRepositoryName(workspace.repository)) {
    addFinding(
      findings,
      "PreRebaseGate.workspace.repository is missing or malformed.",
      "use the verified owner/repository identity",
    );
  }
  if (!isNonEmptyString(workspace.path) || !isAbsolute(workspace.path)) {
    addFinding(
      findings,
      "PreRebaseGate.workspace.path is missing or not absolute.",
      "use the verified absolute implementation worktree path",
    );
  }
  if (!isSafeBranchName(workspace.branch)) {
    addFinding(
      findings,
      "PreRebaseGate.workspace.branch is missing or unsafe.",
      "use the verified feature branch name",
    );
  }
  if (!isSha(workspace.head_sha)) {
    addFinding(
      findings,
      "PreRebaseGate.workspace.head_sha is missing or malformed.",
      "capture the full pre-rebase HEAD SHA again",
    );
  }
}

function validatePullRequest(pullRequest, findings) {
  if (!isRecord(pullRequest)) {
    addFinding(
      findings,
      "PreRebaseGate.pull_request is missing.",
      "load one verified pull request and write a fresh PreRebaseGate",
    );
    return;
  }

  if (!validateRepositoryName(pullRequest.repository)) {
    addFinding(
      findings,
      "PreRebaseGate.pull_request.repository is missing or malformed.",
      "use the verified pull-request repository",
    );
  }
  if (!Number.isInteger(pullRequest.number) || pullRequest.number < 1) {
    addFinding(
      findings,
      "PreRebaseGate.pull_request.number is missing or invalid.",
      "bind the gate to one verified positive pull-request number",
    );
  }
  if (!isHttpUrl(pullRequest.url)) {
    addFinding(
      findings,
      "PreRebaseGate.pull_request.url is missing or unsafe.",
      "preserve the verified pull-request URL without credentials",
    );
  } else {
    try {
      const url = new URL(pullRequest.url);
      const segments = url.pathname.split("/").filter(Boolean);
      const pullIndex = segments.lastIndexOf("pull");
      const numberSegment = pullIndex >= 0 ? segments[pullIndex + 1] : null;
      const urlNumber =
        isNonEmptyString(numberSegment) && /^\d+$/.test(numberSegment)
          ? Number(numberSegment)
          : NaN;
      const urlRepository =
        pullIndex >= 2
          ? `${segments[pullIndex - 2]}/${segments[pullIndex - 1]}`
          : null;
      if (
        !validateRepositoryName(urlRepository) ||
        normalizeRepository(urlRepository) !==
          normalizeRepository(pullRequest.repository) ||
        urlNumber !== pullRequest.number
      ) {
        addFinding(
          findings,
          "PreRebaseGate.pull_request.url does not identify the recorded repository and pull request.",
          "refresh the gate from the exact verified pull-request URL",
        );
      }
    } catch {
      addFinding(
        findings,
        "PreRebaseGate.pull_request.url could not be parsed for identity verification.",
        "preserve the exact verified pull-request URL",
      );
    }
  }
  if (!isSafeBranchName(pullRequest.base_branch)) {
    addFinding(
      findings,
      "PreRebaseGate.pull_request.base_branch is missing or unsafe.",
      "select exactly one verified target base branch",
    );
  }
  if (pullRequest.base_branch_candidates !== undefined) {
    if (
      !Array.isArray(pullRequest.base_branch_candidates) ||
      pullRequest.base_branch_candidates.length !== 1 ||
      pullRequest.base_branch_candidates[0] !== pullRequest.base_branch
    ) {
      addFinding(
        findings,
        "PreRebaseGate.pull_request does not identify exactly one base branch.",
        "resolve the base branch ambiguity and write a fresh gate",
      );
    }
  }
  if (!isSafeBranchName(pullRequest.head_branch)) {
    addFinding(
      findings,
      "PreRebaseGate.pull_request.head_branch is missing or unsafe.",
      "use the verified pull-request feature branch",
    );
  }
  if (!isSha(pullRequest.head_sha)) {
    addFinding(
      findings,
      "PreRebaseGate.pull_request.head_sha is missing or malformed.",
      "capture the full pull-request head SHA again",
    );
  }
}

function validateTargetFetch(targetFetch, findings) {
  if (!isRecord(targetFetch)) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch is missing.",
      "fetch and verify exactly one selected target branch",
    );
    return;
  }

  if (targetFetch.schema !== "TargetBranchFetch" || targetFetch.version !== 1) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch is not a version-1 TargetBranchFetch.",
      "write a fresh version-1 TargetBranchFetch handoff",
    );
  }
  if (targetFetch.status !== "verified") {
    addFinding(
      findings,
      `PreRebaseGate.target_fetch.status is ${safeLabel(targetFetch.status ?? "missing")}, not verified.`,
      "refresh and verify the exact target branch fetch",
    );
  }
  if (!validateRepositoryName(targetFetch.repository)) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch.repository is missing or malformed.",
      "use the verified target repository",
    );
  }

  const remote = targetFetch.remote;
  if (
    !isRecord(remote) ||
    !isNonEmptyString(remote.name) ||
    !SAFE_REMOTE_NAME.test(remote.name)
  ) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch.remote.name is missing or unsafe.",
      "use the configured named remote without URL or option syntax",
    );
  }
  if (
    isRecord(remote) &&
    remote.owner_repository !== null &&
    !validateRepositoryName(remote.owner_repository)
  ) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch.remote.owner_repository is malformed.",
      "verify the selected remote repository identity",
    );
  }
  if (
    isRecord(remote) &&
    remote.fetch_url_sanitized !== null &&
    !isNonEmptyString(remote.fetch_url_sanitized)
  ) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch.remote.fetch_url_sanitized is malformed.",
      "preserve a sanitized remote URL or null",
    );
  }

  if (!isSafeBranchName(targetFetch.branch_name)) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch.branch_name is missing or unsafe.",
      "select exactly one safe target base branch",
    );
  }
  if (
    !isNonEmptyString(targetFetch.remote_ref) ||
    targetFetch.remote_ref !== `refs/heads/${targetFetch.branch_name}`
  ) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch.remote_ref does not match the target branch.",
      "refresh the exact target branch fetch handoff",
    );
  }
  if (
    !isRecord(remote) ||
    !isNonEmptyString(remote.name) ||
    !SAFE_REMOTE_NAME.test(remote.name) ||
    targetFetch.tracking_ref !==
      `refs/remotes/${remote.name}/${targetFetch.branch_name}`
  ) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch.tracking_ref does not match the named remote and branch.",
      "refresh the exact target tracking reference",
    );
  }
  if (!isSha(targetFetch.remote_sha) || !isSha(targetFetch.tracking_sha)) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch does not contain full remote and tracking SHAs.",
      "fetch and verify matching full target SHAs",
    );
  } else if (
    targetFetch.remote_sha.toLowerCase() !== targetFetch.tracking_sha.toLowerCase()
  ) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch remote and tracking SHAs differ.",
      "refresh the target branch and verify the SHA match",
    );
  }

  if (
    !isRecord(targetFetch.authorization) ||
    targetFetch.authorization.approved !== true ||
    !isNonEmptyString(targetFetch.authorization.evidence)
  ) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch authorization does not prove the exact fetch.",
      "preserve exact target-fetch approval evidence",
    );
  }
  if (
    !isRecord(targetFetch.fetch) ||
    targetFetch.fetch.attempted !== true ||
    !["success", "up_to_date"].includes(targetFetch.fetch.result) ||
    !Array.isArray(targetFetch.fetch.evidence)
  ) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch.fetch does not prove a completed narrow fetch.",
      "refresh and verify the exact target branch fetch",
    );
  }
  if (!isRecord(targetFetch.verification)) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch.verification is missing.",
      "verify repository, remote branch, tracking ref, and SHA match",
    );
  } else {
    for (const field of [
      "repository_match",
      "remote_branch_exists",
      "tracking_ref_exists",
      "sha_match",
    ]) {
      if (targetFetch.verification[field] !== "pass") {
        addFinding(
          findings,
          `PreRebaseGate.target_fetch.verification.${field} is not pass.`,
          "refresh the target fetch with complete verification evidence",
        );
      }
    }
  }
  if (targetFetch.failure !== null) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch.failure is not null.",
      "resolve the target-fetch failure and write a fresh verified handoff",
    );
  }
  if (
    !Object.hasOwn(targetFetch, "recommended_next_skill") ||
    (targetFetch.recommended_next_skill !== null &&
      !isNonEmptyString(targetFetch.recommended_next_skill))
  ) {
    addFinding(
      findings,
      "PreRebaseGate.target_fetch.recommended_next_skill is missing or malformed.",
      "write a complete version-1 TargetBranchFetch",
    );
  }
}

function validateAuthorization(authorization, findings) {
  if (!isRecord(authorization)) {
    addFinding(
      findings,
      "PreRebaseGate.authorization is missing.",
      "obtain and record exact user or repository-policy authorization for this local rebase",
    );
    return;
  }

  if (
    authorization.approved !== true ||
    authorization.exact_target !== true ||
    authorization.exact_operation !== true
  ) {
    addFinding(
      findings,
      "PreRebaseGate.authorization does not authorize the exact target and local rebase operation.",
      "obtain explicit user or repository-policy authorization for this repository, worktree, branches, target SHA, and rebase",
    );
  }
  if (!ALLOWED_AUTHORIZATION_SOURCES.has(authorization.source)) {
    addFinding(
      findings,
      "PreRebaseGate.authorization.source is not explicit_user or repository_policy.",
      "record a valid exact authorization source",
    );
  }
  if (!isNonEmptyString(authorization.evidence)) {
    addFinding(
      findings,
      "PreRebaseGate.authorization.evidence is missing.",
      "record the exact authorization evidence without relying on readiness or routine delivery authorization",
    );
  }
  if (
    authorization.approved_at !== undefined &&
    authorization.approved_at !== null &&
    !isIsoTimestamp(authorization.approved_at)
  ) {
    addFinding(
      findings,
      "PreRebaseGate.authorization.approved_at is malformed.",
      "record a valid approval timestamp or null",
    );
  }
}

function validateGate(gate, findings) {
  if (!isRecord(gate)) {
    return;
  }
  if (gate.schema !== "PreRebaseGate" || gate.version !== 1) {
    addFinding(
      findings,
      "PreRebaseGate has an unsupported schema version.",
      "write a fresh version-1 PreRebaseGate",
    );
  }
  if (!isIsoTimestamp(gate.written_at)) {
    addFinding(
      findings,
      "PreRebaseGate.written_at is missing or malformed.",
      "write a fresh current PreRebaseGate",
    );
  } else if (Date.parse(gate.written_at) > Date.now() + 60_000) {
    addFinding(
      findings,
      "PreRebaseGate.written_at is in the future.",
      "write the gate with the current time from the verified worktree",
    );
  }

  validateWorkspace(gate.workspace, findings);
  validatePullRequest(gate.pull_request, findings);
  validateTargetFetch(gate.target_fetch, findings);
  validateAuthorization(gate.authorization, findings);
}

function compareGateIdentities(
  gate,
  repositoryRoot,
  branch,
  headSha,
  targetSha,
  findings,
) {
  if (!isRecord(gate)) {
    return;
  }

  const workspace = gate.workspace;
  const pullRequest = gate.pull_request;
  const targetFetch = gate.target_fetch;

  if (
    isRecord(workspace) &&
    isNonEmptyString(workspace.path) &&
    isAbsolute(workspace.path) &&
    normalizeAbsolutePath(workspace.path) !== normalizeAbsolutePath(repositoryRoot)
  ) {
    addFinding(
      findings,
      "PreRebaseGate.workspace.path does not match the live Git worktree.",
      "run the rebase workflow from the exact verified implementation worktree",
    );
  }
  if (isRecord(workspace) && workspace.branch !== branch) {
    addFinding(
      findings,
      "PreRebaseGate.workspace.branch does not match the live branch.",
      "refresh the gate from the currently checked-out feature branch",
    );
  }
  if (isRecord(pullRequest) && pullRequest.head_branch !== branch) {
    addFinding(
      findings,
      "The live branch is not the pull-request head branch recorded in the gate.",
      "use the exact pull-request implementation branch",
    );
  }
  if (
    isRecord(workspace) &&
    isSha(workspace.head_sha) &&
    workspace.head_sha.toLowerCase() !== headSha.toLowerCase()
  ) {
    addFinding(
      findings,
      "PreRebaseGate.workspace.head_sha does not match the live HEAD.",
      "write a fresh gate for the current pre-rebase HEAD",
    );
  }
  if (
    isRecord(pullRequest) &&
    isSha(pullRequest.head_sha) &&
    pullRequest.head_sha.toLowerCase() !== headSha.toLowerCase()
  ) {
    addFinding(
      findings,
      "The live HEAD does not match the pull-request head SHA recorded in the gate.",
      "refresh the pull-request evidence and write a fresh gate",
    );
  }
  if (
    isRecord(pullRequest) &&
    isNonEmptyString(pullRequest.base_branch) &&
    pullRequest.base_branch === branch
  ) {
    addFinding(
      findings,
      "The checked-out branch is the pull-request base branch, not a feature branch.",
      "run the rebase only from the verified pull-request head worktree",
    );
  }

  if (
    isRecord(workspace) &&
    isRecord(pullRequest) &&
    validateRepositoryName(workspace.repository) &&
    validateRepositoryName(pullRequest.repository) &&
    normalizeRepository(workspace.repository) !==
      normalizeRepository(pullRequest.repository)
  ) {
    addFinding(
      findings,
      "PreRebaseGate workspace and pull-request repositories differ.",
      "refresh all gate identities from one verified repository",
    );
  }
  if (
    isRecord(workspace) &&
    isRecord(targetFetch) &&
    validateRepositoryName(workspace.repository) &&
    validateRepositoryName(targetFetch.repository) &&
    normalizeRepository(workspace.repository) !==
      normalizeRepository(targetFetch.repository)
  ) {
    addFinding(
      findings,
      "PreRebaseGate workspace and target-fetch repositories differ.",
      "refresh the target fetch for the same verified repository",
    );
  }
  if (
    isRecord(pullRequest) &&
    isRecord(targetFetch) &&
    isNonEmptyString(pullRequest.base_branch) &&
    targetFetch.branch_name !== pullRequest.base_branch
  ) {
    addFinding(
      findings,
      "The target fetch branch does not equal the pull-request base branch.",
      "resolve the base branch uniquely and refresh the target fetch",
    );
  }
  if (
    isRecord(targetFetch) &&
    isSha(targetFetch.tracking_sha) &&
    isSha(targetSha) &&
    targetFetch.tracking_sha.toLowerCase() !== targetSha.toLowerCase()
  ) {
    addFinding(
      findings,
      "The command target SHA does not equal the verified target tracking SHA.",
      "rebase only onto the exact full tracking SHA from TargetBranchFetch",
    );
  }
}

function parseWorktreeRecords(output) {
  const records = [];
  let current = null;

  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) {
      if (current !== null) {
        records.push(current);
        current = null;
      }
      continue;
    }

    const separator = line.indexOf(" ");
    const key = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? "" : line.slice(separator + 1);

    if (key === "worktree") {
      if (current !== null) {
        records.push(current);
      }
      current = { path: value };
      continue;
    }
    if (current !== null) {
      current[key] = value;
    }
  }

  if (current !== null) {
    records.push(current);
  }
  return records;
}

function validateRegisteredWorktree(repositoryRoot, branch, headSha, findings) {
  let output;
  try {
    output = runGit(repositoryRoot, ["worktree", "list", "--porcelain"]);
  } catch {
    addFinding(
      findings,
      "The live Git worktree registration could not be verified.",
      "run verify-worktree and use its active registered worktree",
    );
    return;
  }

  const records = parseWorktreeRecords(output);
  const matches = records.filter(
    (record) =>
      isNonEmptyString(record.path) &&
      normalizeAbsolutePath(record.path) === normalizeAbsolutePath(repositoryRoot),
  );

  if (matches.length !== 1) {
    addFinding(
      findings,
      `The live Git worktree registration is ambiguous (${matches.length} matching entries).`,
      "verify one registered implementation worktree before rebasing",
    );
    return;
  }

  const match = matches[0];
  if (records.length > 0 && match === records[0]) {
    addFinding(
      findings,
      "The rebase target is the primary checkout.",
      "use the verified dedicated implementation worktree",
    );
  }
  if (match.branch !== `refs/heads/${branch}`) {
    addFinding(
      findings,
      "The registered worktree branch does not match the live feature branch.",
      "verify the registered worktree and checked-out branch",
    );
  }
  if (isNonEmptyString(match.HEAD) && match.HEAD.toLowerCase() !== headSha.toLowerCase()) {
    addFinding(
      findings,
      "The registered worktree HEAD does not match the live HEAD.",
      "refresh the worktree identity and write a fresh gate",
    );
  }
}

function validateCleanWorktree(repositoryRoot, findings) {
  let status;
  try {
    status = runGit(repositoryRoot, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
  } catch {
    addFinding(
      findings,
      "The current worktree status could not be read.",
      "verify-worktree before attempting the rebase",
    );
    return;
  }

  if (status.length > 0) {
    const count = status.split(/\r?\n/).filter(Boolean).length;
    addFinding(
      findings,
      `The worktree is not clean (${count} status entr${count === 1 ? "y" : "ies"}).`,
      "save or remove the uncommitted changes and write a fresh gate",
    );
  }

  let unmerged;
  try {
    unmerged = runGit(repositoryRoot, ["ls-files", "--unmerged"]);
  } catch {
    addFinding(
      findings,
      "The unmerged index state could not be verified.",
      "verify-worktree before attempting the rebase",
    );
  }
  if (typeof unmerged === "string" && unmerged.length > 0) {
    addFinding(
      findings,
      "The index contains unmerged entries.",
      "resolve or preserve the conflict state outside this hook before rebasing",
    );
  }

  for (const [marker, label] of ACTIVE_OPERATION_MARKERS) {
    let markerPath;
    try {
      markerPath = runGit(repositoryRoot, ["rev-parse", "--git-path", marker]);
    } catch {
      addFinding(
        findings,
        `The active ${label} operation marker could not be checked.`,
        "verify-worktree and confirm that no Git operation is in progress",
      );
      continue;
    }
    const absoluteMarkerPath = isAbsolute(markerPath)
      ? markerPath
      : resolve(repositoryRoot, markerPath);
    if (existsSync(absoluteMarkerPath)) {
      addFinding(
        findings,
        `Git reports an active ${label} operation.`,
        "finish or safely preserve the active Git operation before rebasing",
      );
    }
  }
}

function normalizeRemoteRepository(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  let pathValue;
  try {
    if (value.includes("://")) {
      const url = new URL(value);
      if (
        url.password !== "" ||
        (url.protocol !== "ssh:" &&
          url.protocol !== "git+ssh:" &&
          url.username !== "")
      ) {
        return null;
      }
      pathValue = url.pathname;
    } else {
      const scpStyle = value.match(/^[^@/\s]+@[^:/\s]+:(.+)$/);
      if (!scpStyle) {
        return null;
      }
      pathValue = scpStyle[1];
    }
  } catch {
    return null;
  }

  const parts = pathValue
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "")
    .split("/");
  if (parts.length < 2) {
    return null;
  }
  const owner = parts.at(-2);
  const repository = parts.at(-1);
  if (!isNonEmptyString(owner) || !isNonEmptyString(repository)) {
    return null;
  }
  return `${owner}/${repository}`.toLowerCase();
}

function validateRemoteContext(repositoryRoot, gate, findings) {
  const targetFetch = gate?.target_fetch;
  const pullRequest = gate?.pull_request;
  const remote = targetFetch?.remote;
  if (
    !isRecord(targetFetch) ||
    !isRecord(remote) ||
    !SAFE_REMOTE_NAME.test(remote.name ?? "") ||
    !isNonEmptyString(targetFetch.tracking_ref) ||
    !isNonEmptyString(targetFetch.tracking_sha)
  ) {
    return;
  }

  let configuredRemotes;
  try {
    configuredRemotes = runGit(repositoryRoot, ["remote"])
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    addFinding(
      findings,
      "The configured Git remotes could not be read.",
      "verify the current remote context without changing remote configuration",
    );
    return;
  }

  if (!configuredRemotes.includes(remote.name)) {
    addFinding(
      findings,
      `The target remote ${safeLabel(remote.name)} is not configured in the worktree.`,
      "use the exact configured remote from the verified TargetBranchFetch",
    );
  } else {
    let remoteUrls;
    try {
      remoteUrls = runGit(repositoryRoot, ["remote", "get-url", "--all", remote.name])
        .split(/\r?\n/)
        .filter(Boolean);
    } catch {
      addFinding(
        findings,
        `The target remote ${safeLabel(remote.name)} URL could not be verified.`,
        "verify the configured target remote without rewriting it",
      );
      remoteUrls = [];
    }

    const expectedRepository = normalizeRepository(
      remote.owner_repository ?? targetFetch.repository,
    );
    const remoteRepositories = remoteUrls.map(normalizeRemoteRepository);
    if (
      remoteRepositories.length === 0 ||
      remoteRepositories.some((repository) => repository === null)
    ) {
      addFinding(
        findings,
        "The target remote URL cannot be mapped to one verified repository.",
        "verify the target remote repository identity",
      );
    } else if (
      new Set(remoteRepositories).size !== 1 ||
      remoteRepositories[0] !== expectedRepository
    ) {
      addFinding(
        findings,
        "The configured target remote does not match the verified repository.",
        "select the exact repository remote without changing remote configuration",
      );
    }

    let defaultBranchRef;
    try {
      defaultBranchRef = runGit(repositoryRoot, [
        "symbolic-ref",
        "--quiet",
        "--short",
        `refs/remotes/${remote.name}/HEAD`,
      ]);
    } catch {
      addFinding(
        findings,
        "The configured remote default branch could not be verified.",
        "refresh the remote context and verify the pull-request feature branch",
      );
      defaultBranchRef = null;
    }

    if (isNonEmptyString(defaultBranchRef)) {
      const defaultPrefix = `${remote.name}/`;
      const defaultBranch = defaultBranchRef.startsWith(defaultPrefix)
        ? defaultBranchRef.slice(defaultPrefix.length)
        : defaultBranchRef.startsWith("refs/remotes/")
          ? defaultBranchRef.slice("refs/remotes/".length).split("/").slice(1).join("/")
          : null;
      if (!isSafeBranchName(defaultBranch)) {
        addFinding(
          findings,
          "The configured remote default branch is missing or unsafe.",
          "verify the remote default branch without changing it",
        );
      } else if (pullRequest?.head_branch === defaultBranch) {
        addFinding(
          findings,
          "The pull-request head branch is the configured remote default branch.",
          "use a non-default pull-request feature branch for the rebase",
        );
      }
    }
  }

  let liveTrackingSha;
  try {
    liveTrackingSha = runGit(repositoryRoot, [
      "rev-parse",
      "--verify",
      `${targetFetch.tracking_ref}^{commit}`,
    ]);
  } catch {
    addFinding(
      findings,
      "The target tracking ref is missing or cannot be resolved locally.",
      "run fetch-target-branch for the exact target branch and refresh the gate",
    );
    return;
  }
  if (!isSha(liveTrackingSha)) {
    addFinding(
      findings,
      "The live target tracking ref did not resolve to a full commit SHA.",
      "refresh and verify the exact target branch tracking ref",
    );
  } else if (liveTrackingSha.toLowerCase() !== targetFetch.tracking_sha.toLowerCase()) {
    addFinding(
      findings,
      "The live target tracking SHA differs from the approved target-fetch SHA.",
      "refresh the target branch and write a new rebase gate",
    );
  }

  if (
    isRecord(pullRequest) &&
    isNonEmptyString(pullRequest.base_branch) &&
    targetFetch.branch_name !== pullRequest.base_branch
  ) {
    addFinding(
      findings,
      "The current remote context points at a base branch different from the pull request.",
      "resolve exactly one pull-request base branch and refresh the target fetch",
    );
  }
}

function validateNoUnsecuredChanges(repositoryRoot, pullRequest, headSha, findings) {
  if (!isRecord(pullRequest) || !isSafeBranchName(pullRequest.head_branch)) {
    return;
  }

  let upstreamRef;
  try {
    upstreamRef = runGit(repositoryRoot, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
  } catch {
    addFinding(
      findings,
      "The feature branch has no verifiable remote upstream, so the pre-rebase HEAD is not secured remotely.",
      "push or otherwise verify the exact feature-branch upstream before rebasing",
    );
    return;
  }

  const upstreamPrefix = "refs/remotes/";
  if (!upstreamRef.startsWith(upstreamPrefix)) {
    addFinding(
      findings,
      "The feature-branch upstream is not a remote-tracking ref.",
      "verify the exact remote feature-branch upstream",
    );
    return;
  }

  const upstreamValue = upstreamRef.slice(upstreamPrefix.length);
  const separator = upstreamValue.indexOf("/");
  const upstreamRemote = separator < 0 ? "" : upstreamValue.slice(0, separator);
  const upstreamBranch = separator < 0 ? "" : upstreamValue.slice(separator + 1);
  if (
    !SAFE_REMOTE_NAME.test(upstreamRemote) ||
    upstreamBranch !== pullRequest.head_branch
  ) {
    addFinding(
      findings,
      "The configured feature-branch upstream does not identify the expected pull-request head branch.",
      "verify the remote tracking ref for the exact pull-request head branch",
    );
    return;
  }

  let upstreamSha;
  try {
    upstreamSha = runGit(repositoryRoot, [
      "rev-parse",
      "--verify",
      `${upstreamRef}^{commit}`,
    ]);
  } catch {
    addFinding(
      findings,
      "The configured feature-branch upstream cannot be resolved to a commit.",
      "refresh the remote feature-branch tracking ref and write a fresh gate",
    );
    return;
  }

  if (!isSha(upstreamSha) || !isSha(headSha)) {
    addFinding(
      findings,
      "The pre-rebase HEAD or feature-branch upstream has no verifiable full SHA.",
      "refresh the branch and remote SHA evidence before rebasing",
    );
  } else if (upstreamSha.toLowerCase() !== headSha.toLowerCase()) {
    addFinding(
      findings,
      "The pre-rebase HEAD differs from the remote feature-branch tracking SHA; local commits are not securely backed up for this operation.",
      "push or reconcile the exact pull-request head and write a fresh gate",
    );
  }
}

function validateRebaseCommand(invocation, gate, findings) {
  if (invocation.parseError) {
    addFinding(
      findings,
      invocation.parseError,
      "run one explicit, parseable git rebase command from the verified worktree",
    );
  }
  if (invocation.unsupportedTarget) {
    addFinding(
      findings,
      `The rebase uses ${safeLabel(invocation.unsupportedTarget)}, so the target worktree cannot be verified safely.`,
      "use git -C <verified-worktree> rebase <full-target-SHA>",
    );
  }
  if (invocation.unsupportedGlobalOption) {
    addFinding(
      findings,
      `The rebase command uses unsupported Git option ${safeLabel(invocation.unsupportedGlobalOption)}.`,
      "use only the bounded git -C <worktree> rebase <full-target-SHA> form",
    );
  }
  if (invocation.unsafeEnvironment) {
    addFinding(
      findings,
      `The rebase command sets unsafe Git environment variable ${safeLabel(invocation.unsafeEnvironment)}.`,
      "run the bounded rebase without Git directory, worktree, index, or config environment overrides",
    );
  }

  if (!Array.isArray(invocation.args) || invocation.args.length !== 1) {
    addFinding(
      findings,
      "The rebase command does not contain exactly one target revision.",
      "use git rebase with exactly the verified full target SHA and no rebase options",
    );
    return null;
  }

  const target = invocation.args[0];
  if (!isSha(target)) {
    const targetLabel = target.startsWith("-")
      ? `disallowed rebase option ${safeLabel(target)}`
      : "a branch name or non-commit target";
    addFinding(
      findings,
      `The rebase target is ${targetLabel}, not a full commit SHA.`,
      "use the exact full tracking SHA from TargetBranchFetch",
    );
    return null;
  }

  const expectedTarget = gate?.target_fetch?.tracking_sha;
  if (
    isSha(expectedTarget) &&
    target.toLowerCase() !== expectedTarget.toLowerCase()
  ) {
    addFinding(
      findings,
      "The rebase target SHA does not equal the approved TargetBranchFetch tracking SHA.",
      "use only the exact approved target tracking SHA",
    );
  }
  return target;
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
  const identified = identifyRebaseInvocations(command, parserDirectory);

  if (identified.invocations.length === 0) {
    if (likelyRebaseCommand(command)) {
      return makeDeny([
        {
          key: "parse",
          requirement:
            identified.reason ??
            "The command appears to contain a git rebase that cannot be identified safely.",
          nextStep: "run one direct, explicit, parseable git rebase command",
        },
      ]);
    }
    return makeAllow();
  }

  const findings = [];
  if (identified.invocations.length > 1) {
    addFinding(
      findings,
      "The shell command contains more than one git rebase invocation.",
      "run exactly one verified local rebase command",
    );
  }

  const invocation = identified.invocations[0];
  if (initialDirectory === null) {
    addFinding(
      findings,
      "The hook did not receive the rebase working directory.",
      "run the rebase from the verified implementation worktree",
    );
  }
  if (!existsSync(invocation.targetDirectory)) {
    addFinding(
      findings,
      "The rebase target worktree does not exist.",
      "run verify-worktree and use the registered implementation worktree",
    );
    return makeDeny(findings);
  }

  let targetSha = null;
  let repositoryRoot = null;
  let branch = null;
  let headSha = null;
  try {
    repositoryRoot = runGit(invocation.targetDirectory, [
      "rev-parse",
      "--show-toplevel",
    ]);
    branch = runGit(invocation.targetDirectory, ["branch", "--show-current"]);
    headSha = runGit(invocation.targetDirectory, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ]);
  } catch (error) {
    const operation =
      error instanceof GitCommandError ? safeLabel(error.operation) : "identity";
    addFinding(
      findings,
      `Git ${operation} verification failed for the rebase worktree.`,
      "verify-worktree and the current pull-request branch",
    );
    return makeDeny(findings);
  }

  if (!isNonEmptyString(branch)) {
    addFinding(
      findings,
      "The rebase worktree is detached or has no current branch.",
      "check out the verified pull-request feature branch",
    );
  }
  if (!isSha(headSha)) {
    addFinding(
      findings,
      "The live Git HEAD is missing or malformed.",
      "verify the pre-rebase commit identity",
    );
  }

  const gate = readGate(repositoryRoot, findings);
  targetSha = validateRebaseCommand(invocation, gate, findings);
  if (gate !== null) {
    validateGate(gate, findings);
    compareGateIdentities(
      gate,
      repositoryRoot,
      branch,
      headSha,
      targetSha,
      findings,
    );
    validateRegisteredWorktree(repositoryRoot, branch, headSha, findings);
    validateCleanWorktree(repositoryRoot, findings);
    validateRemoteContext(repositoryRoot, gate, findings);
    validateNoUnsecuredChanges(
      repositoryRoot,
      gate.pull_request,
      headSha,
      findings,
    );
  }

  return findings.length > 0 ? makeDeny(findings) : makeAllow();
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
    process.stdout.write(
      JSON.stringify({
        permission: "deny",
        user_message: result.message,
        agent_message: result.message,
      }) + "\n",
    );
    process.exitCode = 2;
    return;
  }

  let result;
  try {
    result = evaluate(input);
  } catch (error) {
    const errorType = error instanceof Error ? safeLabel(error.name) : "unknown-error";
    result = makeDeny([
      {
        key: "unexpected",
        requirement: `The deterministic pre-rebase check failed closed with ${errorType}.`,
        nextStep: "verify-worktree and write a fresh PreRebaseGate",
      },
    ]);
  }

  writeResponse(input, result);
  if (result.decision === "deny") {
    process.exitCode = 2;
  }
}

main();
