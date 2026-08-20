import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import {
  isAbsolute,
  normalize,
  resolve,
} from "node:path";

import { readHookInput } from "./lib/read-hook-input.mjs";
import { runCommandResult } from "./lib/run-command.mjs";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_GATE_BYTES = 2 * 1024 * 1024;
const GATE_RELATIVE_PATH = ".cursor/hooks/state/pre-merge.json";
const SAFE_BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MERGE_METHODS = new Set(["merge", "squash", "rebase"]);

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

function normalizeRepository(value) {
  return isNonEmptyString(value) ? value.toLowerCase() : null;
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(value).replace(/\/+$/, "").toLowerCase();
  }
}

function normalizePath(value) {
  return normalize(resolve(value)).toLowerCase();
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

function safeLabel(value) {
  return String(value).replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 160);
}

function textValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value.toString === "function") {
    return value.toString();
  }
  return String(value);
}

function runCommand(executable, args, workingDirectory, operation) {
  const result = runCommandResult(executable, args, {
    cwd: workingDirectory,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    operation,
  });
  if (result.ok) result.stdout = textValue(result.stdout).trim();
  return result;
}

function runGit(workingDirectory, args, operation = `git ${args[0] ?? ""}`) {
  return runCommand("git", args, workingDirectory, operation);
}

function runGh(workingDirectory, args, operation = `gh ${args[0] ?? ""}`) {
  return runCommand("gh", args, workingDirectory, operation);
}

function classifyCommandFailure(result) {
  const text = `${result?.stderr ?? ""} ${result?.stdout ?? ""}`.toLowerCase();
  if (
    /\b(401|403)\b/.test(text) ||
    text.includes("authentication") ||
    text.includes("not logged in") ||
    text.includes("login required")
  ) {
    return "auth_unavailable";
  }
  if (
    /\b404\b/.test(text) ||
    text.includes("not found") ||
    text.includes("could not resolve to a repository")
  ) {
    return "not_found";
  }
  return "api_failure";
}

function addUnique(list, value) {
  if (isNonEmptyString(value) && !list.includes(value)) {
    list.push(value);
  }
}

function addDeviation(deviations, id, description, impact, evidence = []) {
  if (deviations.some((item) => item.id === id)) {
    return;
  }
  deviations.push({
    id,
    description,
    impact,
    evidence: Array.isArray(evidence) ? evidence : [String(evidence)],
  });
}

function addOpenAction(
  actions,
  id,
  action,
  target,
  reason,
  requiresSeparateApproval = true,
) {
  if (actions.some((item) => item.id === id && item.target === target)) {
    return;
  }
  actions.push({
    id,
    action,
    target,
    suggested_skill:
      id === "close-linked-issue"
        ? "close-linked-issue"
        : id.includes("worktree")
          ? "cleanup-worktree"
          : id.includes("branch")
            ? "delete-merged-branch"
            : null,
    requires_separate_approval: requiresSeparateApproval,
    reason,
  });
}

function createEvidenceTracker() {
  const sources = new Map();

  return {
    record(name, status, evidence) {
      sources.set(name, {
        name,
        status,
        evidence: Array.isArray(evidence) ? evidence : [String(evidence)],
      });
    },
    list() {
      return [...sources.values()];
    },
    resultStatus() {
      const values = [...sources.values()];
      if (values.length === 0) {
        return "unavailable";
      }
      if (values.some((source) => source.status === "unavailable")) {
        return "partial";
      }
      return "complete";
    },
  };
}

function emptyIssueClosure() {
  return {
    expected: null,
    observed: "unknown",
    attribution: "unavailable",
    issue: null,
    relationship_evidence: {
      status: "unavailable",
      keyword_evidence: [],
      github_evidence: [],
    },
    evidence: [],
  };
}

function emptyCleanup() {
  return {
    available_actions: [],
    performed_by_hook: [],
    approval_required: true,
    evidence: [],
  };
}

function emptyStatus(
  tracker,
  {
    status = "blocked",
    repository = null,
    number = null,
    url = null,
    prState = "unknown",
    baseBranch = null,
    headBranch = null,
    failure = null,
    deviations = [],
    openActions = [],
    rationale = "Post-merge verification did not complete.",
  } = {},
) {
  return {
    schema: "PostMergeStatus",
    version: 1,
    status,
    repository,
    pull_request: {
      number,
      url,
      state: prState,
      base_branch: baseBranch,
      head_branch: headBranch,
    },
    merge: {
      observed: false,
      merged_at: null,
      merge_commit_sha: null,
      target_branch: baseBranch,
      target_contains_merge_commit: "not-applicable",
      evidence: [],
    },
    issue_closure: emptyIssueClosure(),
    cleanup: emptyCleanup(),
    deviations,
    open_actions: openActions,
    evidence: {
      status: tracker.resultStatus(),
      sources: tracker.list(),
    },
    rationale,
    checked_at: new Date().toISOString(),
    failure,
  };
}

function makeFailure(code, description) {
  return { code, description };
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
  if (
    !isNonEmptyString(value) ||
    value.includes("\0") ||
    value === "~" ||
    value.startsWith("~")
  ) {
    return null;
  }
  return resolve(currentDirectory, value);
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

function parseMergeEndpoint(value) {
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
    /^repos\/([^/\s]+)\/([^/\s]+)\/pulls\/([1-9]\d*)\/merge$/i,
  );
  if (match === null) {
    return null;
  }

  return {
    repository: `${match[1]}/${match[2]}`,
    number: Number(match[3]),
  };
}

function findMergeEndpoint(args) {
  for (const token of args) {
    const endpoint = parseMergeEndpoint(token);
    if (endpoint !== null) {
      return endpoint;
    }
  }
  return null;
}

function readOptionValue(args, index) {
  const option = splitOption(args[index]);
  if (option.inlineValue !== null) {
    return { value: option.inlineValue, nextIndex: index };
  }
  const next = args[index + 1];
  if (!isNonEmptyString(next) || next.startsWith("-")) {
    return { value: null, nextIndex: index };
  }
  return { value: next, nextIndex: index + 1 };
}

function identifyApiMethod(args) {
  let method = null;
  for (let index = 0; index < args.length; index += 1) {
    const option = splitOption(args[index]);
    if (!["--method", "-x", "-X"].includes(option.name)) {
      continue;
    }
    method = option.inlineValue ?? args[index + 1] ?? null;
    if (option.inlineValue === null) {
      index += 1;
    }
  }
  return isNonEmptyString(method) ? method.toUpperCase() : null;
}

