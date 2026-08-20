import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";

import { readHookInput } from "./lib/read-hook-input.mjs";
import { runCommand as runBoundedCommand } from "./lib/run-command.mjs";

const GATE_RELATIVE_PATH = ".cursor/hooks/state/pre-merge.json";
const MAX_GATE_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const ALLOWED_AUTHORIZATION_SOURCES = new Set([
  "explicit_user",
  "repository_policy",
]);
const ALLOWED_MERGE_METHODS = new Set(["merge", "squash", "rebase"]);
const SAFE_BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

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
  return typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
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

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(value).replace(/\/+$/, "").toLowerCase();
  }
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
      "GitHub pull-request merge blocked by deterministic pre-merge checks. " +
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
    return runBoundedCommand(executable, args, {
      cwd: workingDirectory,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      operation,
    }).trim();
  } catch {
    throw new CommandError(operation);
  }
}

function runGit(workingDirectory, args) {
  return runCommand("git", args, workingDirectory, args[0] ?? "git");
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
    canonical: `repos/${match[1]}/${match[2]}/pulls/${match[3]}/merge`,
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

function readOptionValue(args, index, option, findings, label) {
  if (option.inlineValue !== null) {
    return { value: option.inlineValue, nextIndex: index };
  }
  const next = args[index + 1];
  if (!isNonEmptyString(next) || next.startsWith("-")) {
    addFinding(
      findings,
      `The ${label} option ${safeLabel(option.name)} has no explicit value.`,
      "provide one exact named value",
    );
    return { value: null, nextIndex: index };
  }
  return { value: next, nextIndex: index + 1 };
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

function identifyMergeInvocations(command, initialDirectory) {
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
        parseError = "The merge command working directory could not be resolved safely.";
      } else {
        currentDirectory = resolvedDirectory;
      }
      continue;
    }

    if (!isGhCommand(segment, firstIndex)) {
      if (mergeSeen) {
        unsafeCommandSegment = true;
      } else {
        unsafeCommandSegment = true;
      }
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
        parseError,
      });
      parseError = null;
      continue;
    }

    if (commandName === "api") {
      const args = segment.slice(firstIndex + 2);
      const endpoint = findMergeEndpoint(args);
      const method = identifyApiMethod(args);
      const isWrite = method !== null && !["GET", "HEAD"].includes(method);
      if (endpoint !== null && isWrite) {
        if (mergeSeen) {
          unsafeCommandSegment = true;
        }
        mergeSeen = true;
        invocations.push({
          kind: "api-merge",
          targetDirectory: currentDirectory,
          args,
          endpoint,
          parseError,
        });
        parseError = null;
        continue;
      }
    }

    unsafeCommandSegment = true;
  }

  if (invocations.length > 0 && unsafeCommandSegment) {
    parseError =
      parseError ??
      "The merge command contains another shell command or pipeline.";
    for (const invocation of invocations) {
      invocation.parseError = parseError;
    }
  }

  return { invocations, parseable: true, reason: null };
}

function parsePrMergeArguments(args, targetDirectory, findings) {
  const values = new Map();
  const booleanOptions = new Set([
    "--merge",
    "--squash",
    "--rebase",
    "--delete-branch",
    "--admin",
    "--auto",
    "--disable-auto",
    "--match-head-commit",
  ]);
  const valueOptions = new Set([
    "--repo",
    "--match-head-commit",
    "--subject",
    "--body",
    "--body-file",
  ]);
  const methodOptions = new Set(["--merge", "--squash", "--rebase"]);
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    const option = splitOption(token);
    if (methodOptions.has(option.name)) {
      if (option.inlineValue !== null) {
        addFinding(
          findings,
          `The merge method option ${safeLabel(option.name)} has an inline value.`,
          "use exactly one merge method flag without a value",
        );
      }
      if (values.has(option.name)) {
        addFinding(
          findings,
          `The merge method option ${safeLabel(option.name)} is specified more than once.`,
          "provide exactly one merge method flag",
        );
      }
      values.set(option.name, true);
      continue;
    }

    if (option.name === "--delete-branch") {
      const value =
        option.inlineValue === null
          ? true
          : option.inlineValue.toLowerCase() === "true"
            ? true
            : option.inlineValue.toLowerCase() === "false"
              ? false
              : null;
      if (value === null) {
        addFinding(
          findings,
          "The --delete-branch value is not a deterministic boolean.",
          "use --delete-branch or omit the option",
        );
      } else {
        values.set(option.name, value);
      }
      continue;
    }

    if (
      option.name === "--admin" ||
      option.name === "--auto" ||
      option.name === "--disable-auto"
    ) {
      addFinding(
        findings,
        `The merge command uses the prohibited ${safeLabel(option.name)} option.`,
        "run only the exact authorized pull-request merge",
      );
      if (option.inlineValue === null && booleanOptions.has(option.name)) {
        continue;
      }
    }

    if (!valueOptions.has(option.name)) {
      addFinding(
        findings,
        `The merge command uses unsupported option ${safeLabel(option.name)}.`,
        "use only the exact named options supported by the merge approval",
      );
      if (option.inlineValue === null && index + 1 < args.length) {
        index += 1;
      }
      continue;
    }

    const parsed = readOptionValue(
      args,
      index,
      option,
      findings,
      "pull-request merge",
    );
    if (option.inlineValue === null) {
      index = parsed.nextIndex;
    }
    if (parsed.value !== null) {
      if (values.has(option.name)) {
        addFinding(
          findings,
          `The merge command specifies ${safeLabel(option.name)} more than once.`,
          "provide exactly one value for each merge option",
        );
      }
      values.set(option.name, parsed.value);
    }
  }

  if (positionals.length !== 1) {
    addFinding(
      findings,
      "The pull-request merge command does not identify exactly one pull request.",
      "use one positive pull-request number or canonical pull-request URL",
    );
    return null;
  }

  const target = parsePullRequestTarget(positionals[0]);
  if (target === null) {
    addFinding(
      findings,
      "The pull-request merge target is not a positive number or canonical URL.",
      "use the exact approved pull-request target",
    );
    return null;
  }

  const repositoryValue = values.get("--repo") ?? target.repository;
  if (!validateRepositoryName(repositoryValue)) {
    addFinding(
      findings,
      "The pull-request merge command has no explicit verifiable repository.",
      "provide --repo owner/repository or a canonical pull-request URL",
    );
  }
  if (target.repository !== null && normalizeRepository(repositoryValue) !== normalizeRepository(target.repository)) {
    addFinding(
      findings,
      "The pull-request URL and --repo values identify different repositories.",
      "use one exact repository identity",
    );
  }

  const methodFlags = [...methodOptions].filter((option) => values.has(option));
  if (methodFlags.length !== 1) {
    addFinding(
      findings,
      "The pull-request merge command does not select exactly one merge method.",
      "use exactly one of --merge, --squash, or --rebase",
    );
  }

  let body = null;
  let bodyProvided = false;
  if (values.has("--body")) {
    body = values.get("--body");
    bodyProvided = true;
  }
  if (values.has("--body-file")) {
    if (bodyProvided) {
      addFinding(
        findings,
        "The merge command specifies both --body and --body-file.",
        "provide one exact commit message source",
      );
    } else {
      const bodyFile = values.get("--body-file");
      if (bodyFile === "-" || !isNonEmptyString(bodyFile)) {
        addFinding(
          findings,
          "The merge --body-file value is missing or reads from stdin.",
          "use a readable, explicit commit message file",
        );
      } else {
        const bodyPath = resolve(targetDirectory, bodyFile);
        try {
          const stats = statSync(bodyPath);
          if (!stats.isFile() || stats.size > MAX_INPUT_BYTES) {
            throw new Error("invalid body file");
          }
          body = readFileSync(bodyPath, "utf8");
          bodyProvided = true;
        } catch {
          addFinding(
            findings,
            "The merge --body-file is missing, unreadable, or too large.",
            "use the exact readable commit message file",
          );
        }
      }
    }
  }

  const method =
    methodFlags.length === 1
      ? methodFlags[0].slice(2).toLowerCase()
      : null;
  return {
    kind: "pr-merge",
    repository: repositoryValue,
    number: target.number,
    url: target.url,
    method,
    deleteBranch: values.get("--delete-branch") === true,
    matchHeadSha: values.get("--match-head-commit") ?? null,
    subject: values.get("--subject") ?? null,
    subjectProvided: values.has("--subject"),
    body,
    bodyProvided,
  };
}

