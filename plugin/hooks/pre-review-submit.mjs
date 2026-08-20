import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve } from "node:path";

import { readHookInput } from "./lib/read-hook-input.mjs";
import { runCommand as runBoundedCommand } from "./lib/run-command.mjs";

const GATE_RELATIVE_PATH = ".cursor/hooks/state/pre-review-submit.json";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const VALID_EVENTS = new Set(["COMMENT", "REQUEST_CHANGES", "APPROVE"]);
const VALID_SEVERITIES = new Set(["blocker", "major", "minor", "suggestion"]);
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);
const VALID_SIDES = new Set(["LEFT", "RIGHT", "unknown"]);
const INLINE_SIDES = new Set(["LEFT", "RIGHT"]);
const VALID_CONFIRMATION_DECISIONS = new Set([
  "change_request",
  "suggestion",
  "modify",
]);
const VALID_SUPPRESSION_DISPOSITIONS = new Set([
  "merged_into",
  "already_discussed",
  "already_addressed",
]);

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
    return url.protocol === "https:" || url.protocol === "http:";
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

function normalizeAbsolutePath(value) {
  return normalize(resolve(value)).toLowerCase();
}

function normalizeRelativePath(value) {
  if (!isNonEmptyString(value) || value.includes("\0")) {
    return null;
  }

  const pathValue = value.replaceAll("\\", "/");
  if (isAbsolute(pathValue) || /^[A-Za-z]:\//.test(pathValue)) {
    return null;
  }

  const segments = pathValue.split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    return null;
  }

  return segments.join("/");
}

function safeLabel(value) {
  return String(value).replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 100);
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
      "AI review publication blocked by deterministic pre-review-submit checks. " +
      "Missing or invalid prerequisites:\n" +
      visibleFindings.join("\n") +
      "\nThe hook performed no file, Git, or GitHub write.",
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
      maxBuffer: 8 * 1024 * 1024,
      operation,
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

function splitLongOption(token) {
  const separatorIndex = token.indexOf("=");
  if (separatorIndex < 0) {
    return { name: token.toLowerCase(), inlineValue: null };
  }
  return {
    name: token.slice(0, separatorIndex).toLowerCase(),
    inlineValue: token.slice(separatorIndex + 1),
  };
}

function parseReviewEndpoint(value) {
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

  candidate = candidate.replace(/^\/+/, "");
  const match = candidate.match(
    /^repos\/([^/\s]+)\/([^/\s]+)\/pulls\/([1-9]\d*)\/reviews\/?$/i,
  );
  if (!match) {
    return null;
  }

  return {
    raw: value,
    canonical: `repos/${match[1]}/${match[2]}/pulls/${match[3]}/reviews`,
    repository: `${match[1]}/${match[2]}`,
    number: Number(match[3]),
    canonicalInput: /^repos\//i.test(value),
  };
}

function methodFromApiArguments(args) {
  let method = null;
  let hasInput = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const option = splitLongOption(token);
    if (option.name === "--method" || option.name === "-x") {
      method = option.inlineValue ?? args[index + 1] ?? null;
      if (option.inlineValue === null) {
        index += 1;
      }
      continue;
    }
    if (option.name === "--input") {
      hasInput = true;
      if (option.inlineValue === null) {
        index += 1;
      }
    }
  }

  return {
    method: isNonEmptyString(method) ? method.toUpperCase() : null,
    hasInput,
  };
}

function findReviewEndpoint(segment, firstIndex) {
  for (const token of segment.slice(firstIndex + 2)) {
    const endpoint = parseReviewEndpoint(token);
    if (endpoint !== null) {
      return endpoint;
    }
  }
  return null;
}