function identifyMergeInvocations(command, initialDirectory) {
  if (!isNonEmptyString(command)) {
    return {
      invocations: [],
      parseable: false,
      reason: "The hook input does not contain a shell command.",
    };
  }
  if (!isNonEmptyString(initialDirectory)) {
    return {
      invocations: [],
      parseable: false,
      reason: "The hook input does not contain the shell working directory.",
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
  let mergeSeen = false;
  let unsafeCommandSegment = false;
  const invocations = [];

  for (const segment of splitCommandSegments(tokens)) {
    if (segment.length === 0) {
      continue;
    }

    const firstIndex = unwrapCommandWrappers(segment);
    const first = segment[firstIndex]?.toLowerCase();

    if (first === "cd" || first === "pushd" || first === "set-location") {
      if (mergeSeen) {
        unsafeCommandSegment = true;
      }
      const directoryIndex =
        segment[firstIndex + 1]?.toLowerCase() === "/d"
          ? firstIndex + 2
          : firstIndex + 1;
      const resolvedDirectory = resolveCommandDirectory(
        currentDirectory,
        segment[directoryIndex],
      );
      if (resolvedDirectory === null) {
        unsafeCommandSegment = true;
      } else {
        currentDirectory = resolvedDirectory;
      }
      continue;
    }

    if (!isGhCommand(segment, firstIndex)) {
      unsafeCommandSegment = true;
      continue;
    }

    const commandName = segment[firstIndex + 1]?.toLowerCase();
    const subcommand = segment[firstIndex + 2]?.toLowerCase();

    if (commandName === "pr" && subcommand === "merge") {
      if (mergeSeen) {
        unsafeCommandSegment = true;
      }
      mergeSeen = true;
      invocations.push({
        kind: "pr-merge",
        targetDirectory: currentDirectory,
        args: segment.slice(firstIndex + 3),
      });
      continue;
    }

    if (commandName === "api") {
      const args = segment.slice(firstIndex + 2);
      const endpoint = findMergeEndpoint(args);
      const method = identifyApiMethod(args);
      if (
        endpoint !== null &&
        method !== null &&
        !["GET", "HEAD"].includes(method)
      ) {
        if (mergeSeen) {
          unsafeCommandSegment = true;
        }
        mergeSeen = true;
        invocations.push({
          kind: "api-merge",
          targetDirectory: currentDirectory,
          args,
          endpoint,
        });
        continue;
      }
    }

    unsafeCommandSegment = true;
  }

  const reason = unsafeCommandSegment
    ? "The shell command contains another command, pipeline, or unsupported segment."
    : null;
  return {
    invocations,
    parseable: true,
    reason,
  };
}

function parsePrMergeArguments(args) {
  const values = new Map();
  const positionals = [];
  const methodFlags = new Set(["--merge", "--squash", "--rebase"]);
  const valueOptions = new Set([
    "--repo",
    "--match-head-commit",
    "--subject",
    "--body",
    "--body-file",
  ]);
  let parseError = null;
  let deleteBranch = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    const option = splitOption(token);
    if (methodFlags.has(option.name)) {
      values.set(option.name, true);
      continue;
    }

    if (option.name === "--delete-branch") {
      if (option.inlineValue === null) {
        deleteBranch = true;
      } else if (option.inlineValue.toLowerCase() === "true") {
        deleteBranch = true;
      } else if (option.inlineValue.toLowerCase() === "false") {
        deleteBranch = false;
      } else {
        parseError = "The --delete-branch value is not a deterministic boolean.";
      }
      continue;
    }

    if (valueOptions.has(option.name)) {
      const parsed = readOptionValue(args, index);
      if (option.inlineValue === null) {
        index = parsed.nextIndex;
      }
      if (parsed.value === null) {
        parseError = `The ${safeLabel(option.name)} option has no explicit value.`;
      } else {
        values.set(option.name, parsed.value);
      }
      continue;
    }

    parseError = `The merge command uses unsupported option ${safeLabel(option.name)}.`;
    if (option.inlineValue === null && index + 1 < args.length) {
      index += 1;
    }
  }

  if (positionals.length !== 1) {
    parseError =
      parseError ??
      "The merge command does not identify exactly one pull request.";
    return {
      kind: "pr-merge",
      repository: null,
      number: null,
      url: null,
      method: null,
      deleteBranch,
      parseError,
    };
  }

  const target = parsePullRequestTarget(positionals[0]);
  if (target === null) {
    return {
      kind: "pr-merge",
      repository: null,
      number: null,
      url: null,
      method: null,
      deleteBranch,
      parseError:
        parseError ??
        "The merge target is not a positive pull-request number or canonical URL.",
    };
  }

  const repository = values.get("--repo") ?? target.repository;
  if (!validateRepositoryName(repository)) {
    parseError =
      parseError ??
      "The merge command has no explicit verifiable repository.";
  }
  if (
    target.repository !== null &&
    normalizeRepository(repository) !== normalizeRepository(target.repository)
  ) {
    parseError =
      parseError ??
      "The pull-request URL and --repo values identify different repositories.";
  }

  const selectedMethods = [...methodFlags].filter((flag) => values.has(flag));
  if (selectedMethods.length !== 1) {
    parseError =
      parseError ??
      "The merge command does not select exactly one merge method.";
  }

  return {
    kind: "pr-merge",
    repository: validateRepositoryName(repository) ? repository : null,
    number: target.number,
    url:
      target.url ??
      (validateRepositoryName(repository)
        ? `https://github.com/${repository}/pull/${target.number}`
        : null),
    method:
      selectedMethods.length === 1
        ? selectedMethods[0].slice(2)
        : null,
    deleteBranch,
    parseError,
  };
}

function parseApiMergeArguments(args, endpoint) {
  let parseError = null;
  const endpointCount = args.filter(
    (argument) => parseMergeEndpoint(argument) !== null,
  ).length;
  if (endpointCount !== 1) {
    parseError = "The API merge command does not identify exactly one merge endpoint.";
  }
  const method = identifyApiMethod(args);
  const fieldOptions = new Set([
    "--field",
    "--raw-field",
    "--typed-field",
    "-f",
    "-F",
  ]);
  let mergeMethod = null;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const option = splitOption(token);
    if (!fieldOptions.has(option.name)) {
      continue;
    }
    const parsed = readOptionValue(args, index);
    if (option.inlineValue === null) {
      index = parsed.nextIndex;
    }
    if (typeof parsed.value !== "string") {
      continue;
    }
    const separatorIndex = parsed.value.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }
    const key = parsed.value.slice(0, separatorIndex);
    const value = parsed.value.slice(separatorIndex + 1);
    if (key === "merge_method") {
      mergeMethod = value.toLowerCase();
    }
  }

  if (method === null || !["PUT", "POST"].includes(method)) {
    parseError = "The API merge command does not use an explicit write method.";
  }
  if (mergeMethod !== null && !MERGE_METHODS.has(mergeMethod)) {
    parseError =
      parseError ?? "The API merge payload selects an unsupported merge method.";
  }

  return {
    kind: "api-merge",
    repository: endpoint.repository,
    number: endpoint.number,
    url: `https://github.com/${endpoint.repository}/pull/${endpoint.number}`,
    method: mergeMethod,
    deleteBranch: false,
    parseError,
  };
}

function parseInvocation(invocation) {
  if (!existsSync(invocation.targetDirectory)) {
    return {
      kind: invocation.kind,
      repository: null,
      number: null,
      url: null,
      method: null,
      deleteBranch: false,
      parseError: "The merge command worktree does not exist.",
    };
  }
  if (invocation.kind === "pr-merge") {
    return parsePrMergeArguments(invocation.args);
  }
  return parseApiMergeArguments(invocation.args, invocation.endpoint);
}

function likelyMergeCommand(command) {
  return (
    /\bgh(?:\.exe|\.cmd|\.bat)?\s+pr\s+merge\b/i.test(command) ||
    (/\bgh(?:\.exe|\.cmd|\.bat)?\s+api\b/i.test(command) &&
      /\/pulls\/[1-9]\d*\/merge\b/i.test(command))
  );
}