function parseFieldValue(value, findings) {
  if (!isNonEmptyString(value)) {
    addFinding(
      findings,
      "The API merge field is empty or malformed.",
      "provide explicit key=value fields",
    );
    return null;
  }
  const separatorIndex = value.indexOf("=");
  if (separatorIndex <= 0) {
    addFinding(
      findings,
      "The API merge field does not use key=value syntax.",
      "provide explicit key=value fields",
    );
    return null;
  }
  return {
    key: value.slice(0, separatorIndex),
    value: value.slice(separatorIndex + 1),
  };
}

function readJsonInput(targetDirectory, inputPath, findings) {
  if (inputPath === "-" || !isNonEmptyString(inputPath)) {
    addFinding(
      findings,
      "The API merge input is missing or reads from stdin.",
      "use one readable, explicit JSON input file",
    );
    return null;
  }

  const path = resolve(targetDirectory, inputPath);
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > MAX_INPUT_BYTES) {
      throw new Error("invalid input file");
    }
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(value)) {
      throw new Error("input is not an object");
    }
    return value;
  } catch {
    addFinding(
      findings,
      "The API merge input file is missing, unreadable, too large, or invalid JSON.",
      "write one exact JSON merge payload and rerun the preflight",
    );
    return null;
  }
}

function parseApiMergeArguments(args, endpoint, targetDirectory, findings) {
  const fields = new Map();
  let method = null;
  let inputPath = null;
  let endpointSeen = false;
  let unsupported = false;
  const fieldOptions = new Set([
    "--field",
    "--raw-field",
    "--typed-field",
    "-f",
    "-F",
  ]);
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("-")) {
      positional.push(token);
      continue;
    }

    const option = splitOption(token);
    if (option.name === "--method" || option.name === "-x" || option.name === "-X") {
      const parsed = readOptionValue(args, index, option, findings, "API merge");
      if (option.inlineValue === null) {
        index = parsed.nextIndex;
      }
      if (parsed.value !== null) {
        if (method !== null) {
          addFinding(
            findings,
            "The API merge command specifies the HTTP method more than once.",
            "provide exactly one explicit PUT or POST method",
          );
        }
        method = parsed.value.toUpperCase();
      }
      continue;
    }

    if (option.name === "--input") {
      const parsed = readOptionValue(args, index, option, findings, "API merge");
      if (option.inlineValue === null) {
        index = parsed.nextIndex;
      }
      if (parsed.value !== null) {
        if (inputPath !== null) {
          addFinding(
            findings,
            "The API merge command specifies --input more than once.",
            "provide exactly one merge payload",
          );
        }
        inputPath = parsed.value;
      }
      continue;
    }

    if (fieldOptions.has(option.name)) {
      const parsed = readOptionValue(args, index, option, findings, "API merge");
      if (option.inlineValue === null) {
        index = parsed.nextIndex;
      }
      if (parsed.value !== null) {
        const field = parseFieldValue(parsed.value, findings);
        if (field !== null) {
          if (fields.has(field.key)) {
            addFinding(
              findings,
              `The API merge field ${safeLabel(field.key)} is specified more than once.`,
              "provide exactly one value for each merge field",
            );
          }
          fields.set(field.key, field.value);
        }
      }
      continue;
    }

    unsupported = true;
    addFinding(
      findings,
      `The API merge command uses unsupported option ${safeLabel(option.name)}.`,
      "use only the explicit method, payload, and merge fields",
    );
    if (option.inlineValue === null && index + 1 < args.length) {
      index += 1;
    }
  }

  for (const positionalValue of positional) {
    if (parseMergeEndpoint(positionalValue) !== null) {
      if (endpointSeen) {
        addFinding(
          findings,
          "The API merge command contains more than one merge endpoint.",
          "use exactly one pull-request merge endpoint",
        );
      }
      endpointSeen = true;
    } else {
      addFinding(
        findings,
        "The API merge command contains an unsupported positional argument.",
        "use the exact pull-request merge endpoint",
      );
    }
  }

  if (!endpointSeen || unsupported) {
    return null;
  }
  if (method === null || !["PUT", "POST"].includes(method)) {
    addFinding(
      findings,
      "The API merge command does not use an explicit supported write method.",
      "use --method PUT for the pull-request merge endpoint",
    );
  }
  if (inputPath !== null && fields.size > 0) {
    addFinding(
      findings,
      "The API merge command combines --input with inline fields.",
      "provide one exact merge payload source",
    );
  }

  let payload = Object.fromEntries(fields);
  if (inputPath !== null) {
    const input = readJsonInput(targetDirectory, inputPath, findings);
    if (input !== null) {
      payload = input;
    }
  }

  const allowedPayloadKeys = new Set([
    "sha",
    "merge_method",
    "commit_title",
    "commit_message",
  ]);
  for (const key of Object.keys(payload)) {
    if (!allowedPayloadKeys.has(key)) {
      addFinding(
        findings,
        `The API merge payload contains unsupported field ${safeLabel(key)}.`,
        "provide only sha, merge_method, commit_title, and commit_message",
      );
    }
  }

  return {
    kind: "api-merge",
    repository: endpoint.repository,
    number: endpoint.number,
    url: null,
    method:
      typeof payload.merge_method === "string"
        ? payload.merge_method.toLowerCase()
        : null,
    deleteBranch: false,
    matchHeadSha: typeof payload.sha === "string" ? payload.sha : null,
    subject:
      typeof payload.commit_title === "string"
        ? payload.commit_title
        : null,
    subjectProvided: typeof payload.commit_title === "string",
    body:
      typeof payload.commit_message === "string"
        ? payload.commit_message
        : null,
    bodyProvided: typeof payload.commit_message === "string",
    httpMethod: method,
  };
}

function readGate(repositoryRoot, findings) {
  const gatePath = resolve(repositoryRoot, ...GATE_RELATIVE_PATH.split("/"));
  try {
    const stats = statSync(gatePath);
    if (!stats.isFile() || stats.size > MAX_GATE_BYTES) {
      throw new Error("invalid gate");
    }
    return JSON.parse(readFileSync(gatePath, "utf8"));
  } catch {
    addFinding(
      findings,
      `The local PreMergeGate is missing, too large, unreadable, or invalid at ${GATE_RELATIVE_PATH}.`,
      "run merge-pull-request preflight and write a fresh PreMergeGate",
    );
    return null;
  }
}