function isReviewApiPublication(segment, firstIndex) {
  const endpoint = findReviewEndpoint(segment, firstIndex);
  if (endpoint === null) {
    return null;
  }

  const { method, hasInput } = methodFromApiArguments(
    segment.slice(firstIndex + 2),
  );
  if (method === null && !hasInput) {
    return null;
  }
  if (
    method !== null &&
    ["GET", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"].includes(method)
  ) {
    return null;
  }
  return endpoint;
}

function identifyReviewInvocations(command, initialDirectory) {
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
  let reviewSeen = false;
  let unsafeCommandSegment = false;
  const invocations = [];

  for (const segment of splitCommandSegments(tokens)) {
    if (segment.length === 0) {
      continue;
    }

    const firstIndex = unwrapCommandWrappers(segment);
    const first = segment[firstIndex]?.toLowerCase();

    if (first === "cd" || first === "pushd" || first === "set-location") {
      if (reviewSeen) {
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
        parseError = "The review command working directory could not be resolved safely.";
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
    if (
      commandName === "pr" &&
      segment[firstIndex + 2]?.toLowerCase() === "review"
    ) {
      if (reviewSeen) {
        unsafeCommandSegment = true;
      }
      reviewSeen = true;
      invocations.push({
        kind: "pr-review",
        targetDirectory: currentDirectory,
        args: segment.slice(firstIndex + 3),
        endpoint: null,
        parseError,
      });
      continue;
    }

    if (commandName === "api") {
      const endpoint = isReviewApiPublication(segment, firstIndex);
      if (endpoint !== null) {
        if (reviewSeen) {
          unsafeCommandSegment = true;
        }
        reviewSeen = true;
        invocations.push({
          kind: "api-review",
          targetDirectory: currentDirectory,
          args: segment.slice(firstIndex + 2),
          endpoint,
          parseError,
        });
      } else if (reviewSeen) {
        unsafeCommandSegment = true;
      } else {
        unsafeCommandSegment = true;
      }
    } else {
      unsafeCommandSegment = true;
    }
  }

  if (invocations.length > 0 && unsafeCommandSegment) {
    parseError =
      parseError ??
      "The review publication command contains another shell command or pipeline.";
    for (const invocation of invocations) {
      invocation.parseError = parseError;
    }
  }

  return { invocations, parseable: true, reason: null };
}

function parseApiArguments(args, endpoint, findings) {
  const values = new Map();
  const positional = [];
  const supportedOptions = new Set(["--method", "--input"]);

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--") {
      addFinding(
        findings,
        "The review API command uses the end-of-options marker, so its exact payload cannot be verified.",
        "run one canonical gh api command with explicit named options",
      );
      continue;
    }

    if (!token.startsWith("-")) {
      positional.push(token);
      continue;
    }

    const option = splitLongOption(token);
    if (!supportedOptions.has(option.name)) {
      addFinding(
        findings,
        `The review API command uses an unsupported option ${safeLabel(option.name)}.`,
        "use only --method POST and --input with the canonical review endpoint",
      );
      if (
        option.inlineValue === null &&
        index + 1 < args.length &&
        !args[index + 1].startsWith("-")
      ) {
        index += 1;
      }
      continue;
    }

    if (values.has(option.name)) {
      addFinding(
        findings,
        `The review API command specifies ${safeLabel(option.name)} more than once.`,
        "provide one exact value for each review API option",
      );
    }

    let value = option.inlineValue;
    if (value === null) {
      if (index + 1 >= args.length || args[index + 1].startsWith("-")) {
        addFinding(
          findings,
          `The review API option ${safeLabel(option.name)} has no explicit value.`,
          "provide the exact approved option value",
        );
        value = null;
      } else {
        index += 1;
        value = args[index];
      }
    }
    values.set(option.name, value);
  }

  const method = values.get("--method");
  if (method !== "POST") {
    addFinding(
      findings,
      "The review API command does not use the literal POST method.",
      "use --method POST for the one approved review publication",
    );
  }

  const inputPath = values.get("--input");
  if (!isNonEmptyString(inputPath) || inputPath === "-") {
    addFinding(
      findings,
      "The review API command does not provide a readable payload file.",
      "use --input with the exact approved JSON payload file",
    );
  }

  if (positional.length !== 1) {
    addFinding(
      findings,
      "The review API command does not contain exactly one review endpoint.",
      "use the exact repos/<owner>/<repository>/pulls/<number>/reviews endpoint",
    );
  } else {
    const actualEndpoint = parseReviewEndpoint(positional[0]);
    if (
      actualEndpoint === null ||
      actualEndpoint.canonical !== endpoint.canonical ||
      !actualEndpoint.canonicalInput
    ) {
      addFinding(
        findings,
        "The review API endpoint is not the exact canonical repository review endpoint.",
        "use the canonical repos/<owner>/<repository>/pulls/<number>/reviews path",
      );
    }
  }

  return {
    method,
    inputPath,
    endpoint,
  };
}

function readJsonFile(filePath, label, findings) {
  if (!isNonEmptyString(filePath) || filePath.includes("\0")) {
    addFinding(
      findings,
      `${label} path is missing or malformed.`,
      "provide the exact readable local JSON file",
    );
    return null;
  }

  if (filePath === "~" || filePath.startsWith("~")) {
    addFinding(
      findings,
      `${label} path uses an unresolved home-directory shortcut.`,
      "use an explicit readable file path",
    );
    return null;
  }

  const absolutePath = isAbsolute(filePath)
    ? filePath
    : resolve(process.cwd(), filePath);
  try {
    const fileStats = statSync(absolutePath);
    if (!fileStats.isFile()) {
      addFinding(
        findings,
        `${label} is not a regular file.`,
        "provide the exact approved JSON payload file",
      );
      return null;
    }
    if (fileStats.size > MAX_FILE_BYTES) {
      addFinding(
        findings,
        `${label} exceeds the deterministic size limit.`,
        "use the exact approved JSON payload within the supported size limit",
      );
      return null;
    }
    return {
      path: absolutePath,
      value: JSON.parse(readFileSync(absolutePath, "utf8")),
    };
  } catch {
    addFinding(
      findings,
      `${label} is missing, unreadable, or invalid JSON.`,
      "write and pass the exact approved JSON payload file",
    );
    return null;
  }
}

function validateLocation(location, label, findings) {
  if (!isRecord(location)) {
    addFinding(
      findings,
      `${label} is missing or malformed.`,
      "preserve a repository-relative finding location",
    );
    return null;
  }

  const pathValue = normalizeRelativePath(location.path);
  if (pathValue === null) {
    addFinding(
      findings,
      `${label}.path is missing or not repository-relative.`,
      "use the smallest verified repository-relative path",
    );
  }

  const startLine =
    location.start_line === null || location.start_line === undefined
      ? null
      : location.start_line;
  const endLine =
    location.end_line === null || location.end_line === undefined
      ? null
      : location.end_line;

  if (
    startLine !== null &&
    (!Number.isInteger(startLine) || startLine < 1)
  ) {
    addFinding(
      findings,
      `${label}.start_line is not a positive line number.`,
      "use the verified changed-line or smallest-context line",
    );
  }
  if (endLine !== null && (!Number.isInteger(endLine) || endLine < 1)) {
    addFinding(
      findings,
      `${label}.end_line is not a positive line number.`,
      "use the verified finding location range",
    );
  }
  if (
    startLine !== null &&
    endLine !== null &&
    Number.isInteger(startLine) &&
    Number.isInteger(endLine) &&
    endLine < startLine
  ) {
    addFinding(
      findings,
      `${label} has an inverted line range.`,
      "preserve the verified location range in ascending order",
    );
  }

  const side = location.side ?? "unknown";
  if (!VALID_SIDES.has(side)) {
    addFinding(
      findings,
      `${label}.side is unsupported.`,
      "use LEFT, RIGHT, or unknown from the verified review evidence",
    );
  }

  if (
    location.commit_sha !== null &&
    location.commit_sha !== undefined &&
    !isSha(location.commit_sha)
  ) {
    addFinding(
      findings,
      `${label}.commit_sha is malformed.`,
      "bind the location to the verified pull-request head SHA",
    );
  }

  return {
    path: pathValue,
    startLine,
    endLine,
    side,
    commitSha: location.commit_sha ?? null,
  };
}

function validateReviewDecision(decision, findings) {
  if (!isRecord(decision)) {
    addFinding(
      findings,
      "PreReviewSubmitGate.review_decision is missing or malformed.",
      "write a fresh approved version-1 ReviewDecision",
    );
    return null;
  }

  if (decision.schema !== "ReviewDecision" || decision.version !== 1) {
    addFinding(
      findings,
      "ReviewDecision is not the supported version-1 handoff.",
      "preserve one version-1 ReviewDecision from compose-review",
    );
  }
  if (decision.status !== "approved") {
    addFinding(
      findings,
      "ReviewDecision.status is not approved.",
      "obtain approval for the exact review payload and event",
    );
  }
  if (!validateRepositoryName(decision.repository)) {
    addFinding(
      findings,
      "ReviewDecision.repository is missing or malformed.",
      "use the verified owner/repository identity",
    );
  }
  if (
    !isRecord(decision.pull_request) ||
    !Number.isInteger(decision.pull_request.number) ||
    decision.pull_request.number < 1 ||
    !isHttpUrl(decision.pull_request.url)
  ) {
    addFinding(
      findings,
      "ReviewDecision.pull_request identity is missing or malformed.",
      "preserve the exact verified pull-request number and URL",
    );
  }
  if (!isSha(decision.head_sha)) {
    addFinding(
      findings,
      "ReviewDecision.head_sha is missing or malformed.",
      "bind the approved review to the verified pull-request head SHA",
    );
  }
  if (!VALID_EVENTS.has(decision.proposed_event)) {
    addFinding(
      findings,
      "ReviewDecision.proposed_event is unsupported.",
      "preserve one approved COMMENT, REQUEST_CHANGES, or APPROVE event",
    );
  }
  if (!isNonEmptyString(decision.summary)) {
    addFinding(
      findings,
      "ReviewDecision.summary is missing.",
      "preserve the exact approved review summary",
    );
  }
  if (
    !isRecord(decision.approval) ||
    decision.approval.exact_payload !== true ||
    decision.approval.explicit_event_authorization !== true
  ) {
    addFinding(
      findings,
      "ReviewDecision does not contain both exact-payload and event authorization.",
      "record separate user or repository-policy authorization for the exact review payload and event",
    );
  }
  if (
    isRecord(decision.approval) &&
    decision.approval.approved_at !== null &&
    decision.approval.approved_at !== undefined &&
    !isIsoTimestamp(decision.approval.approved_at)
  ) {
    addFinding(
      findings,
      "ReviewDecision.approval.approved_at is malformed.",
      "preserve the verified approval timestamp",
    );
  }

  const includedIds = [];
  const decisionIds = new Set();
  if (!Array.isArray(decision.findings)) {
    addFinding(
      findings,
      "ReviewDecision.findings is missing or malformed.",
      "preserve the complete approved finding set",
    );
  } else {
    for (const finding of decision.findings) {
      if (!isRecord(finding) || !isNonEmptyString(finding.id)) {
        addFinding(
          findings,
          "ReviewDecision contains a finding without an ID.",
          "preserve stable finding IDs from the confirmed review set",
        );
        continue;
      }
      if (decisionIds.has(finding.id)) {
        addFinding(
          findings,
          "ReviewDecision contains a duplicate finding ID.",
          "include each confirmed finding exactly once",
        );
      }
      decisionIds.add(finding.id);
      if (finding.included === true) {
        includedIds.push(finding.id);
      } else if (finding.included !== false) {
        addFinding(
          findings,
          "ReviewDecision contains a finding with a non-boolean included flag.",
          "set included explicitly for every review finding",
        );
      }
    }
  }

  const inlineComments = Array.isArray(decision.inline_comments)
    ? decision.inline_comments
    : null;
  if (inlineComments === null) {
    addFinding(
      findings,
      "ReviewDecision.inline_comments is missing or malformed.",
      "preserve the exact approved inline-comment set",
    );
  }

  return {
    repository: decision.repository,
    pullRequestNumber: decision.pull_request?.number ?? null,
    pullRequestUrl: decision.pull_request?.url ?? null,
    headSha: decision.head_sha,
    includedIds,
    decisionIds,
    inlineComments: inlineComments ?? [],
  };
}

function validateClassifiedFindings(classified, findings) {
  if (!isRecord(classified)) {
    addFinding(
      findings,
      "PreReviewSubmitGate.classified_findings is missing or malformed.",
      "preserve the complete ClassifiedReviewFindings handoff",
    );
    return null;
  }

  if (
    classified.schema !== "ClassifiedReviewFindings" ||
    classified.version !== 1
  ) {
    addFinding(
      findings,
      "ClassifiedReviewFindings is not the supported version-1 handoff.",
      "preserve one version-1 ClassifiedReviewFindings handoff",
    );
  }
  if (!["classified", "partial"].includes(classified.status)) {
    addFinding(
      findings,
      "ClassifiedReviewFindings.status is not usable for an approved subset.",
      "classify the selected findings and preserve any uncertainty",
    );
  }
  if (!Array.isArray(classified.findings)) {
    addFinding(
      findings,
      "ClassifiedReviewFindings.findings is missing or malformed.",
      "preserve the complete classified finding list",
    );
    return {
      repository: classified.repository,
      pullRequestNumber: classified.pull_request?.number ?? null,
      headSha: classified.head_sha,
      findings: new Map(),
    };
  }

  const findingMap = new Map();
  for (const finding of classified.findings) {
    if (!isRecord(finding) || !isNonEmptyString(finding.id)) {
      addFinding(
        findings,
        "ClassifiedReviewFindings contains a finding without a stable ID.",
        "preserve stable IDs for every classified finding",
      );
      continue;
    }
    if (findingMap.has(finding.id)) {
      addFinding(
        findings,
        "ClassifiedReviewFindings contains a duplicate finding ID.",
        "preserve each active finding exactly once",
      );
      continue;
    }

    const location = validateLocation(
      finding.location,
      `ClassifiedReviewFindings.finding ${safeLabel(finding.id)}.location`,
      findings,
    );
    for (const field of ["evidence", "impact", "recommendation", "verification"]) {
      if (!isNonEmptyString(finding[field])) {
        addFinding(
          findings,
          `ClassifiedReviewFindings.finding ${safeLabel(finding.id)}.${field} is missing.`,
          "preserve observable evidence, impact, recommendation, and verification",
        );
      }
    }
    if (!VALID_SEVERITIES.has(finding.severity)) {
      addFinding(
        findings,
        `ClassifiedReviewFindings.finding ${safeLabel(finding.id)}.severity is unsupported.`,
        "preserve an evidence-supported blocker, major, minor, or suggestion severity",
      );
    }
    if (!VALID_CONFIDENCE.has(finding.confidence)) {
      addFinding(
        findings,
        `ClassifiedReviewFindings.finding ${safeLabel(finding.id)}.confidence is unsupported.`,
        "preserve a high, medium, or low confidence value",
      );
    }
    if (typeof finding.needs_discussion !== "boolean") {
      addFinding(
        findings,
        `ClassifiedReviewFindings.finding ${safeLabel(finding.id)}.needs_discussion is malformed.`,
        "preserve the explicit uncertainty decision for the finding",
      );
    }
    if (!isNonEmptyString(finding.classification_rationale)) {
      addFinding(
        findings,
        `ClassifiedReviewFindings.finding ${safeLabel(finding.id)}.classification_rationale is missing.`,
        "preserve the supplied evidence-backed classification rationale",
      );
    }
    if (!Array.isArray(finding.sources) || finding.sources.length === 0) {
      addFinding(
        findings,
        `ClassifiedReviewFindings.finding ${safeLabel(finding.id)}.sources is missing.`,
        "preserve at least one observable source reference",
      );
    }
    if (!Array.isArray(finding.merged_from)) {
      addFinding(
        findings,
        `ClassifiedReviewFindings.finding ${safeLabel(finding.id)}.merged_from is malformed.`,
        "preserve deduplication provenance as a list",
      );
    }
    if (!Array.isArray(finding.related_threads)) {
      addFinding(
        findings,
        `ClassifiedReviewFindings.finding ${safeLabel(finding.id)}.related_threads is malformed.`,
        "preserve review-thread references as a list",
      );
    }

    findingMap.set(finding.id, {
      raw: finding,
      location,
    });
  }

  return {
    repository: classified.repository,
    pullRequestNumber: classified.pull_request?.number ?? null,
    headSha: classified.head_sha,
    findings: findingMap,
  };
}

function validateDeduplicatedFindings(deduplicated, findings) {
  if (!isRecord(deduplicated)) {
    addFinding(
      findings,
      "PreReviewSubmitGate.deduplicated_findings is missing or malformed.",
      "preserve the complete DeduplicatedReviewFindings handoff",
    );
    return null;
  }

  if (
    deduplicated.schema !== "DeduplicatedReviewFindings" ||
    deduplicated.version !== 1
  ) {
    addFinding(
      findings,
      "DeduplicatedReviewFindings is not the supported version-1 handoff.",
      "preserve one version-1 DeduplicatedReviewFindings handoff",
    );
  }
  if (!["deduplicated", "partial"].includes(deduplicated.status)) {
    addFinding(
      findings,
      "DeduplicatedReviewFindings.status is not usable.",
      "complete the deterministic deduplication handoff before publication",
    );
  }

  const findingMap = new Map();
  if (!Array.isArray(deduplicated.findings)) {
    addFinding(
      findings,
      "DeduplicatedReviewFindings.findings is missing or malformed.",
      "preserve active deduplicated findings as a list",
    );
  } else {
    for (const finding of deduplicated.findings) {
      if (!isRecord(finding) || !isNonEmptyString(finding.id)) {
        addFinding(
          findings,
          "DeduplicatedReviewFindings contains a finding without a stable ID.",
          "preserve stable IDs for every deduplicated finding",
        );
        continue;
      }
      if (findingMap.has(finding.id)) {
        addFinding(
          findings,
          "DeduplicatedReviewFindings contains a duplicate finding ID.",
          "preserve each active finding exactly once",
        );
        continue;
      }
      if (!Array.isArray(finding.merged_from)) {
        addFinding(
          findings,
          `DeduplicatedReviewFindings.finding ${safeLabel(finding.id)}.merged_from is malformed.`,
          "preserve the deduplication provenance list",
        );
      }
      findingMap.set(finding.id, finding);
    }
  }

  const suppressedIds = new Set();
  if (!Array.isArray(deduplicated.suppressed)) {
    addFinding(
      findings,
      "DeduplicatedReviewFindings.suppressed is missing or malformed.",
      "preserve the auditable suppressed-duplicate list",
    );
  } else {
    for (const suppressed of deduplicated.suppressed) {
      if (!isRecord(suppressed) || !isNonEmptyString(suppressed.id)) {
        addFinding(
          findings,
          "DeduplicatedReviewFindings contains a suppressed entry without an ID.",
          "preserve stable IDs for suppressed findings",
        );
        continue;
      }
      if (suppressedIds.has(suppressed.id)) {
        addFinding(
          findings,
          "DeduplicatedReviewFindings contains a duplicate suppressed finding ID.",
          "record each suppressed finding exactly once",
        );
      }
      suppressedIds.add(suppressed.id);
      if (!VALID_SUPPRESSION_DISPOSITIONS.has(suppressed.disposition)) {
        addFinding(
          findings,
          `Suppressed finding ${safeLabel(suppressed.id)} has an unsupported disposition.`,
          "preserve the verified duplicate or discussion disposition",
        );
      }
      if (
        suppressed.disposition === "merged_into" &&
        !isNonEmptyString(suppressed.merged_into)
      ) {
        addFinding(
          findings,
          `Suppressed finding ${safeLabel(suppressed.id)} has no merge survivor.`,
          "preserve the survivor finding ID for a merged duplicate",
        );
      }
    }
  }

  return {
    repository: deduplicated.repository,
    pullRequestNumber: deduplicated.pull_request?.number ?? null,
    headSha: deduplicated.head_sha,
    findings: findingMap,
    suppressedIds,
  };
}

function validateConfirmation(confirmation, findings) {
  if (!isRecord(confirmation)) {
    addFinding(
      findings,
      "PreReviewSubmitGate.confirmation is missing or malformed.",
      "preserve the exact confirmation record",
    );
    return null;
  }
  if (!validateRepositoryName(confirmation.repository)) {
    addFinding(
      findings,
      "Review confirmation repository identity is missing or malformed.",
      "bind confirmation to the verified owner/repository",
    );
  }
  if (
    !Number.isInteger(confirmation.pull_request_number) ||
    confirmation.pull_request_number < 1
  ) {
    addFinding(
      findings,
      "Review confirmation pull-request number is missing or malformed.",
      "bind confirmation to one positive pull-request number",
    );
  }
  if (!isSha(confirmation.head_sha)) {
    addFinding(
      findings,
      "Review confirmation head SHA is missing or malformed.",
      "bind confirmation to the verified pull-request head SHA",
    );
  }
  if (!isIsoTimestamp(confirmation.confirmed_at)) {
    addFinding(
      findings,
      "Review confirmation timestamp is missing or malformed.",
      "preserve the confirmation timestamp",
    );
  }

  const entries = new Map();
  if (!Array.isArray(confirmation.entries)) {
    addFinding(
      findings,
      "Review confirmation entries are missing or malformed.",
      "record one explicit confirmation decision per included finding",
    );
  } else {
    for (const entry of confirmation.entries) {
      if (!isRecord(entry) || !isNonEmptyString(entry.finding_id)) {
        addFinding(
          findings,
          "Review confirmation contains an entry without a finding ID.",
          "preserve stable IDs for each confirmation decision",
        );
        continue;
      }
      if (entries.has(entry.finding_id)) {
        addFinding(
          findings,
          "Review confirmation contains a duplicate finding ID.",
          "record one confirmation decision per finding",
        );
      }
      if (!VALID_CONFIRMATION_DECISIONS.has(entry.decision)) {
        addFinding(
          findings,
          `Review confirmation for ${safeLabel(entry.finding_id)} has an unsupported decision.`,
          "confirm the finding as change_request, suggestion, or modify",
        );
      }
      if (entry.confirmed !== true) {
        addFinding(
          findings,
          `Review finding ${safeLabel(entry.finding_id)} was not explicitly confirmed.`,
          "record explicit user or repository-policy confirmation for this exact finding",
        );
      }
      entries.set(entry.finding_id, entry);
    }
  }

  return {
    repository: confirmation.repository,
    pullRequestNumber: confirmation.pull_request_number,
    headSha: confirmation.head_sha,
    entries,
  };
}

function validateFreshness(freshness, findings) {
  if (!isRecord(freshness)) {
    addFinding(
      findings,
      "PreReviewSubmitGate.freshness is missing or malformed.",
      "run the live pull-request and inline-location preflight again",
    );
    return null;
  }
  if (!isSha(freshness.head_sha)) {
    addFinding(
      findings,
      "Review freshness head SHA is missing or malformed.",
      "bind freshness evidence to the current pull-request head SHA",
    );
  }
  if (freshness.pull_request_state !== "open") {
    addFinding(
      findings,
      "Review freshness does not prove that the pull request is open.",
      "reload the pull request and preserve its current open state",
    );
  }
  if (!isIsoTimestamp(freshness.verified_at)) {
    addFinding(
      findings,
      "Review freshness timestamp is missing or malformed.",
      "record the live pre-publication verification time",
    );
  }

  const findingEntries = new Map();
  if (!Array.isArray(freshness.findings)) {
    addFinding(
      findings,
      "Review freshness finding evidence is missing or malformed.",
      "record one current-head freshness result per included finding",
    );
  } else {
    for (const entry of freshness.findings) {
      if (!isRecord(entry) || !isNonEmptyString(entry.finding_id)) {
        addFinding(
          findings,
          "Review freshness contains a finding entry without an ID.",
          "preserve stable finding IDs in freshness evidence",
        );
        continue;
      }
      if (findingEntries.has(entry.finding_id)) {
        addFinding(
          findings,
          "Review freshness contains a duplicate finding ID.",
          "record one freshness result per finding",
        );
      }
      if (!isSha(entry.head_sha) || entry.valid !== true) {
        addFinding(
          findings,
          `Review freshness for ${safeLabel(entry.finding_id)} is not valid.`,
          "rerun the live current-head finding preflight",
        );
      }
      findingEntries.set(entry.finding_id, entry);
    }
  }

  const inlineEntries = new Map();
  if (!Array.isArray(freshness.inline_comments)) {
    addFinding(
      findings,
      "Review freshness inline-comment evidence is missing or malformed.",
      "record one current-diff location result per inline comment",
    );
  } else {
    for (const entry of freshness.inline_comments) {
      const pathValue = normalizeRelativePath(entry?.path);
      if (
        !isRecord(entry) ||
        !isNonEmptyString(entry.finding_id) ||
        pathValue === null ||
        !Number.isInteger(entry.line) ||
        entry.line < 1 ||
        !INLINE_SIDES.has(entry.side)
      ) {
        addFinding(
          findings,
          "Review freshness contains a malformed inline-comment location.",
          "preserve the exact verified path, line, and side",
        );
        continue;
      }
      const key = `${entry.finding_id}\u0000${pathValue}\u0000${entry.line}\u0000${entry.side}`;
      if (inlineEntries.has(key)) {
        addFinding(
          findings,
          "Review freshness contains a duplicate inline-comment location.",
          "record each inline location exactly once",
        );
      }
      if (!isSha(entry.head_sha) || entry.valid !== true) {
        addFinding(
          findings,
          `Review freshness for inline finding ${safeLabel(entry.finding_id)} is not valid.`,
          "rerun the current-diff inline-location preflight",
        );
      }
      inlineEntries.set(key, {
        findingId: entry.finding_id,
        path: pathValue,
        line: entry.line,
        side: entry.side,
        headSha: entry.head_sha,
      });
    }
  }

  return {
    headSha: freshness.head_sha,
    findingEntries,
    inlineEntries,
  };
}

function compareIdentity(label, actual, expected, findings) {
  if (
    isNonEmptyString(actual) &&
    isNonEmptyString(expected) &&
    normalizeRepository(actual) !== normalizeRepository(expected)
  ) {
    addFinding(
      findings,
      `${label} does not match the approved review repository.`,
      "refresh every review handoff for one verified repository",
    );
  }
}

function compareHead(label, actual, expected, findings) {
  if (isSha(actual) && isSha(expected) && actual.toLowerCase() !== expected.toLowerCase()) {
    addFinding(
      findings,
      `${label} does not match the approved pull-request head SHA.`,
      "rerun the review workflow against the current pull-request head",
    );
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function expectedApiPayload(decision) {
  return {
    commit_id: decision.head_sha,
    body: decision.summary,
    event: decision.proposed_event,
    comments: decision.inline_comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: comment.side,
      body: comment.body,
    })),
  };
}