function getInputValue(input, property) {
  if (typeof input?.[property] === "string") {
    return input[property];
  }
  if (isRecord(input?.tool_input) && typeof input.tool_input[property] === "string") {
    return input.tool_input[property];
  }
  return null;
}

function isCodexInput(input) {
  return (
    input?.hook_event_name === "PostToolUse" ||
    typeof input?.tool_name === "string" ||
    isRecord(input?.tool_input)
  );
}

function parseJsonResult(result, tracker, sourceName, description) {
  if (!result.ok) {
    tracker.record(sourceName, "unavailable", [
      `${description} could not be read with the available command.`,
    ]);
    return null;
  }
  if (!isNonEmptyString(result.stdout)) {
    tracker.record(sourceName, "unavailable", [
      `${description} returned no JSON.`,
    ]);
    return null;
  }
  try {
    const value = JSON.parse(result.stdout);
    tracker.record(sourceName, "loaded", [`${description} was read successfully.`]);
    return value;
  } catch {
    tracker.record(sourceName, "unavailable", [
      `${description} returned invalid JSON.`,
    ]);
    return null;
  }
}

function readGhJson(workingDirectory, args, tracker, sourceName, description) {
  const result = runGh(workingDirectory, args, description);
  return {
    value: parseJsonResult(result, tracker, sourceName, description),
    result,
  };
}

function readLivePullRequest(workingDirectory, repository, number, tracker) {
  return readGhJson(
    workingDirectory,
    [
      "pr",
      "view",
      String(number),
      "--repo",
      repository,
      "--json",
      "number,url,state,mergedAt,mergeCommit,baseRefName,baseRefOid,headRefName,headRefOid,body",
    ],
    tracker,
    "pull-request",
    "The current pull-request status",
  );
}

function readDefaultBranch(workingDirectory, repository, tracker) {
  const { value } = readGhJson(
    workingDirectory,
    ["repo", "view", repository, "--json", "nameWithOwner,defaultBranchRef"],
    tracker,
    "repository",
    "The repository default branch",
  );
  const branch = value?.defaultBranchRef?.name;
  return isSafeBranchName(branch) ? branch : null;
}