function validateWorkspace(workspace, repositoryRoot, findings) {
  if (
    !isRecord(workspace) ||
    !validateRepositoryName(workspace.repository) ||
    !isNonEmptyString(workspace.path) ||
    !isAbsolute(workspace.path)
  ) {
    addFinding(
      findings,
      "PreMergeGate.workspace is missing or malformed.",
      "preserve the verified repository and absolute worktree path",
    );
    return;
  }
  if (normalizeAbsolutePath(workspace.path) !== normalizeAbsolutePath(repositoryRoot)) {
    addFinding(
      findings,
      "PreMergeGate.workspace.path does not match the live Git worktree.",
      "write a gate for the exact worktree that runs the merge command",
    );
  }
}

function validatePullRequest(pullRequest, findings) {
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
      "PreMergeGate.pull_request is missing or malformed.",
      "preserve one exact repository, pull request, base branch, and head branch",
    );
    return null;
  }
  return pullRequest;
}

function validatePreflight(preflight, gate, findings) {
  if (!isRecord(preflight)) {
    addFinding(
      findings,
      "PreMergeGate.preflight is missing or malformed.",
      "write a fresh version-3 gate with the final live merge preflight",
    );
    return null;
  }

  if (!isIsoTimestamp(preflight.checked_at)) {
    addFinding(
      findings,
      "PreMergeGate.preflight.checked_at is missing or malformed.",
      "record the timestamp of the final live merge preflight",
    );
  }
  if (
    !validateRepositoryName(preflight.repository) ||
    normalizeRepository(preflight.repository) !==
      normalizeRepository(gate.pull_request.repository)
  ) {
    addFinding(
      findings,
      "PreMergeGate.preflight.repository does not match the approved repository.",
      "preserve the exact live repository identity in the final preflight",
    );
  }
  if (
    preflight.pull_request_number !== gate.pull_request.number ||
    !Number.isInteger(preflight.pull_request_number) ||
    preflight.pull_request_number < 1
  ) {
    addFinding(
      findings,
      "PreMergeGate.preflight.pull_request_number does not match the approved PR.",
      "preserve the exact live pull-request number in the final preflight",
    );
  }
  if (
    !isHttpUrl(preflight.pull_request_url) ||
    normalizeUrl(preflight.pull_request_url) !==
      normalizeUrl(gate.pull_request.url)
  ) {
    addFinding(
      findings,
      "PreMergeGate.preflight.pull_request_url does not match the approved PR.",
      "preserve the exact live pull-request URL in the final preflight",
    );
  }
  if (
    !isSafeBranchName(preflight.head_branch) ||
    preflight.head_branch !== gate.pull_request.head_branch
  ) {
    addFinding(
      findings,
      "PreMergeGate.preflight.head_branch does not match the approved head branch.",
      "preserve the exact live head branch in the final preflight",
    );
  }
  if (
    !isSha(preflight.live_head_sha) ||
    preflight.live_head_sha.toLowerCase() !== gate.expected_head_sha.toLowerCase()
  ) {
    addFinding(
      findings,
      "PreMergeGate.preflight.live_head_sha does not match the expected head.",
      "refresh the final preflight for the exact pull-request head",
    );
  }
  if (
    !isSha(preflight.live_base_sha) ||
    preflight.live_base_sha.toLowerCase() !== gate.expected_base_sha.toLowerCase()
  ) {
    addFinding(
      findings,
      "PreMergeGate.preflight.live_base_sha does not match the expected base.",
      "refresh the final preflight for the exact base revision",
    );
  }
  if (
    !isSafeBranchName(preflight.base_branch) ||
    preflight.base_branch !== gate.pull_request.base_branch
  ) {
    addFinding(
      findings,
      "PreMergeGate.preflight.base_branch does not match the approved base branch.",
      "preserve the exact live base branch in the final preflight",
    );
  }

  const requiredPassFields = [
    "target_match",
    "open_state",
    "non_draft",
    "head_sha_match",
    "base_branch_match",
    "base_sha_match",
    "mergeability",
    "reviews_current",
    "checks_current",
    "method_allowed",
    "authorization_match",
  ];
  for (const field of requiredPassFields) {
    if (preflight[field] !== "pass") {
      addFinding(
        findings,
        `PreMergeGate.preflight.${field} is not pass.`,
        "repeat the final live preflight and stop when any merge identity or policy state is changed or unavailable",
      );
    }
  }

  if (
    !Array.isArray(preflight.evidence) ||
    preflight.evidence.length === 0 ||
    !preflight.evidence.every((entry) => isNonEmptyString(entry))
  ) {
    addFinding(
      findings,
      "PreMergeGate.preflight.evidence is missing or incomplete.",
      "preserve source and provenance evidence for the final live preflight",
    );
  }

  return preflight;
}