function validatePayload(payload, decision, findings) {
  if (!isRecord(payload)) {
    addFinding(
      findings,
      "The review payload is missing or not a JSON object.",
      "pass the exact approved review API payload",
    );
    return;
  }

  const expected = expectedApiPayload(decision);
  if (stableStringify(payload) !== stableStringify(expected)) {
    addFinding(
      findings,
      "The review API payload differs from the exact approved ReviewDecision.",
      "use the approved commit, event, body, and inline comments without rewriting",
    );
  }
}

function validateCrossEvidence(
  context,
  repositoryRoot,
  branch,
  commandEndpoint,
  livePullRequest,
  findings,
) {
  const {
    gate,
    decision,
    classified,
    deduplicated,
    confirmation,
    freshness,
  } = context;

  if (isRecord(gate.workspace)) {
    if (
      !isNonEmptyString(gate.workspace.path) ||
      !isAbsolute(gate.workspace.path) ||
      normalizeAbsolutePath(gate.workspace.path) !== normalizeAbsolutePath(repositoryRoot)
    ) {
      addFinding(
        findings,
        "PreReviewSubmitGate.workspace.path does not match the live Git root.",
        "run review publication from the verified repository worktree",
      );
    }
    if (
      isNonEmptyString(gate.workspace.repository) &&
      normalizeRepository(gate.workspace.repository) !==
        normalizeRepository(commandEndpoint.repository)
    ) {
      addFinding(
        findings,
        "PreReviewSubmitGate.workspace.repository does not match the review endpoint.",
        "refresh the gate for the exact review repository",
      );
    }
    if (
      isNonEmptyString(gate.workspace.branch) &&
      isNonEmptyString(branch) &&
      gate.workspace.branch !== branch
    ) {
      addFinding(
        findings,
        "PreReviewSubmitGate.workspace.branch does not match the live branch.",
        "refresh the gate from the verified worktree",
      );
    }
  }

  if (decision !== null) {
    compareIdentity(
      "ReviewDecision.repository",
      decision.repository,
      commandEndpoint.repository,
      findings,
    );
    if (decision.pullRequestNumber !== commandEndpoint.number) {
      addFinding(
        findings,
        "ReviewDecision pull-request number does not match the review endpoint.",
        "use the exact approved pull-request target",
      );
    }
    compareHead(
      "ReviewDecision.head_sha",
      decision.headSha,
      livePullRequest.headRefOid,
      findings,
    );
    if (
      isNonEmptyString(decision.pullRequestUrl) &&
      isNonEmptyString(livePullRequest.url) &&
      normalizeReviewUrl(decision.pullRequestUrl) !==
        normalizeReviewUrl(livePullRequest.url)
    ) {
      addFinding(
        findings,
        "ReviewDecision.pull_request.url does not match the live pull request.",
        "refresh the exact pull-request identity before publication",
      );
    }
  }

  for (const [label, value] of [
    ["ClassifiedReviewFindings.repository", classified?.repository],
    ["DeduplicatedReviewFindings.repository", deduplicated?.repository],
    ["Review confirmation.repository", confirmation?.repository],
  ]) {
    compareIdentity(label, value, commandEndpoint.repository, findings);
  }
  for (const [label, value] of [
    ["ClassifiedReviewFindings.pull_request.number", classified?.pullRequestNumber],
    [
      "DeduplicatedReviewFindings.pull_request.number",
      deduplicated?.pullRequestNumber,
    ],
    ["Review confirmation.pull_request_number", confirmation?.pullRequestNumber],
  ]) {
    if (value !== null && value !== undefined && value !== commandEndpoint.number) {
      addFinding(
        findings,
        `${label} does not match the review endpoint.`,
        "refresh every review handoff for the exact pull request",
      );
    }
  }
  for (const [label, value] of [
    ["ClassifiedReviewFindings.head_sha", classified?.headSha],
    ["DeduplicatedReviewFindings.head_sha", deduplicated?.headSha],
    ["Review confirmation.head_sha", confirmation?.headSha],
    ["Review freshness.head_sha", freshness?.headSha],
  ]) {
    compareHead(label, value, livePullRequest.headRefOid, findings);
  }

  if (decision === null) {
    return;
  }

  const includedSet = new Set(decision.includedIds);
  const locationKeys = new Set();
  for (const findingId of decision.includedIds) {
    const classifiedFinding = classified?.findings.get(findingId);
    if (!classifiedFinding) {
      addFinding(
        findings,
        `Included finding ${safeLabel(findingId)} is missing from ClassifiedReviewFindings.`,
        "classify and preserve every included finding before publication",
      );
      continue;
    }

    const rawFinding = classifiedFinding.raw;
    if (rawFinding.status !== "proposed") {
      addFinding(
        findings,
        `Included finding ${safeLabel(findingId)} is not an active proposed finding.`,
        "include only an active finding confirmed for this review",
      );
    }
    if (rawFinding.needs_discussion !== false) {
      addFinding(
        findings,
        `Included finding ${safeLabel(findingId)} remains uncertain or needs discussion.`,
        "resolve the finding uncertainty before publication",
      );
    }
    if (
      rawFinding.severity === "blocker" &&
      (rawFinding.confidence === "low" ||
        !isNonEmptyString(rawFinding.evidence) ||
        rawFinding.needs_discussion !== false)
    ) {
      addFinding(
        findings,
        `Included blocker ${safeLabel(findingId)} is not supported by publishable evidence.`,
        "remove or resolve the blocker uncertainty before publication",
      );
    }
    if (classifiedFinding.location !== null) {
      const location = classifiedFinding.location;
      const locationKey = `${location.path}\u0000${location.startLine ?? ""}\u0000${location.side}`;
      if (locationKeys.has(locationKey)) {
        addFinding(
          findings,
          "Included findings contain a duplicate path, line, and side location.",
          "deduplicate the confirmed finding set before publication",
        );
      }
      locationKeys.add(locationKey);
      if (
        location.commitSha !== null &&
        isSha(location.commitSha) &&
        isSha(livePullRequest.headRefOid) &&
        location.commitSha.toLowerCase() !==
          livePullRequest.headRefOid.toLowerCase()
      ) {
        addFinding(
          findings,
          `Included finding ${safeLabel(findingId)} is bound to a stale commit.`,
          "rerun the finding against the current pull-request head",
        );
      }
    }

    const deduplicatedFinding = deduplicated?.findings.get(findingId);
    if (!deduplicatedFinding) {
      addFinding(
        findings,
        `Included finding ${safeLabel(findingId)} is missing from DeduplicatedReviewFindings.`,
        "preserve the deduplicated active finding before publication",
      );
    } else if (
      Array.isArray(deduplicatedFinding.merged_from) &&
      deduplicatedFinding.merged_from.some((id) => includedSet.has(id) && id !== findingId)
    ) {
      addFinding(
        findings,
        `Included finding ${safeLabel(findingId)} still contains an included duplicate in merged_from.`,
        "publish only the deduplicated survivor finding",
      );
    }
    if (deduplicated?.suppressedIds.has(findingId)) {
      addFinding(
        findings,
        `Included finding ${safeLabel(findingId)} is listed as suppressed.`,
        "remove suppressed duplicates from the approved finding set",
      );
    }

    const confirmationEntry = confirmation?.entries.get(findingId);
    if (!confirmationEntry || confirmationEntry.confirmed !== true) {
      addFinding(
        findings,
        `Included finding ${safeLabel(findingId)} lacks explicit confirmation.`,
        "confirm this exact finding before publication",
      );
    }
    const freshnessEntry = freshness?.findingEntries.get(findingId);
    if (
      !freshnessEntry ||
      freshnessEntry.valid !== true ||
      !isSha(freshnessEntry.head_sha) ||
      !isSha(livePullRequest.headRefOid) ||
      freshnessEntry.head_sha.toLowerCase() !==
        livePullRequest.headRefOid.toLowerCase()
    ) {
      addFinding(
        findings,
        `Included finding ${safeLabel(findingId)} has stale or incomplete freshness evidence.`,
        "rerun the live finding freshness preflight",
      );
    }
  }

  if (freshness !== null && freshness.findingEntries.size !== includedSet.size) {
    addFinding(
      findings,
      "Review freshness does not contain exactly the approved finding set.",
      "write freshness evidence for every exact included finding",
    );
  }
  if (freshness !== null) {
    for (const findingId of freshness.findingEntries.keys()) {
      if (!includedSet.has(findingId)) {
        addFinding(
          findings,
          "Review freshness contains a finding outside the approved included set.",
          "preserve freshness for exactly the findings being published",
        );
      }
    }
  }

  if (confirmation !== null) {
    if (confirmation.entries.size !== decision.includedIds.length) {
      addFinding(
        findings,
        "Review confirmation does not contain exactly one entry per included finding.",
        "record confirmation for the exact included finding set",
      );
    }
    for (const findingId of confirmation.entries.keys()) {
      if (!includedSet.has(findingId)) {
        addFinding(
          findings,
          "Review confirmation contains a finding outside the approved included set.",
          "preserve confirmation for exactly the findings being published",
        );
      }
    }
  }

  const inlineKeys = new Set();
  const inlineComments = decision.inlineComments;
  for (const comment of inlineComments) {
    const pathValue = normalizeRelativePath(comment?.path);
    if (
      !isRecord(comment) ||
      !isNonEmptyString(comment.finding_id) ||
      pathValue === null ||
      !Number.isInteger(comment.line) ||
      comment.line < 1 ||
      !INLINE_SIDES.has(comment.side) ||
      !isNonEmptyString(comment.body)
    ) {
      addFinding(
        findings,
        "ReviewDecision contains an invalid inline-comment location or body.",
        "preserve one valid path, line, side, and body for every inline comment",
      );
      continue;
    }
    if (!includedSet.has(comment.finding_id)) {
      addFinding(
        findings,
        "ReviewDecision contains an inline comment for a finding that is not included.",
        "include only comments belonging to confirmed findings",
      );
    }
    const key = `${comment.finding_id}\u0000${pathValue}\u0000${comment.line}\u0000${comment.side}`;
    if (inlineKeys.has(key)) {
      addFinding(
        findings,
        "ReviewDecision contains duplicate inline-comment locations.",
        "include each inline-comment location exactly once",
      );
    }
    inlineKeys.add(key);

    const classifiedFinding = classified?.findings.get(comment.finding_id);
    const findingLocation = classifiedFinding?.location;
    if (
      findingLocation !== null &&
      findingLocation !== undefined &&
      (findingLocation.path !== pathValue ||
        (findingLocation.startLine !== null &&
          comment.line < findingLocation.startLine) ||
        (findingLocation.endLine !== null &&
          comment.line > findingLocation.endLine) ||
        (findingLocation.side !== "unknown" &&
          findingLocation.side !== comment.side))
    ) {
      addFinding(
        findings,
        `Inline comment for ${safeLabel(comment.finding_id)} does not match its approved finding location.`,
        "preserve the exact verified location from the finding",
      );
    }

    const freshnessEntry = freshness?.inlineEntries.get(key);
    if (
      !freshnessEntry ||
      !isSha(freshnessEntry.headSha) ||
      !isSha(livePullRequest.headRefOid) ||
      freshnessEntry.headSha.toLowerCase() !==
        livePullRequest.headRefOid.toLowerCase()
    ) {
      addFinding(
        findings,
        `Inline comment for ${safeLabel(comment.finding_id)} is stale or lacks current-diff evidence.`,
        "rerun the live inline-location preflight",
      );
    }
  }

  if (freshness !== null && freshness.inlineEntries.size !== inlineKeys.size) {
    addFinding(
      findings,
      "Review freshness does not contain exactly the approved inline-comment set.",
      "write freshness evidence for every exact inline comment",
    );
  }
}

function normalizeReviewUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(value).replace(/\/+$/, "").toLowerCase();
  }
}

function readGate(repositoryRoot, findings) {
  const gatePath = resolve(repositoryRoot, ...GATE_RELATIVE_PATH.split("/"));
  try {
    const fileStats = statSync(gatePath);
    if (!fileStats.isFile() || fileStats.size > MAX_FILE_BYTES) {
      throw new Error("invalid gate file");
    }
    return JSON.parse(readFileSync(gatePath, "utf8"));
  } catch {
    addFinding(
      findings,
      `The local PreReviewSubmitGate is missing, too large, unreadable, or invalid at ${GATE_RELATIVE_PATH}.`,
      "write and verify a fresh PreReviewSubmitGate before review publication",
    );
    return null;
  }
}

function readLivePullRequest(workingDirectory, endpoint, decision, findings) {
  if (!validateRepositoryName(endpoint.repository) || !Number.isInteger(endpoint.number)) {
    return null;
  }

  let output;
  try {
    output = runGh(
      workingDirectory,
      [
        "pr",
        "view",
        String(endpoint.number),
        "--repo",
        endpoint.repository,
        "--json",
        "headRefOid,state,url",
      ],
    );
  } catch {
    addFinding(
      findings,
      "The live pull-request identity could not be read with gh pr view.",
      "refresh GitHub access and rerun the review preflight",
    );
    return null;
  }

  let value;
  try {
    value = JSON.parse(output);
  } catch {
    addFinding(
      findings,
      "The live pull-request response was not valid JSON.",
      "rerun gh pr view for the exact pull request",
    );
    return null;
  }

  const state = typeof value.state === "string" ? value.state.toLowerCase() : null;
  if (state !== "open") {
    addFinding(
      findings,
      "The target pull request is not open.",
      "publish only to the verified open pull request",
    );
  }
  if (!isSha(value.headRefOid)) {
    addFinding(
      findings,
      "The live pull request has no verifiable head SHA.",
      "reload the pull request and preserve its current head identity",
    );
  }
  if (!isHttpUrl(value.url)) {
    addFinding(
      findings,
      "The live pull request has no verifiable canonical URL.",
      "reload the exact pull-request identity before publication",
    );
  }
  if (
    decision?.pullRequestUrl &&
    isNonEmptyString(value.url) &&
    normalizeReviewUrl(decision.pullRequestUrl) !== normalizeReviewUrl(value.url)
  ) {
    addFinding(
      findings,
      "The live pull-request URL differs from the approved review target.",
      "refresh the exact review target before publication",
    );
  }

  return {
    state,
    headRefOid: value.headRefOid,
    url: value.url,
  };
}