function extractMergeCommit(value) {
  if (isSha(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return null;
  }
  const candidate = value.oid ?? value.sha ?? value.id;
  return isSha(candidate) ? candidate : null;
}

function normalizedPullRequestState(value) {
  const state = String(value ?? "").toLowerCase();
  if (state === "merged") {
    return "merged";
  }
  if (state === "closed") {
    return "closed";
  }
  if (state === "open") {
    return "open";
  }
  return "unknown";
}

function readMergeContainment(
  workingDirectory,
  repository,
  targetBranch,
  mergeCommitSha,
  tracker,
) {
  if (!isSafeBranchName(targetBranch) || !isSha(mergeCommitSha)) {
    tracker.record("merge-containment", "unavailable", [
      "The target branch or merge commit is not verifiable.",
    ]);
    return "unavailable";
  }

  const route =
    `repos/${repository}/compare/${encodeURIComponent(mergeCommitSha)}` +
    `...${encodeURIComponent(targetBranch)}`;
  const { value } = readGhJson(
    workingDirectory,
    ["api", route],
    tracker,
    "merge-containment",
    "The target-branch merge-commit containment",
  );
  const comparison = String(value?.status ?? "").toLowerCase();
  if (comparison === "ahead" || comparison === "identical") {
    return "verified";
  }
  if (comparison === "behind" || comparison === "diverged") {
    return "not-verified";
  }
  return "unavailable";
}

function extractBodyClosingReferences(body, repository) {
  if (typeof body !== "string") {
    return [];
  }

  const pattern =
    /\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+((?:[^/\s#]+\/[^/\s#]+)?#[1-9]\d*)\b/gi;
  const references = new Set();

  for (const match of body.matchAll(pattern)) {
    const raw = match[1];
    const qualified = raw.includes("/") ? raw : `${repository}${raw}`;
    const parts = qualified.match(/^([^/\s]+\/[^/\s#]+)#([1-9]\d*)$/);
    if (parts !== null && validateRepositoryName(parts[1])) {
      references.add(`${parts[1].toLowerCase()}#${parts[2]}`);
    }
  }

  return [...references];
}

function parseCandidate(node) {
  if (!isRecord(node)) {
    return null;
  }
  const repository = node.repository?.nameWithOwner;
  const number = node.number;
  if (!validateRepositoryName(repository) || !Number.isInteger(number) || number < 1) {
    return null;
  }
  return {
    repository,
    number,
    url: isHttpUrl(node.url) ? node.url : null,
    key: `${repository.toLowerCase()}#${number}`,
  };
}

function readClosingIssues(workingDirectory, repository, number, tracker) {
  const separatorIndex = repository.indexOf("/");
  const owner = repository.slice(0, separatorIndex);
  const name = repository.slice(separatorIndex + 1);
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          closingIssuesReferences(first: 100) {
            nodes {
              number
              url
              repository {
                nameWithOwner
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      }
    }
  `;
  const { value } = readGhJson(
    workingDirectory,
    [
      "api",
      "graphql",
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `number=${number}`,
      "-f",
      `query=${query}`,
    ],
    tracker,
    "issue-relationship",
    "The pull-request closing-issue relationship",
  );
  if (Array.isArray(value?.errors) && value.errors.length > 0) {
    tracker.record("issue-relationship", "unavailable", [
      "GitHub returned errors while reading the closing-issue relationship.",
    ]);
    return null;
  }
  const connection = value?.data?.repository?.pullRequest?.closingIssuesReferences;
  if (
    !isRecord(connection) ||
    !Array.isArray(connection.nodes) ||
    !isRecord(connection.pageInfo) ||
    typeof connection.pageInfo.hasNextPage !== "boolean"
  ) {
    tracker.record("issue-relationship", "unavailable", [
      "The pull-request closing-issue relationship returned a malformed page.",
    ]);
    return null;
  }
  if (connection.pageInfo?.hasNextPage === true) {
    tracker.record("issue-relationship", "unavailable", [
      "The pull-request closing-issue relationship has more than one page.",
    ]);
    return null;
  }
  return connection.nodes;
}

function readIssue(workingDirectory, repository, number, tracker) {
  const { value } = readGhJson(
    workingDirectory,
    ["api", `repos/${repository}/issues/${number}`],
    tracker,
    `issue-${repository}#${number}`,
    "The linked issue",
  );
  if (
    !isRecord(value) ||
    value.number !== number ||
    !isHttpUrl(value.html_url)
  ) {
    return null;
  }
  return value;
}

function flattenTimeline(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenTimeline(item));
  }
  return isRecord(value) ? [value] : [];
}

function readIssueTimeline(
  workingDirectory,
  repository,
  number,
  tracker,
) {
  const { value } = readGhJson(
    workingDirectory,
    [
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/issues/${number}/timeline`,
      "-H",
      "Accept: application/vnd.github+json",
    ],
    tracker,
    `issue-timeline-${repository}#${number}`,
    "The linked-issue timeline",
  );
  return value === null ? null : flattenTimeline(value);
}

function hasDirectMergeAttribution(events, pullRequest, mergeCommitSha) {
  if (!Array.isArray(events)) {
    return false;
  }

  const urlNeedle = `/pull/${pullRequest.number}`;
  const apiNeedle = `/pulls/${pullRequest.number}`;
  return events.some((event) => {
    const eventName = String(event?.event ?? "").toLowerCase();
    if (!["cross-referenced", "referenced", "closed"].includes(eventName)) {
      return false;
    }
    const serialized = JSON.stringify(event);
    return (
      serialized.includes(urlNeedle) ||
      serialized.includes(apiNeedle) ||
      (isSha(mergeCommitSha) &&
        String(event?.commit_id ?? "").toLowerCase() ===
          mergeCommitSha.toLowerCase())
    );
  });
}

function buildIssueClosure(
  workingDirectory,
  repository,
  livePullRequest,
  defaultBranch,
  tracker,
  deviations,
  openActions,
) {
  const closure = emptyIssueClosure();
  const graphNodes = readClosingIssues(
    workingDirectory,
    repository,
    livePullRequest.number,
    tracker,
  );
  const bodyReferences = extractBodyClosingReferences(
    livePullRequest.body,
    repository,
  );
  if (graphNodes === null) {
    addDeviation(
      deviations,
      "issue-relationship-unavailable",
      "The live GitHub closing-issue relationship could not be verified.",
      "Expected issue closure remains incomplete unless independently supported by explicit body evidence.",
      ["The post-merge hook preserved the unavailable relationship instead of treating it as absent."],
    );
  }

  const candidates = new Map();
  if (Array.isArray(graphNodes)) {
    for (const node of graphNodes) {
      const candidate = parseCandidate(node);
      if (candidate !== null) {
        const existing = candidates.get(candidate.key) ?? {
          ...candidate,
          graph: false,
          body: false,
        };
        existing.graph = true;
        if (candidate.url !== null) {
          existing.url = candidate.url;
        }
        candidates.set(candidate.key, existing);
      } else {
        addDeviation(
          deviations,
          "issue-relationship-incomplete",
          "The live closing-issue relationship contains an incomplete issue identity.",
          "Expected issue closure cannot be attributed deterministically.",
          ["GitHub returned a closing-issue node without a complete repository and number."],
        );
      }
    }
  }

  for (const reference of bodyReferences) {
    const [candidateRepository, candidateNumber] = reference.split("#");
    const key = `${candidateRepository}#${candidateNumber}`;
    const existing = candidates.get(key) ?? {
      repository: candidateRepository,
      number: Number(candidateNumber),
      url: null,
      graph: false,
      body: false,
    };
    existing.body = true;
    candidates.set(key, existing);
  }

  if (candidates.size === 0) {
    if (graphNodes === null) {
      closure.expected = null;
      closure.observed = "unknown";
      closure.attribution = "unavailable";
      closure.relationship_evidence.status = "unavailable";
      closure.evidence.push(
        "No issue closure conclusion was made because the live relationship was unavailable.",
      );
    } else {
      closure.expected = false;
      closure.observed = "not-applicable";
      closure.attribution = "not-applicable";
      closure.relationship_evidence.status = "absent";
      closure.evidence.push(
        "No explicit close-on-merge issue relationship was observed.",
      );
    }
    return closure;
  }

  if (candidates.size !== 1) {
    closure.relationship_evidence.status = "conflicting";
    closure.relationship_evidence.keyword_evidence = bodyReferences.map(
      (reference) => `Pull-request body contains close-on-merge reference ${reference}.`,
    );
    closure.relationship_evidence.github_evidence = Array.isArray(graphNodes)
      ? graphNodes.map(() => "GitHub returned more than one closing-issue candidate.")
      : [];
    addDeviation(
      deviations,
      "issue-link-ambiguous",
      "More than one linked issue candidate was observed after the merge.",
      "Expected issue closure and any manual issue action cannot be selected safely.",
      ["The closing-issue relationship is not unique."],
    );
    return closure;
  }

  const candidate = [...candidates.values()][0];
  closure.relationship_evidence.status = candidate.graph
    ? "confirmed"
    : "keyword-only";
  closure.relationship_evidence.keyword_evidence = candidate.body
    ? [`Pull-request body contains close-on-merge reference ${candidate.key}.`]
    : [];
  closure.relationship_evidence.github_evidence = candidate.graph
    ? [`GitHub closingIssuesReferences contains ${candidate.key}.`]
    : [];

  const targetIsDefault =
    isSafeBranchName(defaultBranch) &&
    livePullRequest.baseRefName === defaultBranch;
  closure.expected =
    defaultBranch === null ? null : targetIsDefault;

  const issue = readIssue(
    workingDirectory,
    candidate.repository,
    candidate.number,
    tracker,
  );
  if (issue === null) {
    closure.observed = "unknown";
    closure.attribution = "unavailable";
    closure.issue = {
      repository: candidate.repository,
      number: candidate.number,
      url: candidate.url,
      title: null,
      state: "unknown",
      closed_at: null,
    };
    closure.evidence.push("The exact linked issue could not be loaded.");
    addDeviation(
      deviations,
      "issue-state-unavailable",
      "The uniquely linked issue state could not be verified.",
      "Expected issue closure remains unresolved.",
      [`The issue target is ${candidate.key}.`],
    );
    return closure;
  }

  const issueState = String(issue.state ?? "").toLowerCase();
  const normalizedState =
    issueState === "closed"
      ? "closed"
      : issueState === "open"
        ? "open"
        : "unknown";
  const closedAt = isIsoTimestamp(issue.closed_at) ? issue.closed_at : null;
  closure.issue = {
    repository: candidate.repository,
    number: candidate.number,
    url: isHttpUrl(issue.html_url) ? issue.html_url : candidate.url,
    title: null,
    state: normalizedState,
    closed_at: closedAt,
  };
  closure.observed = targetIsDefault ? normalizedState : normalizedState;

  if (closure.expected !== true) {
    closure.attribution = "not-applicable";
    closure.evidence.push(
      defaultBranch === null
        ? "The repository default branch could not be verified."
        : `The merge target ${safeLabel(livePullRequest.baseRefName)} is not the verified default branch ${safeLabel(defaultBranch)}.`,
    );
    if (closure.expected === null) {
      closure.attribution = "unavailable";
      addDeviation(
        deviations,
        "default-branch-unavailable",
        "The expected close-on-merge target branch could not be verified.",
        "Issue closure expectation remains unresolved.",
        ["The repository default branch evidence is unavailable."],
      );
    }
    return closure;
  }

  if (normalizedState === "open") {
    closure.attribution = "unavailable";
    closure.evidence.push(
      `GitHub reports linked issue ${candidate.key} as open after the verified merge.`,
    );
    addDeviation(
      deviations,
      "issue-not-closed",
      "The uniquely linked issue remains open although close-on-merge was expected.",
      "The merge workflow is complete, but issue closure requires a separate decision.",
      [`GitHub reports ${candidate.key} as open.`],
    );
    addOpenAction(
      openActions,
      "close-linked-issue",
      "Run close-linked-issue only after exact separate user or repository-policy authorization",
      candidate.key,
      "Automatic closure was expected but is not observed.",
    );
    return closure;
  }

  if (normalizedState !== "closed") {
    closure.attribution = "unavailable";
    addDeviation(
      deviations,
      "issue-state-unknown",
      "The linked issue has an unknown state.",
      "Expected issue closure cannot be confirmed.",
      [`GitHub returned an unrecognized state for ${candidate.key}.`],
    );
    return closure;
  }

  const timeline = readIssueTimeline(
    workingDirectory,
    candidate.repository,
    candidate.number,
    tracker,
  );
  const directAttribution = hasDirectMergeAttribution(
    timeline,
    livePullRequest,
    extractMergeCommit(livePullRequest.mergeCommit),
  );
  const mergedAt = isIsoTimestamp(livePullRequest.mergedAt)
    ? livePullRequest.mergedAt
    : null;
  const temporalConsistency =
    mergedAt !== null && closedAt !== null
      ? Date.parse(closedAt) >= Date.parse(mergedAt)
      : null;

  if (temporalConsistency === false) {
    closure.attribution = "unsupported";
    addDeviation(
      deviations,
      "issue-closed-before-merge",
      "The linked issue was already closed before the observed merge time.",
      "The merge cannot be treated as the cause of issue closure.",
      [`Issue closed at ${closedAt}; pull request merged at ${mergedAt}.`],
    );
  } else if (directAttribution) {
    closure.attribution = "verified";
  } else if (temporalConsistency === true && candidate.graph) {
    closure.attribution = "supported";
  } else {
    closure.attribution = "unsupported";
    addDeviation(
      deviations,
      "issue-closure-attribution-incomplete",
      "The linked issue is closed, but direct attribution to this merge is unavailable.",
      "Closure is observed but its causal relationship remains incomplete.",
      [`The linked issue is ${candidate.key}.`],
    );
  }
  closure.evidence.push(
    `GitHub reports linked issue ${candidate.key} as closed.`,
  );
  if (temporalConsistency === true) {
    closure.evidence.push("Issue closure occurred at or after the merge time.");
  }
  if (directAttribution) {
    closure.evidence.push("The issue timeline contains evidence tied to this pull request or merge commit.");
  }
  return closure;
}

function readPreMergeGate(
  repositoryRoot,
  repository,
  pullRequest,
  livePullRequest,
  tracker,
  deviations,
) {
  const gatePath = resolve(repositoryRoot, ...GATE_RELATIVE_PATH.split("/"));
  if (!existsSync(gatePath)) {
    tracker.record("pre-merge-gate", "unavailable", [
      `No local ${GATE_RELATIVE_PATH} snapshot was available.`,
    ]);
    addDeviation(
      deviations,
      "pre-merge-gate-unavailable",
      "The local pre-merge gate was not available after the merge.",
      "The hook cannot determine whether branch deletion was requested by the approved merge operation.",
      ["The gate is optional for post-merge observation and was not written to the worktree."],
    );
    return { present: false, matches: false, deleteBranch: null };
  }

  try {
    const stats = statSync(gatePath);
    if (!stats.isFile() || stats.size > MAX_GATE_BYTES) {
      throw new Error("invalid gate");
    }
    const gate = JSON.parse(readFileSync(gatePath, "utf8"));
    const gatePullRequest = gate?.pull_request;
    const matches =
      isRecord(gatePullRequest) &&
      normalizeRepository(gatePullRequest.repository) ===
        normalizeRepository(repository) &&
      gatePullRequest.number === pullRequest.number &&
      isHttpUrl(gatePullRequest.url) &&
      normalizeUrl(gatePullRequest.url) === normalizeUrl(pullRequest.url);
    const expectedHead =
      isSha(gate.expected_head_sha) &&
      isSha(livePullRequest.headRefOid) &&
      gate.expected_head_sha.toLowerCase() ===
        livePullRequest.headRefOid.toLowerCase();
    const expectedBase =
      isSha(gate.expected_base_sha) &&
      isSha(livePullRequest.baseRefOid) &&
      gate.expected_base_sha.toLowerCase() ===
        livePullRequest.baseRefOid.toLowerCase();
    const completeMergeEffect = typeof gate?.merge?.delete_branch === "boolean";
    const identityMatches =
      matches && expectedHead && expectedBase && completeMergeEffect;
    const deleteBranch =
      typeof gate?.merge?.delete_branch === "boolean"
        ? gate.merge.delete_branch
        : null;
    tracker.record(
      "pre-merge-gate",
      "loaded",
      identityMatches
        ? ["The local PreMergeGate matches the observed pull request and revisions."]
        : ["A local PreMergeGate was found but does not match the observed pull request or revisions."],
    );
    if (!identityMatches) {
      addDeviation(
        deviations,
        "pre-merge-gate-stale",
        "The local pre-merge gate does not match the observed post-merge identity.",
        "Approval and branch-deletion expectations cannot be attributed to this merge.",
        ["The gate was preserved as evidence but not used as an authorization source."],
      );
    }
    return {
      present: true,
      matches: identityMatches,
      deleteBranch: identityMatches ? deleteBranch : null,
    };
  } catch {
    tracker.record("pre-merge-gate", "unavailable", [
      `The local ${GATE_RELATIVE_PATH} snapshot was invalid or unreadable.`,
    ]);
    addDeviation(
      deviations,
      "pre-merge-gate-invalid",
      "The local pre-merge gate could not be parsed.",
      "Approval and branch-deletion expectations cannot be attributed to this merge.",
      ["The post-merge hook did not repair or rewrite the gate."],
    );
    return { present: true, matches: false, deleteBranch: null };
  }
}

function parseWorktreeList(output) {
  const records = [];
  let current = null;
  for (const line of String(output ?? "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current !== null) {
        records.push(current);
      }
      current = {
        path: line.slice("worktree ".length),
        branch: null,
        head: null,
      };
      continue;
    }
    if (current === null) {
      continue;
    }
    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    }
  }
  if (current !== null) {
    records.push(current);
  }
  return records;
}

function readWorktrees(repositoryRoot, tracker) {
  const result = runGit(
    repositoryRoot,
    ["worktree", "list", "--porcelain"],
    "The local worktree inventory",
  );
  if (!result.ok) {
    tracker.record("worktrees", "unavailable", [
      "The local worktree inventory could not be read.",
    ]);
    return null;
  }
  const records = parseWorktreeList(result.stdout);
  tracker.record(
    "worktrees",
    records.length > 0 ? "loaded" : "empty",
    records.length > 0
      ? ["The local worktree inventory was read successfully."]
      : ["Git reported no registered worktrees."],
  );
  return records;
}

function readWorktreeStatus(repositoryRoot, worktreePath) {
  if (!isAbsolute(worktreePath) || !existsSync(worktreePath)) {
    return { state: "unknown", evidence: ["The worktree path is unavailable."] };
  }
  const result = runGit(
    repositoryRoot,
    ["-C", worktreePath, "status", "--porcelain=v1", "--untracked-files=all"],
    "The worktree cleanliness check",
  );
  if (!result.ok) {
    return {
      state: "unknown",
      evidence: ["The worktree cleanliness could not be read."],
    };
  }
  if (result.stdout.length === 0) {
    return {
      state: "clean",
      evidence: ["The registered worktree has no reported changes."],
    };
  }
  return {
    state: "dirty",
    evidence: ["The registered worktree contains uncommitted or untracked changes."],
  };
}

function encodePathSegment(value) {
  return encodeURIComponent(value);
}

function readRemoteBranch(
  workingDirectory,
  repository,
  branch,
  tracker,
) {
  if (!isSafeBranchName(branch)) {
    tracker.record("remote-branch", "unavailable", [
      "The remote head branch name is not safe to inspect.",
    ]);
    return { state: "unknown", evidence: ["The remote branch identity is unavailable."] };
  }

  const result = runGh(
    workingDirectory,
    [
      "api",
      `repos/${repository}/branches/${encodePathSegment(branch)}`,
    ],
    "The remote head-branch inventory",
  );
  if (result.ok) {
    tracker.record("remote-branch", "loaded", [
      `GitHub reports remote branch ${safeLabel(branch)} as present.`,
    ]);
    return {
      state: "available",
      evidence: [`GitHub reports remote branch ${safeLabel(branch)} is present.`],
    };
  }
  if (classifyCommandFailure(result) === "not_found") {
    tracker.record("remote-branch", "empty", [
      `GitHub reports remote branch ${safeLabel(branch)} as absent.`,
    ]);
    return {
      state: "already_absent",
      evidence: [`GitHub reports remote branch ${safeLabel(branch)} is absent.`],
    };
  }
  tracker.record("remote-branch", "unavailable", [
    "The remote head-branch inventory could not be read.",
  ]);
  return {
    state: "unknown",
    evidence: ["The remote branch state is unavailable."],
  };
}

function inventoryCleanup(
  repositoryRoot,
  repository,
  headBranch,
  workingDirectory,
  expectedDeletion,
  tracker,
  deviations,
  openActions,
) {
  const cleanup = emptyCleanup();
  const worktrees = readWorktrees(repositoryRoot, tracker);
  const branchIsSafe = isSafeBranchName(headBranch);
  const matchingWorktrees = Array.isArray(worktrees)
    ? worktrees.filter((worktree) => worktree.branch === headBranch)
    : [];

  let localAction;
  if (!branchIsSafe) {
    tracker.record("local-branch", "unavailable", [
      "The local head branch name is not safe to inspect.",
    ]);
    localAction = {
      target: "local_branch",
      identifier: headBranch ?? "unknown",
      state: "unknown",
      requires_separate_approval: true,
      suggested_skill: "delete-merged-branch",
      evidence: ["The local branch identity is unavailable."],
    };
  } else {
    const result = runGit(
      repositoryRoot,
      ["show-ref", "--verify", "--quiet", `refs/heads/${headBranch}`],
      "The local head-branch inventory",
    );
    if (result.ok) {
      const checkedOut =
        matchingWorktrees.length > 0 &&
        matchingWorktrees.some((worktree) => isAbsolute(worktree.path));
      localAction = {
        target: "local_branch",
        identifier: headBranch,
        state: checkedOut ? "unsafe" : "available",
        requires_separate_approval: true,
        suggested_skill: "delete-merged-branch",
        evidence: checkedOut
          ? ["The local branch is still checked out by a registered worktree."]
          : ["The local branch exists and is not listed as checked out by a worktree."],
      };
      tracker.record("local-branch", "loaded", localAction.evidence);
    } else {
      tracker.record("local-branch", "empty", [
        `The local branch ${safeLabel(headBranch)} is absent.`,
      ]);
      localAction = {
        target: "local_branch",
        identifier: headBranch,
        state: "already_absent",
        requires_separate_approval: true,
        suggested_skill: "delete-merged-branch",
        evidence: [`The local branch ${safeLabel(headBranch)} is absent.`],
      };
    }
  }
  cleanup.available_actions.push(localAction);

  const remoteAction = readRemoteBranch(
    workingDirectory,
    repository,
    headBranch,
    tracker,
  );
  cleanup.available_actions.push({
    target: "remote_branch",
    identifier: `${repository}:${headBranch}`,
    state: remoteAction.state,
    requires_separate_approval: true,
    suggested_skill: "delete-merged-branch",
    evidence: remoteAction.evidence,
  });

  if (
    remoteAction.state === "already_absent" &&
    expectedDeletion === false
  ) {
    addDeviation(
      deviations,
      "remote-branch-absence-unexpected",
      "The remote head branch is absent although the matching pre-merge gate did not request branch deletion.",
      "The hook cannot distinguish a prior deletion from an unapproved deletion without a pre-merge branch snapshot.",
      [`The observed remote branch is ${safeLabel(headBranch)}.`],
    );
  }

  if (worktrees === null) {
    cleanup.available_actions.push({
      target: "worktree",
      identifier: headBranch ?? "unknown",
      state: "unknown",
      requires_separate_approval: true,
      suggested_skill: "cleanup-worktree",
      evidence: ["The local worktree inventory is unavailable."],
    });
  } else if (matchingWorktrees.length === 0) {
    cleanup.available_actions.push({
      target: "worktree",
      identifier: headBranch ?? "unknown",
      state: "already_absent",
      requires_separate_approval: true,
      suggested_skill: "cleanup-worktree",
      evidence: ["No registered worktree currently checks out the merged head branch."],
    });
  } else {
    for (const worktree of matchingWorktrees) {
      const status = readWorktreeStatus(repositoryRoot, worktree.path);
      const state = status.state === "clean" ? "available" : "unsafe";
      cleanup.available_actions.push({
        target: "worktree",
        identifier: worktree.path,
        state,
        requires_separate_approval: true,
        suggested_skill: "cleanup-worktree",
        evidence: [
          `The merged head branch is registered at ${worktree.path}.`,
          ...status.evidence,
        ],
      });
    }
  }

  cleanup.evidence.push(
    "Cleanup availability was inspected read-only; no cleanup action was performed by this hook.",
  );
  cleanup.evidence.push(
    "Every listed cleanup action requires separate exact user or repository-policy authorization before its owning Skill may run.",
  );

  if (localAction.state === "available") {
    addOpenAction(
      openActions,
      "delete-local-branch",
      "Run delete-merged-branch for the local branch only after exact separate user or repository-policy authorization",
      localAction.identifier,
      "The local merged branch is present and not currently checked out.",
    );
  } else if (localAction.state === "unsafe") {
    addOpenAction(
      openActions,
      "inspect-local-branch",
      "Inspect the checked-out local branch and worktree before any deletion decision",
      localAction.identifier,
      "A checked-out branch cannot be safely deleted by the branch cleanup workflow.",
    );
  }

  if (remoteAction.state === "available") {
    addOpenAction(
      openActions,
      "delete-remote-branch",
      "Run delete-merged-branch for the remote branch only after exact separate user or repository-policy authorization",
      `${repository}:${headBranch}`,
      "The remote merged branch is present.",
    );
  }

  for (const action of cleanup.available_actions.filter(
    (item) => item.target === "worktree" && item.state !== "already_absent",
  )) {
    addOpenAction(
      openActions,
      "cleanup-worktree",
      "Run cleanup-worktree only after exact separate user or repository-policy authorization",
      action.identifier,
      action.state === "unsafe"
        ? "The worktree contains recoverable or otherwise unsafe state."
        : "The merged head branch still has a registered worktree.",
    );
  }

  return cleanup;
}

function yamlScalar(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(String(value));
}

function yamlLines(value, indentation = 0) {
  const padding = " ".repeat(indentation);
  if (value === null || typeof value !== "object") {
    return [`${padding}${yamlScalar(value)}`];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${padding}[]`];
    }
    const lines = [];
    for (const item of value) {
      if (item !== null && typeof item === "object") {
        lines.push(`${padding}-`);
        lines.push(...yamlLines(item, indentation + 2));
      } else {
        lines.push(`${padding}- ${yamlScalar(item)}`);
      }
    }
    return lines;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return [`${padding}{}`];
  }
  const lines = [];
  for (const [key, item] of entries) {
    if (item !== null && typeof item === "object") {
      const childLines = yamlLines(item, indentation + 2);
      if (
        childLines.length === 1 &&
        (childLines[0].trim() === "[]" || childLines[0].trim() === "{}")
      ) {
        lines.push(`${padding}${key}: ${childLines[0].trim()}`);
      } else {
        lines.push(`${padding}${key}:`);
        lines.push(...childLines);
      }
    } else {
      lines.push(`${padding}${key}: ${yamlScalar(item)}`);
    }
  }
  return lines;
}

function contextForStatus(status) {
  return yamlLines(status).join("\n");
}

function writeContext(input, status) {
  const additionalContext = contextForStatus(status);
  if (isCodexInput(input)) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext,
        },
      }) + "\n",
    );
    return;
  }
  process.stdout.write(JSON.stringify({ additional_context: additionalContext }) + "\n");
}

function writeEmptyContext(input) {
  if (isCodexInput(input)) {
    process.stdout.write("{}\n");
    return;
  }
  process.stdout.write("{}\n");
}

function evaluate(input) {
  const tracker = createEvidenceTracker();
  if (!isRecord(input)) {
    return emptyStatus(tracker, {
      failure: makeFailure(
        "invalid_input",
        "The post-merge hook input is not a JSON object.",
      ),
      rationale: "Post-merge verification was blocked because hook input was invalid.",
    });
  }

  const command = getInputValue(input, "command");
  const inputDirectory = getInputValue(input, "cwd");
  const initialDirectory =
    inputDirectory === null ? process.cwd() : resolve(inputDirectory);
  const identified = identifyMergeInvocations(command, initialDirectory);

  if (identified.invocations.length === 0) {
    if (!identified.parseable && likelyMergeCommand(command ?? "")) {
      return emptyStatus(tracker, {
        failure: makeFailure(
          "invalid_input",
          identified.reason ?? "The merge command could not be identified safely.",
        ),
        rationale: "A likely merge command was not parseable, so no GitHub target was selected.",
      });
    }
    writeEmptyContext(input);
    return null;
  }

  const deviations = [];
  const openActions = [];
  if (identified.reason !== null) {
    addDeviation(
      deviations,
      "command-shape",
      "The observed shell command contained additional or unsupported segments.",
      "The post-merge result is diagnostic only and may not represent a single isolated merge invocation.",
      ["The hook continued with the uniquely identified merge target."],
    );
  }
  if (inputDirectory === null) {
    addDeviation(
      deviations,
      "working-directory-unavailable",
      "The hook input did not identify a shell working directory.",
      "The hook used its process working directory as a fallback and records this limitation.",
      ["The host did not provide cwd in the post-tool event."],
    );
  }
  if (identified.invocations.length !== 1) {
    return emptyStatus(tracker, {
      status: "blocked",
      deviations: [
        ...deviations,
        {
          id: "multiple-merges",
          description: "The shell command contains more than one pull-request merge invocation.",
          impact: "The hook cannot safely select one post-merge target.",
          evidence: ["Exactly one merge invocation is required."],
        },
      ],
      rationale: "Post-merge verification was blocked because the target was ambiguous.",
      failure: makeFailure(
        "invalid_input",
        "The shell command contains more than one pull-request merge invocation.",
      ),
    });
  }

  const invocation = identified.invocations[0];
  const spec = parseInvocation(invocation);
  if (
    spec.repository === null ||
    !Number.isInteger(spec.number) ||
    spec.number < 1
  ) {
    return emptyStatus(tracker, {
      deviations,
      rationale: "Post-merge verification was blocked because the exact target identity was unavailable.",
      failure: makeFailure(
        "invalid_input",
        spec.parseError ?? "The merge command target identity is missing or malformed.",
      ),
    });
  }

  let repositoryRootResult = runGit(
    invocation.targetDirectory,
    ["rev-parse", "--show-toplevel"],
    "The Git repository root",
  );
  if (!repositoryRootResult.ok) {
    tracker.record("git-repository", "unavailable", [
      "The merge worktree is not a verifiable Git repository.",
    ]);
    return emptyStatus(tracker, {
      repository: spec.repository,
      number: spec.number,
      url: spec.url,
      deviations,
      rationale: "Post-merge verification was blocked because the repository identity was unavailable.",
      failure: makeFailure(
        "local_state_unavailable",
        "The merge worktree is not a verifiable Git repository.",
      ),
    });
  }
  const repositoryRoot = resolve(repositoryRootResult.stdout);
  tracker.record("git-repository", "loaded", [
    "The merge worktree repository root was verified.",
  ]);

  if (spec.parseError !== null) {
    addDeviation(
      deviations,
      "merge-command-parse",
      spec.parseError,
      "The merge was observed, but the executed command does not fully preserve a deterministic merge specification.",
      ["Live post-merge GitHub state remains the authoritative observation."],
    );
  }

  const livePullRequestResult = readLivePullRequest(
    invocation.targetDirectory,
    spec.repository,
    spec.number,
    tracker,
  );
  const livePullRequest = livePullRequestResult.value;
  if (
    !isRecord(livePullRequest) ||
    livePullRequest.number !== spec.number ||
    !isHttpUrl(livePullRequest.url)
  ) {
    const failureCode = classifyCommandFailure(livePullRequestResult.result);
    return emptyStatus(tracker, {
      repository: spec.repository,
      number: spec.number,
      url: spec.url,
      deviations,
      rationale: "Post-merge verification was blocked because the exact pull request could not be loaded.",
      failure: makeFailure(
        failureCode === "auth_unavailable"
          ? "auth_unavailable"
          : failureCode === "not_found"
            ? "pull_request_not_found"
            : "api_failure",
        "The exact pull-request status could not be verified.",
      ),
    });
  }

  const pullRequestState = normalizedPullRequestState(livePullRequest.state);
  const pullRequestUrl = livePullRequest.url;
  const baseBranch = isSafeBranchName(livePullRequest.baseRefName)
    ? livePullRequest.baseRefName
    : null;
  const headBranch = isSafeBranchName(livePullRequest.headRefName)
    ? livePullRequest.headRefName
    : null;
  const mergeCommitSha = extractMergeCommit(livePullRequest.mergeCommit);
  const mergedAt = isIsoTimestamp(livePullRequest.mergedAt)
    ? livePullRequest.mergedAt
    : null;
  const observedMerge =
    pullRequestState === "merged" && mergedAt !== null && mergeCommitSha !== null;

  const baseStatus = emptyStatus(tracker, {
    status: observedMerge ? "partial" : "blocked",
    repository: spec.repository,
    number: spec.number,
    url: pullRequestUrl,
    prState: pullRequestState,
    baseBranch,
    headBranch,
    deviations,
    rationale: observedMerge
      ? "The pull request merge was observed; post-merge evidence is being completed."
      : "The exact pull request was loaded, but a verified merge was not observed.",
    failure: observedMerge
      ? null
      : makeFailure(
          "merge_not_observed",
          "The pull request is not verifiably merged with a merge timestamp and commit.",
        ),
  });
  baseStatus.pull_request.url = pullRequestUrl;
  baseStatus.merge.observed = observedMerge;
  baseStatus.merge.merged_at = mergedAt;
  baseStatus.merge.merge_commit_sha = mergeCommitSha;
  baseStatus.merge.target_branch = baseBranch;
  baseStatus.merge.evidence.push(
    `Live pull-request state is ${pullRequestState}.`,
  );
  if (mergedAt !== null) {
    baseStatus.merge.evidence.push(`GitHub reports mergedAt ${mergedAt}.`);
  }
  if (mergeCommitSha !== null) {
    baseStatus.merge.evidence.push(
      `GitHub reports merge commit ${mergeCommitSha}.`,
    );
  } else {
    addDeviation(
      deviations,
      "merge-commit-unavailable",
      "The merged pull request does not expose a verifiable merge commit.",
      "The merge result cannot be fully verified.",
      ["The live mergeCommit field did not contain a full commit SHA."],
    );
  }

  if (!observedMerge) {
    baseStatus.deviations = deviations;
    baseStatus.evidence = {
      status: tracker.resultStatus(),
      sources: tracker.list(),
    };
    baseStatus.rationale =
      "The exact pull request was loaded, but the live state does not prove a completed merge.";
    return baseStatus;
  }

  const defaultBranch = readDefaultBranch(
    invocation.targetDirectory,
    spec.repository,
    tracker,
  );
  const containment = readMergeContainment(
    invocation.targetDirectory,
    spec.repository,
    baseBranch,
    mergeCommitSha,
    tracker,
  );
  baseStatus.merge.target_contains_merge_commit = containment;
  if (containment === "verified") {
    baseStatus.merge.evidence.push(
      `The target branch ${safeLabel(baseBranch)} contains the observed merge commit according to GitHub compare evidence.`,
    );
  } else {
    addDeviation(
      deviations,
      "merge-containment-unverified",
      "The target branch could not be proven to contain the observed merge commit.",
      "The merge commit is observed, but target-branch integration evidence is incomplete.",
      ["The read-only GitHub comparison did not return identical or ahead status."],
    );
  }

  const issueClosure = buildIssueClosure(
    invocation.targetDirectory,
    spec.repository,
    livePullRequest,
    defaultBranch,
    tracker,
    deviations,
    openActions,
  );
  baseStatus.issue_closure = issueClosure;

  const gate = readPreMergeGate(
    repositoryRoot,
    spec.repository,
    {
      number: spec.number,
      url: pullRequestUrl,
    },
    livePullRequest,
    tracker,
    deviations,
  );
  const expectedDeletion =
    gate.matches && typeof gate.deleteBranch === "boolean"
      ? gate.deleteBranch
      : spec.deleteBranch;
  if (spec.deleteBranch && !gate.matches) {
    addDeviation(
      deviations,
      "branch-deletion-approval-unavailable",
      "The observed merge command requested remote branch deletion without a matching PreMergeGate.",
      "The hook cannot verify the separate user or repository-policy authorization for that deletion effect after the command completed.",
      ["The hook did not perform or authorize branch deletion."],
    );
  }
  if (headBranch === null) {
    addDeviation(
      deviations,
      "head-branch-unavailable",
      "The merged pull request does not expose a safe head-branch name.",
      "Branch and worktree cleanup availability cannot be determined.",
      ["The live headRefName field was missing or unsafe."],
    );
  }
  baseStatus.cleanup =
    headBranch === null
      ? {
          ...emptyCleanup(),
          available_actions: [
            {
              target: "local_branch",
              identifier: "unknown",
              state: "unknown",
              requires_separate_approval: true,
              suggested_skill: "delete-merged-branch",
              evidence: ["The merged head branch is unavailable."],
            },
            {
              target: "remote_branch",
              identifier: `${spec.repository}:unknown`,
              state: "unknown",
              requires_separate_approval: true,
              suggested_skill: "delete-merged-branch",
              evidence: ["The merged head branch is unavailable."],
            },
            {
              target: "worktree",
              identifier: "unknown",
              state: "unknown",
              requires_separate_approval: true,
              suggested_skill: "cleanup-worktree",
              evidence: ["The merged head branch is unavailable."],
            },
          ],
          evidence: [
            "Cleanup availability could not be inspected without a verified head branch.",
          ],
        }
      : inventoryCleanup(
          repositoryRoot,
          spec.repository,
          headBranch,
          invocation.targetDirectory,
          expectedDeletion,
          tracker,
          deviations,
          openActions,
        );

  const hasAttentionDeviation = deviations.some((deviation) =>
    [
      "issue-not-closed",
      "issue-link-ambiguous",
      "issue-closure-attribution-incomplete",
      "issue-closed-before-merge",
      "remote-branch-absence-unexpected",
      "branch-deletion-approval-unavailable",
    ].includes(deviation.id),
  );
  const hasPartialEvidence =
    containment !== "verified" ||
    tracker.resultStatus() !== "complete" ||
    deviations.some((deviation) =>
      [
        "merge-commit-unavailable",
        "head-branch-unavailable",
        "pre-merge-gate-unavailable",
        "pre-merge-gate-stale",
        "pre-merge-gate-invalid",
        "issue-state-unavailable",
        "issue-state-unknown",
        "issue-relationship-unavailable",
        "default-branch-unavailable",
        "merge-containment-unverified",
        "command-shape",
        "merge-command-parse",
        "working-directory-unavailable",
      ].includes(deviation.id),
    ) ||
    baseStatus.cleanup.available_actions.some(
      (action) => action.state === "unknown",
    );

  let finalStatus = "verified";
  if (hasAttentionDeviation) {
    finalStatus = "needs-attention";
  } else if (hasPartialEvidence) {
    finalStatus = "partial";
  }
  baseStatus.status = finalStatus;
  baseStatus.deviations = deviations;
  baseStatus.open_actions = openActions;
  baseStatus.evidence = {
    status: tracker.resultStatus(),
    sources: tracker.list(),
  };
  baseStatus.rationale =
    finalStatus === "verified"
      ? "The merge, target integration, and expected issue-closure result were observed. Cleanup remains separate and unperformed."
      : finalStatus === "needs-attention"
        ? "The merge was observed, but a linked issue, relationship, or cleanup condition requires a separate decision."
        : "The merge was observed, but one or more required post-merge evidence sources remain incomplete.";
  baseStatus.checked_at = new Date().toISOString();
  baseStatus.failure = null;
  return baseStatus;
}

function main() {
  let input;
  try {
    input = readHookInput(0, MAX_INPUT_BYTES);
  } catch {
    const tracker = createEvidenceTracker();
    writeContext(
      {},
      emptyStatus(tracker, {
        failure: makeFailure(
          "invalid_input",
          "The post-merge hook input was missing, too large, or invalid JSON.",
        ),
        rationale: "Post-merge verification was blocked because hook input was invalid.",
      }),
    );
    process.exitCode = 0;
    return;
  }

  try {
    const result = evaluate(input);
    if (result !== null) {
      writeContext(input, result);
    }
  } catch (error) {
    const tracker = createEvidenceTracker();
    writeContext(
      input,
      emptyStatus(tracker, {
        failure: makeFailure(
          "api_failure",
          `The deterministic post-merge check failed safely with ${safeLabel(error?.name ?? "unknown-error")}.`,
        ),
        rationale: "Post-merge verification stopped without performing any mutation.",
      }),
    );
  }
  process.exitCode = 0;
}

main();