function validateReadiness(readiness, gate, findings) {
  if (!isRecord(readiness)) {
    addFinding(
      findings,
      "PreMergeGate.readiness is missing or malformed.",
      "capture one complete current version-3 MergeReadiness result with its readiness snapshot",
    );
    return null;
  }

  if (readiness.schema !== "MergeReadiness" || readiness.version !== 3) {
    addFinding(
      findings,
      "PreMergeGate.readiness is not a version-3 MergeReadiness handoff.",
      "assess the exact pull request and write a fresh version-3 result",
    );
  }
  if (readiness.status !== "ready") {
    addFinding(
      findings,
      "PreMergeGate.readiness.status is not ready.",
      "refresh merge readiness and resolve every reported blocker",
    );
  }
  if (
    !validateRepositoryName(readiness.repository) ||
    normalizeRepository(readiness.repository) !==
      normalizeRepository(gate.repository)
  ) {
    addFinding(
      findings,
      "PreMergeGate.readiness.repository does not match the merge target.",
      "use readiness for the exact repository",
    );
  }
  if (
    !isRecord(readiness.pull_request) ||
    readiness.pull_request.number !== gate.pull_request.number ||
    !isHttpUrl(readiness.pull_request.url) ||
    normalizeUrl(readiness.pull_request.url) !==
      normalizeUrl(gate.pull_request.url)
  ) {
    addFinding(
      findings,
      "PreMergeGate.readiness.pull_request does not match the approved pull request.",
      "refresh readiness for the exact pull-request identity",
    );
  }
  if (!isSha(readiness.head_sha) || readiness.head_sha.toLowerCase() !== gate.expected_head_sha.toLowerCase()) {
    addFinding(
      findings,
      "PreMergeGate.readiness.head_sha does not match the approved head SHA.",
      "assess the current pull-request head and write a fresh gate",
    );
  }
  if (
    readiness.base_branch !== gate.pull_request.base_branch ||
    !isSafeBranchName(readiness.base_branch)
  ) {
    addFinding(
      findings,
      "PreMergeGate.readiness.base_branch does not match the approved base branch.",
      "refresh readiness for the exact base branch",
    );
  }
  if (readiness.mergeability !== "mergeable") {
    addFinding(
      findings,
      "PreMergeGate.readiness.mergeability is not mergeable.",
      "resolve the current merge conflict or unknown mergeability state",
    );
  }
  if (!Array.isArray(readiness.blockers)) {
    addFinding(
      findings,
      "PreMergeGate.readiness.blockers is missing.",
      "write a complete readiness result with blocker evidence",
    );
  } else if (readiness.blockers.length > 0) {
    addFinding(
      findings,
      "PreMergeGate.readiness contains unresolved merge blockers.",
      "resolve the reported blockers and reassess readiness",
    );
  }
  if (Array.isArray(readiness.remaining_conditions) && readiness.remaining_conditions.length > 0) {
    addFinding(
      findings,
      "PreMergeGate.readiness contains remaining conditions.",
      "satisfy every remaining merge condition before writing the gate",
    );
  }
  if (Array.isArray(readiness.uncertainties) && readiness.uncertainties.length > 0) {
    addFinding(
      findings,
      "PreMergeGate.readiness contains unresolved uncertainties.",
      "resolve unavailable or ambiguous merge evidence before merging",
    );
  }

  if (!Array.isArray(readiness.checks)) {
    addFinding(
      findings,
      "PreMergeGate.readiness.checks is missing.",
      "capture the complete required-check assessment",
    );
  } else {
    for (const check of readiness.checks) {
      if (!isRecord(check) || !isNonEmptyString(check.name)) {
        addFinding(
          findings,
          "A readiness check is missing its exact name.",
          "preserve exact required-check identity",
        );
        continue;
      }
      if (check.required !== true && check.required !== false) {
        addFinding(
          findings,
          `Readiness check ${safeLabel(check.name)} has unknown requirement status.`,
          "retrieve branch-protection or ruleset evidence for the check",
        );
      }
      if (check.required === true && check.result !== "pass") {
        addFinding(
          findings,
          `Required check ${safeLabel(check.name)} is not recorded as pass.`,
          "run or await the required check and reassess readiness",
        );
      }
      if (check.required === true && !isNonEmptyString(check.evidence)) {
        addFinding(
          findings,
          `Required check ${safeLabel(check.name)} has no evidence.`,
          "preserve the exact required-check result and source",
        );
      }
      if (
        check.required === true &&
        check.head_sha !== null &&
        check.head_sha !== undefined &&
        (!isSha(check.head_sha) ||
          check.head_sha.toLowerCase() !== gate.expected_head_sha.toLowerCase())
      ) {
        addFinding(
          findings,
          `Required check ${safeLabel(check.name)} is tied to a different head SHA.`,
          "refresh all required checks for the current pull-request head",
        );
      }
    }
  }

  const reviewState = readiness.review_state;
  if (
    !isRecord(reviewState) ||
    !Number.isInteger(reviewState.approval_count) ||
    reviewState.approval_count < 0 ||
    !Number.isInteger(reviewState.change_request_count) ||
    reviewState.change_request_count < 0 ||
    reviewState.evidence_status !== "known" ||
    reviewState.approval_inspection_status !== "inspected" ||
    !Number.isInteger(reviewState.required_approvals) ||
    reviewState.required_approvals < 0 ||
    reviewState.required_approvals_met !== true ||
    !Number.isInteger(reviewState.unresolved_threads) ||
    reviewState.unresolved_threads < 0 ||
    !Number.isInteger(reviewState.outdated_threads) ||
    reviewState.outdated_threads < 0
  ) {
    addFinding(
      findings,
      "PreMergeGate.readiness.review_state is incomplete or unavailable.",
      "refresh reviews, blocking threads, approval policy, and current approvals",
    );
  } else {
    if (reviewState.change_request_count !== 0) {
      addFinding(
        findings,
        "PreMergeGate.readiness records an active change request.",
        "resolve the current change request and reassess readiness",
      );
    }
    if (!Array.isArray(reviewState.approval_policy_evidence) || reviewState.approval_policy_evidence.length === 0) {
      addFinding(
        findings,
        "PreMergeGate.readiness has no explicit approval-policy evidence.",
        "retrieve current branch-protection or ruleset approval requirements",
      );
    }
  }

  const issueCoverage = readiness.issue_coverage;
  if (!isRecord(issueCoverage) || !Array.isArray(issueCoverage.evidence) || issueCoverage.evidence.length === 0) {
    addFinding(
      findings,
      "PreMergeGate.readiness.issue_coverage is missing, malformed, or has no evidence.",
      "refresh issue-coverage evidence before merging",
    );
  } else if (issueCoverage.status === "covered") {
    if (
      !isRecord(issueCoverage.issue) ||
      !validateRepositoryName(issueCoverage.issue.repository) ||
      normalizeRepository(issueCoverage.issue.repository) !==
        normalizeRepository(gate.repository) ||
      !Number.isInteger(issueCoverage.issue.number) ||
      issueCoverage.issue.number < 1 ||
      !isHttpUrl(issueCoverage.issue.url)
    ) {
      addFinding(
        findings,
        "PreMergeGate.readiness.issue_coverage does not prove exactly one current linked issue.",
        "resolve exactly one live issue relationship before merging",
      );
    }
  } else if (issueCoverage.status === "waived") {
    const waiver = issueCoverage.waiver;
    const issueMaybe = issueCoverage.issue;
    if (
      issueMaybe !== null &&
      issueMaybe !== undefined &&
      isRecord(issueMaybe)
    ) {
      addFinding(
        findings,
        "PreMergeGate.readiness.issue_coverage.waived must not include a linked issue object.",
        "remove the linked-issue object from this readiness result when using the waiver path",
      );
    }

    if (
      !isRecord(waiver) ||
      !isNonEmptyString(waiver.reason) ||
      !ALLOWED_AUTHORIZATION_SOURCES.has(waiver.source) ||
      !isNonEmptyString(waiver.evidence)
    ) {
      addFinding(
        findings,
        "PreMergeGate.readiness.issue_coverage.waived does not include complete waiver evidence.",
        "record the exact unique-link waiver reason, source, and evidence before merging",
      );
    }
  } else {
    addFinding(
      findings,
      "PreMergeGate.readiness.issue_coverage.status is not a supported value.",
      "assess issue coverage as either 'covered' or 'waived' before merging",
    );
  }

  const evidence = readiness.evidence;
  if (
    !isRecord(evidence) ||
    evidence.status !== "complete" ||
    !isSha(evidence.head_sha) ||
    evidence.head_sha.toLowerCase() !== gate.expected_head_sha.toLowerCase() ||
    !Array.isArray(evidence.sources) ||
    evidence.sources.length === 0
  ) {
    addFinding(
      findings,
      "PreMergeGate.readiness.evidence is incomplete or stale.",
      "refresh all merge-readiness evidence for the approved head SHA",
    );
  } else {
    for (const source of evidence.sources) {
      if (
        !isRecord(source) ||
        !isNonEmptyString(source.name) ||
        !["loaded", "empty"].includes(source.status) ||
        !Array.isArray(source.evidence)
      ) {
        addFinding(
          findings,
          "PreMergeGate.readiness contains partial or unavailable evidence.",
          "reload every merge-readiness source before merging",
        );
        break;
      }
    }
  }

  const snapshot = readiness.readiness_evidence;
  const snapshotPullRequest =
    isRecord(snapshot) && isRecord(snapshot.pull_request)
      ? snapshot.pull_request
      : null;
  const snapshotBase =
    isRecord(snapshot) && isRecord(snapshot.base) ? snapshot.base : null;
  const snapshotFreshness =
    isRecord(snapshot) && isRecord(snapshot.freshness)
      ? snapshot.freshness
      : null;
  const expectedSnapshotIdentity = {
    repository: gate.repository,
    number: gate.pull_request.number,
    node_id: snapshotPullRequest?.node_id ?? null,
    url: gate.pull_request.url,
    head_sha: gate.expected_head_sha,
    base_branch: gate.pull_request.base_branch,
    base_sha: gate.expected_base_sha,
  };
  const identityFieldMatches = (value, expected, kind = "string") => {
    if (kind === "repository") {
      return (
        validateRepositoryName(value) &&
        normalizeRepository(value) === normalizeRepository(expected)
      );
    }
    if (kind === "url") {
      return isHttpUrl(value) && normalizeUrl(value) === normalizeUrl(expected);
    }
    if (kind === "sha") {
      return (
        isSha(value) &&
        isSha(expected) &&
        value.toLowerCase() === expected.toLowerCase()
      );
    }
    if (kind === "number") return value === expected;
    return value === expected;
  };
  const sourceIdentityMatches = (identity) =>
    isRecord(identity) &&
    identityFieldMatches(identity.repository, expectedSnapshotIdentity.repository, "repository") &&
    identityFieldMatches(identity.number, expectedSnapshotIdentity.number, "number") &&
    isNonEmptyString(identity.node_id) &&
    identity.node_id === expectedSnapshotIdentity.node_id &&
    isHttpUrl(identity.url) &&
    identityFieldMatches(identity.url, expectedSnapshotIdentity.url, "url") &&
    identityFieldMatches(identity.head_sha, expectedSnapshotIdentity.head_sha, "sha") &&
    identityFieldMatches(identity.base_branch, expectedSnapshotIdentity.base_branch) &&
    identityFieldMatches(identity.base_sha, expectedSnapshotIdentity.base_sha, "sha");
  const nonEmptyStringArray = (value) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => isNonEmptyString(entry));
  const completeSourceStatus = (value) => ["loaded", "empty"].includes(value);

  if (
    !isRecord(snapshot) ||
    snapshot.schema !== "PullRequestReadinessEvidence" ||
    snapshot.version !== 1 ||
    snapshot.status !== "complete" ||
    snapshot.failure !== null ||
    !validateRepositoryName(snapshot.repository) ||
    !isRecord(snapshotPullRequest) ||
    !Number.isInteger(snapshotPullRequest.number) ||
    !isNonEmptyString(snapshotPullRequest.node_id) ||
    !isHttpUrl(snapshotPullRequest.url) ||
    snapshotPullRequest.state !== "open" ||
    snapshotPullRequest.draft !== false ||
    !isSha(snapshot.head_sha) ||
    !isRecord(snapshotBase) ||
    !isSafeBranchName(snapshotBase.name) ||
    !isSha(snapshotBase.oid) ||
    !isIsoTimestamp(snapshot.observed_at) ||
    !isRecord(snapshotFreshness) ||
    snapshotFreshness.status !== "current" ||
    !nonEmptyStringArray(snapshotFreshness.evidence) ||
    !identityFieldMatches(snapshot.repository, expectedSnapshotIdentity.repository, "repository") ||
    !identityFieldMatches(snapshotPullRequest.number, expectedSnapshotIdentity.number, "number") ||
    !identityFieldMatches(snapshotPullRequest.url, expectedSnapshotIdentity.url, "url") ||
    !identityFieldMatches(snapshot.head_sha, expectedSnapshotIdentity.head_sha, "sha") ||
    !identityFieldMatches(snapshotBase.name, expectedSnapshotIdentity.base_branch) ||
    !identityFieldMatches(snapshotBase.oid, expectedSnapshotIdentity.base_sha, "sha")
  ) {
    addFinding(
      findings,
      "PreMergeGate.readiness.readiness_evidence is missing, stale, mixed, or not complete.",
      "rebuild one complete identity-matched PullRequestReadinessEvidence snapshot for the approved head and base",
    );
  } else {
    const policy = snapshot.policy;
    const requiredChecks = isRecord(policy) ? policy.required_checks : null;
    const approvals = isRecord(policy) ? policy.approvals : null;
    const discussions = snapshot.discussions;
    const linkedIssue = snapshot.linked_issue;
    const mergeMethods = snapshot.merge_methods;
    const sources = snapshot.sources;
    const requiredSourceNames = [
      "load-pull-request",
      "load-pr-discussions",
      "inspect-pr-checks",
      "check-required-approvals",
      "check-open-review-threads",
      "check-linked-issue-status",
    ];
    const sourceNames = new Set();
    if (!Array.isArray(sources) || sources.length === 0) {
      addFinding(
        findings,
        "PreMergeGate.readiness.readiness_evidence.sources is missing.",
        "preserve every identity-bound reader source in the complete snapshot",
      );
    } else {
      for (const source of sources) {
        if (
          !isRecord(source) ||
          !isNonEmptyString(source.name) ||
          sourceNames.has(source.name) ||
          !completeSourceStatus(source.status) ||
          !sourceIdentityMatches(source.identity) ||
          !isIsoTimestamp(source.retrieved_at) ||
          !isRecord(source.pagination) ||
          source.pagination.complete !== true ||
          !Number.isInteger(source.pagination.page_count) ||
          source.pagination.page_count < 0 ||
          !nonEmptyStringArray(source.provenance) ||
          !nonEmptyStringArray(source.evidence)
        ) {
          addFinding(
            findings,
            "PreMergeGate.readiness.readiness_evidence contains partial, unavailable, or identity-mismatched source evidence.",
            "reload every reader source for the same pull-request identity and complete pagination",
          );
          continue;
        }
        sourceNames.add(source.name);
      }
      for (const requiredSourceName of requiredSourceNames) {
        if (!sourceNames.has(requiredSourceName)) {
          addFinding(
            findings,
            `PreMergeGate.readiness.readiness_evidence is missing source ${safeLabel(requiredSourceName)}.`,
            "rebuild the complete fixed-order readiness evidence chain",
          );
        }
      }
    }

    if (
      !isRecord(policy) ||
      !["loaded", "empty"].includes(policy.status) ||
      !Array.isArray(policy.sources) ||
      (policy.status === "loaded" && policy.sources.length === 0) ||
      !nonEmptyStringArray(policy.evidence) ||
      !isRecord(requiredChecks) ||
      !completeSourceStatus(requiredChecks.status) ||
      !Array.isArray(requiredChecks.checks) ||
      !nonEmptyStringArray(requiredChecks.evidence) ||
      !isRecord(approvals) ||
      !completeSourceStatus(approvals.status) ||
      !Number.isInteger(approvals.required_approvals) ||
      approvals.required_approvals < 0 ||
      !Array.isArray(approvals.approvals) ||
      !Array.isArray(approvals.dismissals) ||
      !Array.isArray(approvals.change_requests) ||
      !nonEmptyStringArray(approvals.evidence)
    ) {
      addFinding(
        findings,
        "PreMergeGate.readiness.readiness_evidence.policy is incomplete or unavailable.",
        "record complete policy, required-check, approval, dismissal, and change-request provenance",
      );
    } else if (
      policy.sources.some(
        (source) =>
          !isRecord(source) ||
          !isNonEmptyString(source.kind) ||
          !isNonEmptyString(source.identity) ||
          !completeSourceStatus(source.status) ||
          !nonEmptyStringArray(source.provenance) ||
          !nonEmptyStringArray(source.evidence),
      )
    ) {
      addFinding(
        findings,
        "PreMergeGate.readiness.readiness_evidence.policy contains incomplete provenance.",
        "preserve the exact retrieved policy source and its evidence",
      );
    }

    if (
      isRecord(requiredChecks) &&
      ["loaded", "empty"].includes(requiredChecks.status) &&
      Array.isArray(requiredChecks.checks)
    ) {
      const summaryChecks = new Map(
        Array.isArray(readiness.checks)
          ? readiness.checks
              .filter((check) => isRecord(check) && isNonEmptyString(check.name))
              .map((check) => [check.name, check])
          : [],
      );
      for (const check of requiredChecks.checks) {
        if (
          !isRecord(check) ||
          !isNonEmptyString(check.name) ||
          typeof check.required !== "boolean" ||
          !["pass", "fail", "pending", "skipped", "unknown"].includes(check.result) ||
          !Array.isArray(check.evidence) ||
          check.evidence.length === 0 ||
          !check.evidence.every((entry) => isNonEmptyString(entry))
        ) {
          addFinding(
            findings,
            "PreMergeGate.readiness.readiness_evidence contains an incomplete required-check policy record.",
            "preserve the current required-check set, result, head, and evidence from S03",
          );
          continue;
        }
        if (
          check.required === true &&
          (check.result !== "pass" ||
            !isSha(check.head_sha) ||
            check.head_sha.toLowerCase() !== gate.expected_head_sha.toLowerCase())
        ) {
          addFinding(
            findings,
            `Current required check ${safeLabel(check.name)} is not a passing result for the approved head.`,
            "refresh current required-check policy and outcomes before merging",
          );
        }
        const summary = summaryChecks.get(check.name);
        if (
          !isRecord(summary) ||
          summary.required !== check.required ||
          summary.result !== check.result ||
          (check.head_sha !== null &&
            check.head_sha !== undefined &&
            summary.head_sha !== check.head_sha)
        ) {
          addFinding(
            findings,
            `Readiness summary for required check ${safeLabel(check.name)} differs from the current policy snapshot.`,
            "rebuild MergeReadiness from the same final S03 snapshot",
          );
        }
      }
    }

    if (
      isRecord(approvals) &&
      ["loaded", "empty"].includes(approvals.status) &&
      Number.isInteger(approvals.required_approvals) &&
      Array.isArray(approvals.approvals) &&
      Array.isArray(approvals.dismissals) &&
      Array.isArray(approvals.change_requests)
    ) {
      if (
        !approvals.approvals.every(isRecord) ||
        !approvals.dismissals.every(isRecord) ||
        !approvals.change_requests.every(isRecord)
      ) {
        addFinding(
          findings,
          "The current approval policy snapshot contains malformed approval, dismissal, or change-request records.",
          "reload complete normalized approval evidence from S03",
        );
      }
      if (
        approvals.approvals.some(
          (approval) =>
            approval.dismissed === true ||
            approval.current_for_head === false ||
            approval.qualifying_approval === false,
        )
      ) {
        addFinding(
          findings,
          "The current approval policy snapshot includes a dismissed, stale, or non-qualifying approval.",
          "rebuild the effective approval list from current non-dismissed reviews",
        );
      }
      if (approvals.change_requests.some((request) => request.active === false)) {
        addFinding(
          findings,
          "The current approval policy snapshot includes a non-active change request in its active list.",
          "rebuild the active change-request list from current review evidence",
        );
      }
      if (approvals.change_requests.length > 0) {
        addFinding(
          findings,
          "The current approval policy snapshot records active change requests.",
          "resolve current change requests and rebuild the final S03 snapshot",
        );
      }
      if (approvals.approvals.length < approvals.required_approvals) {
        addFinding(
          findings,
          "The current approval policy snapshot does not meet its required approval threshold.",
          "obtain the current required approvals and rebuild the final S03 snapshot",
        );
      }
      if (
        isRecord(reviewState) &&
        (reviewState.required_approvals !== approvals.required_approvals ||
          reviewState.approval_count !== approvals.approvals.length ||
          reviewState.change_request_count !== approvals.change_requests.length ||
          reviewState.required_approvals_met !==
            (approvals.approvals.length >= approvals.required_approvals))
      ) {
        addFinding(
          findings,
          "Stored review summary differs from the current approval policy snapshot.",
          "rebuild MergeReadiness from the same final S03 approval evidence",
        );
      }
    }

    if (
      !isRecord(discussions) ||
      !["loaded", "empty"].includes(discussions.status) ||
      !isRecord(discussions.pagination) ||
      discussions.pagination.complete !== true ||
      !Number.isInteger(discussions.pagination.page_count) ||
      !nonEmptyStringArray(discussions.pagination.evidence) ||
      !Array.isArray(discussions.threads) ||
      !nonEmptyStringArray(discussions.evidence)
    ) {
      addFinding(
        findings,
        "PreMergeGate.readiness.readiness_evidence.discussions is incomplete or not fully paginated.",
        "retrieve and preserve every review-thread page for the same pull-request head",
      );
    } else {
      for (const thread of discussions.threads) {
        if (
          !isRecord(thread) ||
          !isNonEmptyString(thread.id) ||
          !["open", "resolved", "unknown"].includes(thread.state) ||
          typeof thread.is_resolved !== "boolean" ||
          typeof thread.is_outdated !== "boolean" ||
          !["blocking", "nonblocking", "uncertain"].includes(thread.disposition) ||
          !nonEmptyStringArray(thread.evidence)
        ) {
          addFinding(
            findings,
            "PreMergeGate.readiness.readiness_evidence contains an uncertain review-thread record.",
            "rebuild complete evidence-backed resolved, outdated, and disposition fields",
          );
          break;
        }
        if (
          (thread.state === "resolved" && thread.is_resolved !== true) ||
          (thread.state === "open" && thread.is_resolved === true)
        ) {
          addFinding(
            findings,
            `Review thread ${safeLabel(thread.id)} has contradictory resolved-state evidence.`,
            "reload the current thread state and disposition from S03",
          );
        }
        if (
          thread.state === "unknown" ||
          thread.disposition === "uncertain" ||
          (thread.is_resolved !== true && thread.disposition !== "nonblocking")
        ) {
          addFinding(
            findings,
            `Review thread ${safeLabel(thread.id)} is unresolved, ambiguous, or explicitly blocking under the current S03 disposition.`,
            "refresh current/outdated thread policy and resolve every blocking or uncertain thread",
          );
        }
      }
      if (
        isRecord(reviewState) &&
        (reviewState.unresolved_threads !==
          discussions.threads.filter((thread) => thread.is_resolved !== true).length ||
          reviewState.outdated_threads !==
            discussions.threads.filter((thread) => thread.is_outdated === true).length)
      ) {
        addFinding(
          findings,
          "Stored review-thread counts differ from the current paginated discussion evidence.",
          "rebuild MergeReadiness from the same final S03 discussion snapshot",
        );
      }
    }

    if (
      !isRecord(linkedIssue) ||
      !["covered", "waived"].includes(linkedIssue.status) ||
      !nonEmptyStringArray(linkedIssue.evidence)
    ) {
      addFinding(
        findings,
        "PreMergeGate.readiness.readiness_evidence.linked_issue is missing or unavailable.",
        "preserve one unambiguous linked-issue or explicitly authorized waiver evidence",
      );
    } else if (linkedIssue.status === "covered") {
      const issue = linkedIssue.issue;
      if (
        !isRecord(issue) ||
        !validateRepositoryName(issue.repository) ||
        normalizeRepository(issue.repository) !== normalizeRepository(gate.repository) ||
        !Number.isInteger(issue.number) ||
        issue.number < 1 ||
        !isHttpUrl(issue.url)
      ) {
        addFinding(
          findings,
          "PreMergeGate.readiness.readiness_evidence.linked_issue does not prove one exact issue.",
          "preserve the exact linked issue identity and URL",
        );
      }
      if (
        issueCoverage?.status === "covered" &&
        (!isRecord(issueCoverage.issue) ||
          normalizeRepository(issueCoverage.issue.repository) !== normalizeRepository(issue.repository) ||
          issueCoverage.issue.number !== issue.number ||
          normalizeUrl(issueCoverage.issue.url) !== normalizeUrl(issue.url))
      ) {
        addFinding(
          findings,
          "PreMergeGate.readiness.readiness_evidence.linked_issue does not match readiness.issue_coverage.",
          "rebuild the snapshot and readiness result from the same linked-issue source",
        );
      }
    } else {
      const waiver = linkedIssue.waiver;
      if (
        !isRecord(waiver) ||
        !isNonEmptyString(waiver.reason) ||
        !isNonEmptyString(waiver.source) ||
        !isNonEmptyString(waiver.evidence)
      ) {
        addFinding(
          findings,
          "PreMergeGate.readiness.readiness_evidence.linked_issue waiver is incomplete.",
          "preserve the exact waiver reason, source, and evidence",
        );
      }
    }

    if (
      !isRecord(mergeMethods) ||
      !["loaded", "empty", "not_used"].includes(mergeMethods.status) ||
      !Array.isArray(mergeMethods.allowed) ||
      !nonEmptyStringArray(mergeMethods.evidence) ||
      (mergeMethods.selected !== null &&
        !ALLOWED_MERGE_METHODS.has(mergeMethods.selected))
    ) {
      addFinding(
        findings,
        "PreMergeGate.readiness.readiness_evidence.merge_methods is incomplete.",
        "preserve conditional merge-method evidence when readiness uses it",
      );
    }
  }

  return {
    reviewState,
    issueCoverage,
  };
}