function validateGate(gate, findings) {
  if (!isRecord(gate)) {
    addFinding(
      findings,
      "PreReviewSubmitGate is missing or malformed.",
      "write a fresh version-1 PreReviewSubmitGate",
    );
    return {
      gate,
      decision: null,
      classified: null,
      deduplicated: null,
      confirmation: null,
      freshness: null,
    };
  }

  if (gate.schema !== "PreReviewSubmitGate" || gate.version !== 1) {
    addFinding(
      findings,
      "PreReviewSubmitGate has an unsupported schema version.",
      "write a fresh version-1 PreReviewSubmitGate",
    );
  }
  if (!isIsoTimestamp(gate.written_at)) {
    addFinding(
      findings,
      "PreReviewSubmitGate.written_at is missing or malformed.",
      "write a fresh current PreReviewSubmitGate",
    );
  }
  if (
    !isRecord(gate.workspace) ||
    !validateRepositoryName(gate.workspace.repository) ||
    !isNonEmptyString(gate.workspace.path) ||
    !isAbsolute(gate.workspace.path)
  ) {
    addFinding(
      findings,
      "PreReviewSubmitGate.workspace is missing or malformed.",
      "preserve the verified repository and absolute worktree path",
    );
  }

  const decision = validateReviewDecision(gate.review_decision, findings);
  const classified = validateClassifiedFindings(
    gate.classified_findings,
    findings,
  );
  const deduplicated = validateDeduplicatedFindings(
    gate.deduplicated_findings,
    findings,
  );
  const confirmation = validateConfirmation(gate.confirmation, findings);
  const freshness = validateFreshness(gate.freshness, findings);

  return {
    gate,
    decision,
    classified,
    deduplicated,
    confirmation,
    freshness,
  };
}