function validateGate(gate, repositoryRoot, findings) {
  if (!isRecord(gate)) {
    return null;
  }
  if (gate.schema !== "PreMergeGate" || gate.version !== 3) {
    addFinding(
      findings,
      "PreMergeGate has an unsupported schema version.",
      "write a fresh version-3 PreMergeGate",
    );
  }
  if (!isIsoTimestamp(gate.written_at)) {
    addFinding(
      findings,
      "PreMergeGate.written_at is missing or malformed.",
      "write a fresh current PreMergeGate",
    );
  } else if (Date.parse(gate.written_at) > Date.now() + 60_000) {
    addFinding(
      findings,
      "PreMergeGate.written_at is in the future.",
      "write the gate with the current timestamp",
    );
  }

  const workspace = gate.workspace;
  validateWorkspace(workspace, repositoryRoot, findings);
  if (!isRecord(workspace) || !validateRepositoryName(workspace.repository)) {
    return null;
  }

  const repository = workspace.repository;
  if (!isSha(gate.expected_head_sha) || !isSha(gate.expected_base_sha)) {
    addFinding(
      findings,
      "PreMergeGate expected head or base SHA is missing or malformed.",
      "preserve full current head and base commit identities",
    );
  }

  const pullRequest = validatePullRequest(gate.pull_request, findings);
  if (
    pullRequest !== null &&
    normalizeRepository(pullRequest.repository) !== normalizeRepository(repository)
  ) {
    addFinding(
      findings,
      "PreMergeGate.workspace and pull-request repositories differ.",
      "use one verified repository identity",
    );
  }

  const preflight =
    pullRequest !== null &&
    isSha(gate.expected_head_sha) &&
    isSha(gate.expected_base_sha)
      ? validatePreflight(
          gate.preflight,
          {
            expected_head_sha: gate.expected_head_sha,
            expected_base_sha: gate.expected_base_sha,
            pull_request: pullRequest,
          },
          findings,
        )
      : null;

  const merge = gate.merge;
  if (
    !isRecord(merge) ||
    !ALLOWED_MERGE_METHODS.has(merge.method) ||
    typeof merge.delete_branch !== "boolean" ||
    (merge.commit_title !== null &&
      merge.commit_title !== undefined &&
      typeof merge.commit_title !== "string") ||
    (merge.commit_message !== null &&
      merge.commit_message !== undefined &&
      typeof merge.commit_message !== "string")
  ) {
    addFinding(
      findings,
      "PreMergeGate.merge is missing or malformed.",
      "preserve the exact approved merge method and metadata",
    );
  }

  const authorization = gate.authorization;
  if (
    !isRecord(authorization) ||
    authorization.exact_target !== true ||
    authorization.exact_merge_operation !== true ||
    authorization.merge_authorized !== true ||
    typeof authorization.delete_branch_authorized !== "boolean" ||
    !ALLOWED_AUTHORIZATION_SOURCES.has(authorization.source) ||
    !isNonEmptyString(authorization.evidence) ||
    (authorization.approved_at !== null &&
      authorization.approved_at !== undefined &&
      !isIsoTimestamp(authorization.approved_at))
  ) {
    addFinding(
      findings,
      "PreMergeGate.authorization does not contain explicit exact merge approval.",
      "obtain and record approval for this exact pull request and merge operation",
    );
  }
  if (
    isRecord(merge) &&
    merge.delete_branch === true &&
    (!isRecord(authorization) ||
      authorization.delete_branch_authorized !== true)
  ) {
    addFinding(
      findings,
      "Branch deletion is requested without separate explicit authorization.",
      "remove branch deletion or authorize the exact deletion effect",
    );
  }

  const readiness =
    pullRequest !== null &&
    isSha(gate.expected_head_sha) &&
    isRecord(gate.merge)
      ? validateReadiness(
          gate.readiness,
          {
            repository,
            pull_request: pullRequest,
            expected_head_sha: gate.expected_head_sha,
            expected_base_sha: gate.expected_base_sha,
          },
          findings,
      )
      : null;

  if (
    isRecord(preflight) &&
    isIsoTimestamp(preflight.checked_at) &&
    isRecord(gate.readiness) &&
    isRecord(gate.readiness.readiness_evidence) &&
    isIsoTimestamp(gate.readiness.readiness_evidence.observed_at) &&
    Date.parse(preflight.checked_at) <
      Date.parse(gate.readiness.readiness_evidence.observed_at)
  ) {
    addFinding(
      findings,
      "PreMergeGate.preflight predates the readiness evidence snapshot.",
      "capture the final live preflight after the current S03 snapshot and write a new gate",
    );
  }
  if (
    isRecord(preflight) &&
    isIsoTimestamp(gate.written_at) &&
    isIsoTimestamp(preflight.checked_at) &&
    Date.parse(preflight.checked_at) > Date.parse(gate.written_at)
  ) {
    addFinding(
      findings,
      "PreMergeGate.preflight was recorded after the gate write.",
      "write one gate immediately after the final live preflight",
    );
  }
  if (
    isRecord(preflight) &&
    isIsoTimestamp(preflight.checked_at) &&
    isRecord(gate.readiness) &&
    isRecord(gate.readiness.readiness_evidence) &&
    isIsoTimestamp(gate.readiness.readiness_evidence.observed_at) &&
    Date.parse(preflight.checked_at) -
      Date.parse(gate.readiness.readiness_evidence.observed_at) >
      60_000
  ) {
    addFinding(
      findings,
      "PreMergeGate.preflight is too far removed from the final readiness evidence snapshot.",
      "run the complete S03 reader chain and final preflight immediately before writing the gate",
    );
  }
  const snapshotSources =
    isRecord(gate.readiness) &&
    isRecord(gate.readiness.readiness_evidence) &&
    Array.isArray(gate.readiness.readiness_evidence.sources)
      ? gate.readiness.readiness_evidence.sources
      : [];
  if (isRecord(preflight) && isIsoTimestamp(preflight.checked_at)) {
    for (const source of snapshotSources) {
      if (!isRecord(source) || !isIsoTimestamp(source.retrieved_at)) continue;
      if (Date.parse(source.retrieved_at) > Date.parse(preflight.checked_at)) {
        addFinding(
          findings,
          "A readiness source was retrieved after the final preflight.",
          "rerun the complete S03 reader chain before the final preflight",
        );
      } else if (
        Date.parse(preflight.checked_at) - Date.parse(source.retrieved_at) >
        60_000
      ) {
        addFinding(
          findings,
          "A readiness source is outside the final preflight freshness window.",
          "refresh every S03 reader source immediately before the final preflight",
        );
      }
    }
  }

  return {
    gate,
    repository,
    pullRequest,
    merge,
    authorization,
    preflight,
    readiness,
  };
}

function compareCommandToGate(spec, context, findings) {
  const gate = context.gate;
  const pullRequest = context.pullRequest;
  const merge = context.merge;
  if (pullRequest === null || !isRecord(merge)) {
    return;
  }

  if (
    normalizeRepository(spec.repository) !==
    normalizeRepository(gate.workspace.repository)
  ) {
    addFinding(
      findings,
      "The merge command repository differs from PreMergeGate.",
      "run the exact approved repository merge command",
    );
  }
  if (spec.number !== pullRequest.number) {
    addFinding(
      findings,
      "The merge command pull-request number differs from PreMergeGate.",
      "run the exact approved pull-request merge command",
    );
  }
  if (spec.method !== merge.method) {
    addFinding(
      findings,
      "The merge command method differs from the approved method.",
      "use the exact approved merge strategy",
    );
  }
  if (spec.deleteBranch !== merge.delete_branch) {
    addFinding(
      findings,
      "The merge command branch-deletion effect differs from the approved effect.",
      "match the exact approved branch-deletion setting",
    );
  }
  if (
    !isSha(spec.matchHeadSha) ||
    !isSha(gate.expected_head_sha) ||
    spec.matchHeadSha.toLowerCase() !== gate.expected_head_sha.toLowerCase()
  ) {
    addFinding(
      findings,
      "The merge command is missing an enforceable exact head-SHA compare-and-set guard or uses a different head.",
      "use --match-head-commit or API sha with the full approved head SHA",
    );
  }
  if (
    spec.url !== null &&
    normalizeUrl(spec.url) !== normalizeUrl(gate.pull_request.url)
  ) {
    addFinding(
      findings,
      "The merge command pull-request URL differs from PreMergeGate.",
      "run the exact approved pull-request URL or number",
    );
  }
  if (spec.kind === "api-merge" && spec.httpMethod !== "PUT" && spec.httpMethod !== "POST") {
    addFinding(
      findings,
      "The API merge command uses an unsupported HTTP method.",
      "use the approved pull-request merge write method",
    );
  }

  const expectedTitle =
    merge.commit_title === undefined ? null : merge.commit_title;
  const expectedMessage =
    merge.commit_message === undefined ? null : merge.commit_message;
  if (spec.subjectProvided !== (expectedTitle !== null)) {
    addFinding(
      findings,
      "The merge command commit-title payload does not match the approved payload.",
      "preserve the exact approved commit metadata",
    );
  } else if (spec.subjectProvided && spec.subject !== expectedTitle) {
    addFinding(
      findings,
      "The merge command commit title differs from the approved title.",
      "use the exact approved commit title",
    );
  }
  if (spec.bodyProvided !== (expectedMessage !== null)) {
    addFinding(
      findings,
      "The merge command commit-message payload does not match the approved payload.",
      "preserve the exact approved commit metadata",
    );
  } else if (spec.bodyProvided && spec.body !== expectedMessage) {
    addFinding(
      findings,
      "The merge command commit message differs from the approved message.",
      "use the exact approved commit message",
    );
  }
}