function likelyReviewPublication(command) {
  return /\bgh(?:\.exe|\.cmd|\.bat)?\s+(?:pr\s+review\b|api\b[\s\S]*\/pulls\/[1-9]\d*\/reviews\b)/i.test(
    command,
  );
}

function evaluate(input) {
  const command =
    typeof input.command === "string"
      ? input.command
      : isRecord(input.tool_input) && typeof input.tool_input.command === "string"
        ? input.tool_input.command
        : null;

  if (command === null) {
    return makeDeny([
      {
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
  const identified = identifyReviewInvocations(command, initialDirectory);

  if (identified.invocations.length === 0) {
    if (!identified.parseable && likelyReviewPublication(command)) {
      return makeDeny([
        {
          requirement:
            identified.reason ??
            "The review publication command could not be parsed safely.",
          nextStep: "run one explicit, parseable canonical review API command",
        },
      ]);
    }
    return makeAllow();
  }

  const findings = [];
  if (!identified.parseable) {
    addFinding(
      findings,
      identified.reason ??
        "The review publication command could not be parsed safely.",
      "run one explicit, parseable canonical review API command",
    );
  }
  if (identified.invocations.length > 1) {
    addFinding(
      findings,
      "The shell command contains more than one review publication invocation.",
      "run exactly one approved review publication command",
    );
  }

  const invocation = identified.invocations[0];
  if (invocation.parseError) {
    addFinding(
      findings,
      invocation.parseError,
      "run the review command from the verified repository worktree",
    );
  }
  if (!isNonEmptyString(initialDirectory) || !existsSync(invocation.targetDirectory)) {
    addFinding(
      findings,
      "The review publication working directory is missing or unverifiable.",
      "run the command from the verified repository worktree",
    );
    return makeDeny(findings);
  }

  if (invocation.kind === "pr-review") {
    addFinding(
      findings,
      "gh pr review is not the canonical review publication path.",
      "use gh api --method POST --input with the exact reviews endpoint",
    );
    return makeDeny(findings);
  }

  const api = parseApiArguments(invocation.args, invocation.endpoint, findings);
  let repositoryRoot;
  let branch;
  try {
    repositoryRoot = runGit(invocation.targetDirectory, ["rev-parse", "--show-toplevel"]);
    branch = runGit(invocation.targetDirectory, ["branch", "--show-current"]);
  } catch {
    addFinding(
      findings,
      "The live Git repository identity could not be verified.",
      "run the review publication from a verified Git worktree",
    );
    return makeDeny(findings);
  }

  const gate = readGate(repositoryRoot, findings);
  const context = validateGate(gate, findings);
  const livePullRequest = readLivePullRequest(
    invocation.targetDirectory,
    invocation.endpoint,
    context.decision,
    findings,
  );

  if (livePullRequest !== null) {
    validateCrossEvidence(
      context,
      repositoryRoot,
      branch,
      invocation.endpoint,
      livePullRequest,
      findings,
    );
  }

  const payloadPath =
    isNonEmptyString(api.inputPath) && !api.inputPath.includes("\0")
      ? isAbsolute(api.inputPath)
        ? api.inputPath
        : resolve(invocation.targetDirectory, api.inputPath)
      : null;
  const payload =
    payloadPath === null
      ? null
      : readJsonFile(payloadPath, "The review API payload", findings);
  if (payload !== null && context.gate?.review_decision) {
    validatePayload(payload.value, context.gate.review_decision, findings);
  }

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

function main() {
  let input;
  try {
    input = readHookInput();
  } catch {
    const result = makeDeny([
      {
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
        requirement: `The deterministic pre-review-submit check failed closed with ${errorType}.`,
        nextStep: "verify the review handoffs, current pull-request identity, and canonical command",
      },
    ]);
  }

  writeResponse(input, result);
  if (result.decision === "deny") {
    process.exitCode = 2;
  }
}

main();