function parseInvocation(invocation, findings) {
  if (invocation.parseError) {
    addFinding(
      findings,
      invocation.parseError,
      "run exactly one explicit, parseable merge command",
    );
  }
  if (!existsSync(invocation.targetDirectory)) {
    addFinding(
      findings,
      "The merge command worktree does not exist.",
      "run the merge from the verified implementation worktree",
    );
    return null;
  }
  if (invocation.kind === "pr-merge") {
    return parsePrMergeArguments(
      invocation.args,
      invocation.targetDirectory,
      findings,
    );
  }
  return parseApiMergeArguments(
    invocation.args,
    invocation.endpoint,
    invocation.targetDirectory,
    findings,
  );
}

function likelyMergeCommand(command) {
  return (
    /\bgh(?:\.exe|\.cmd|\.bat)?\s+pr\s+merge\b/i.test(command) ||
    (/\bgh(?:\.exe|\.cmd|\.bat)?\s+api\b/i.test(command) &&
      /\/pulls\/[1-9]\d*\/merge\b/i.test(command) &&
      /(?:--method|-x|-X)\s*=?\s*(?:PUT|POST)\b/i.test(command))
  );
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

  process.stdout.write(
    JSON.stringify(
      result.decision === "deny"
        ? {
            permission: "deny",
            user_message: result.message,
            agent_message: result.message,
          }
        : { permission: "allow" },
    ) + "\n",
  );
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
  const identified = identifyMergeInvocations(command, parserDirectory);

  if (identified.invocations.length === 0) {
    if (!identified.parseable && likelyMergeCommand(command)) {
      return makeDeny([
        {
          key: "parse",
          requirement:
            identified.reason ??
            "The command appears to contain a GitHub merge that cannot be identified safely.",
          nextStep: "run one direct, explicit, parseable pull-request merge command",
        },
      ]);
    }
    return makeAllow();
  }

  const findings = [];
  if (identified.invocations.length > 1) {
    addFinding(
      findings,
      "The shell command contains more than one pull-request merge invocation.",
      "run exactly one approved merge command",
    );
  }
  if (initialDirectory === null) {
    addFinding(
      findings,
      "The hook did not receive the merge working directory.",
      "run the merge from the verified worktree",
    );
  }

  const invocation = identified.invocations[0];
  const spec = parseInvocation(invocation, findings);
  if (spec === null) {
    return makeDeny(findings);
  }
  if (!validateRepositoryName(spec.repository) || !Number.isInteger(spec.number)) {
    addFinding(
      findings,
      "The merge command target identity is missing or malformed.",
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
      "The merge worktree is not a verifiable Git repository.",
      "run the merge from the registered repository worktree",
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
        requirement: `The deterministic pre-merge check failed closed with ${errorType}.`,
        nextStep: "verify the current merge gate and read-only GitHub evidence",
      },
    ]);
  }

  writeResponse(input, result);
  if (result.decision === "deny") {
    process.exitCode = 2;
  }
}

main();
