import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";

import { readHookInput } from "./lib/read-hook-input.mjs";
import { claimGate, CANONICAL_STATE_RELATIVE_PATH } from "./lib/gate-state.mjs";
import { runCommand as runBoundedCommand } from "./lib/run-command.mjs";

const GATE_FILE_NAME = "pre-pr-ready.json";
const GATE_RELATIVE_PATH = `${CANONICAL_STATE_RELATIVE_PATH}${GATE_FILE_NAME}`;
const MAX_GATE_BYTES = 2 * 1024 * 1024;
const ALLOWED_AUTHORIZATION_SOURCES = new Set([
  "explicit_user",
  "repository_policy",
]);
const SAFE_BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SAFE_LOGIN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_TEAM = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_TEAM_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REVIEW_PAYLOAD_MAX_BYTES = 512 * 1024;
const SHELL_SEPARATORS = new Set([";", "&&", "||", "|", "&", "(", ")"]);

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

function executableName(value) {
  return value?.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase();
}

function isGhCommand(segment, firstIndex) {
  return ["gh", "gh.exe", "gh.cmd", "gh.bat"].includes(
    executableName(segment[firstIndex]),
  );
}

function parseReviewersEndpoint(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const match = value.match(
    /^repos\/([^/\s]+)\/([^/\s]+)\/pulls\/([1-9]\d*)\/requested_reviewers$/,
  );
  if (match === null) {
    return null;
  }
  return {
    repository: `${match[1]}/${match[2]}`,
    number: Number(match[3]),
  };
}

function likelyReadyCommand(command) {
  return /\bgh(?:\.exe|\.cmd|\.bat)?\b[\s\S]*\bpr\s+ready\b/i.test(command)
    || /\brequested_reviewers\b/i.test(command);
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
  const hasShellSeparator = tokens.some((token) => SHELL_SEPARATORS.has(token));
  for (const segment of splitCommandSegments(tokens)) {
    if (segment.length === 0) {
      continue;
    }
    if (!isGhCommand(segment, 0)) {
      continue;
    }
    const commandName = segment[1]?.toLowerCase();
    const subcommand = segment[2]?.toLowerCase();
    if (commandName === "pr" && subcommand === "ready") {
      invocations.push({
        kind: "pr-ready",
        targetDirectory: resolve(initialDirectory),
        args: segment.slice(3),
      });
      continue;
    }
    if (commandName === "api") {
      const args = segment.slice(2);
      if (args.some((argument) => /requested_reviewers/i.test(argument))) {
        invocations.push({
          kind: "api-reviewers",
          targetDirectory: resolve(initialDirectory),
          args,
        });
      }
    }
  }

  return { invocations, hasShellSeparator, parseable: true, reason: null };
}

function parseReadyArgs(args, findings) {
  if (
    args.length !== 3 ||
    !/^[1-9]\d*$/.test(args[0] ?? "") ||
    args[1] !== "--repo" ||
    !validateRepositoryName(args[2])
  ) {
    addFinding(
      findings,
      "The Ready-for-Review command is not the exact canonical gh pr ready operation.",
      "run exactly gh pr ready <number> --repo <owner>/<repo> with no URL, wrapper, or extra argument",
    );
    return { repository: null, number: null };
  }
  return { repository: args[2], number: Number(args[0]) };
}

function parseReviewerArgs(args, findings) {
  const endpoint = parseReviewersEndpoint(args[0]);
  if (
    args.length !== 5 ||
    endpoint === null ||
    args[1] !== "--method" ||
    args[2] !== "POST" ||
    args[3] !== "--input" ||
    !isNonEmptyString(args[4]) ||
    args[4] === "-" ||
    args[4].startsWith("-")
  ) {
    addFinding(
      findings,
      "The reviewer operation is not the exact canonical requested_reviewers POST operation.",
      "run exactly gh api repos/<owner>/<repo>/pulls/<number>/requested_reviewers --method POST --input <payload-file>",
    );
    return {
      repository: endpoint?.repository ?? null,
      number: endpoint?.number ?? null,
      payloadPath: null,
    };
  }
  return { repository: endpoint.repository, number: endpoint.number, payloadPath: args[4] };
}

function readGate(repositoryRoot, findings, expectedOperation) {
  const claim = claimGate(repositoryRoot, GATE_FILE_NAME, expectedOperation);
  if (claim.gate !== null) return claim.gate;
  addFinding(
    findings,
    `The local PrePrReadyGate could not be claimed from ${GATE_RELATIVE_PATH}: ${claim.error ?? "unknown lifecycle error"}.`,
    "run the matching mark-pr-ready preflight and write a fresh one-shot PrePrReadyGate",
  );
  return null;
}

function reviewerKey(reviewer) {
  return `${String(reviewer.kind).toLowerCase()}:${String(reviewer.login).toLowerCase()}`;
}

function validateReviewers(reviewers, repository, findings) {
  if (!isRecord(reviewers) || !Array.isArray(reviewers.add)) {
    addFinding(
      findings,
      "PrePrReadyGate.reviewers.add is missing or malformed.",
      "preserve the exact authorized reviewer set, which may be empty",
    );
    return [];
  }
  const add = [];
  const seen = new Set();
  const repositoryOwner = repository.split("/")[0].toLowerCase();
  for (const entry of reviewers.add) {
    if (
      !isRecord(entry) ||
      (entry.kind !== "user" && entry.kind !== "team") ||
      !isNonEmptyString(entry.login) ||
      JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["kind", "login"])
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
        "PrePrReadyGate.reviewers.add contains an unsafe reviewer identity.",
        "request only exact confirmed GitHub user or team logins",
      );
      continue;
    }
    if (entry.kind === "team" && entry.login.split("/")[0].toLowerCase() !== repositoryOwner) {
      addFinding(
        findings,
        "PrePrReadyGate.reviewers.add contains a team from a different organization.",
        "use only a team belonging to the pull-request repository organization",
      );
      continue;
    }
    const key = reviewerKey(entry);
    if (seen.has(key)) {
      addFinding(
        findings,
        "PrePrReadyGate.reviewers.add contains a duplicate reviewer identity.",
        "include each authorized user or team exactly once",
      );
      continue;
    }
    seen.add(key);
    add.push({ kind: entry.kind, login: entry.login });
  }
  return add;
}

function validateGate(gate, repositoryRoot, findings, expectedOperation) {
  if (!isRecord(gate)) {
    addFinding(
      findings,
      "PrePrReadyGate is not a JSON object.",
      "write a complete version-2 PrePrReadyGate snapshot",
    );
    return null;
  }
  if (gate.schema !== "PrePrReadyGate") {
    addFinding(
      findings,
      "The local snapshot is not a PrePrReadyGate.",
      "write the Ready-for-Review gate, not a different host gate",
    );
  }
  if (gate.version !== 2) {
    addFinding(
      findings,
      "PrePrReadyGate.version is not 2.",
      "write a current version-2 PrePrReadyGate",
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
  if (normalizeRepository(workspace?.repository) !== normalizeRepository(pullRequest.repository)) {
    addFinding(
      findings,
      "PrePrReadyGate workspace and pull-request repositories differ.",
      "write one gate for the exact repository and worktree",
    );
  }
  if (!isSha(gate.expected_head_sha)) {
    addFinding(
      findings,
      "PrePrReadyGate.expected_head_sha is missing or not a full Git SHA.",
      "bind the current pull-request head SHA",
    );
  }
  const expectedDraft = expectedOperation === "pre-pr-ready";
  if (gate.is_draft !== expectedDraft) {
    addFinding(
      findings,
      `PrePrReadyGate.is_draft must be ${expectedDraft ? "true" : "false"} for ${expectedOperation ?? "this"}.`,
      expectedDraft
        ? "mark ready only from an authorized current Draft snapshot"
        : "request reviewers only from an authorized non-Draft snapshot",
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
  const reviewers = validateReviewers(gate.reviewers, pullRequest.repository, findings);
  if (findings.length > 0) {
    return null;
  }
  return {
    repository: pullRequest.repository,
    pullRequest,
    linkedIssue,
    expectedHeadSha: gate.expected_head_sha,
    reviewers,
    workspace,
  };
}

function normalizedIdentity(value) {
  return value.toLowerCase();
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function readReviewerPayload(workingDirectory, payloadPath, findings) {
  const absolutePayloadPath = isAbsolute(payloadPath)
    ? payloadPath
    : resolve(workingDirectory, payloadPath);
  try {
    const stats = statSync(absolutePayloadPath);
    if (!stats.isFile() || stats.size > REVIEW_PAYLOAD_MAX_BYTES) {
      throw new Error("invalid reviewer payload");
    }
    const payload = JSON.parse(readFileSync(absolutePayloadPath, "utf8"));
    if (
      !isRecord(payload) ||
      JSON.stringify(Object.keys(payload).sort()) !==
        JSON.stringify(["reviewers", "team_reviewers"]) ||
      !Array.isArray(payload.reviewers) ||
      !Array.isArray(payload.team_reviewers)
    ) {
      throw new Error("invalid reviewer payload shape");
    }

    const reviewers = payload.reviewers;
    const teamReviewers = payload.team_reviewers;
    const users = new Set();
    const teams = new Set();
    for (const reviewer of reviewers) {
      if (typeof reviewer !== "string" || !SAFE_LOGIN.test(reviewer)) {
        throw new Error("invalid reviewer identity");
      }
      const normalized = normalizedIdentity(reviewer);
      if (users.has(normalized)) {
        throw new Error("duplicate reviewer identity");
      }
      users.add(normalized);
    }
    for (const team of teamReviewers) {
      if (typeof team !== "string" || !SAFE_TEAM_SLUG.test(team)) {
        throw new Error("invalid team identity");
      }
      const normalized = normalizedIdentity(team);
      if (teams.has(normalized)) {
        throw new Error("duplicate team identity");
      }
      teams.add(normalized);
    }
    return { users, teams };
  } catch {
    addFinding(
      findings,
      "The reviewer payload is missing, unreadable, malformed, or contains duplicate or unsafe identities.",
      "provide one regular JSON payload with exactly reviewers and team_reviewers arrays",
    );
    return null;
  }
}

function compareReviewerPayload(payload, context, findings) {
  if (payload === null) {
    return;
  }
  const expectedUsers = new Set();
  const expectedTeams = new Set();
  for (const reviewer of context.reviewers) {
    if (reviewer.kind === "user") {
      expectedUsers.add(normalizedIdentity(reviewer.login));
    } else {
      expectedTeams.add(normalizedIdentity(reviewer.login.split("/")[1]));
    }
  }
  if (!sameSet(payload.users, expectedUsers) || !sameSet(payload.teams, expectedTeams)) {
    addFinding(
      findings,
      "The reviewer payload does not exactly match the authorized typed reviewer set.",
      "send exactly the authorized users in reviewers and teams in team_reviewers",
    );
  }
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
      "number,url,state,isDraft,baseRefName,headRefName,headRefOid,closingIssuesReferences",
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
    addFinding(
      findings,
      "The live pull-request response is missing or malformed.",
      "reload the exact pull request with complete identity and linked-issue fields",
    );
    return;
  }
  if (
    !Number.isInteger(livePullRequest.number) ||
    livePullRequest.number !== context.pullRequest.number
  ) {
    addFinding(
      findings,
      "The live pull-request identity differs from PrePrReadyGate.",
      "reload the exact authorized pull request",
    );
  }
  if (!isHttpUrl(livePullRequest.url) || livePullRequest.url !== context.pullRequest.url) {
    addFinding(
      findings,
      "The live pull-request URL differs from PrePrReadyGate.",
      "reload the exact authorized pull request URL",
    );
  }
  if (String(livePullRequest.state ?? "").toLowerCase() !== "open") {
    addFinding(
      findings,
      "The target pull request is no longer open.",
      "mark ready only the exact open Draft pull request",
    );
  }
  if (!isSafeBranchName(livePullRequest.baseRefName) || livePullRequest.baseRefName !== context.pullRequest.base_branch) {
    addFinding(
      findings,
      "The live pull-request base branch differs from PrePrReadyGate.",
      "reload the pull request for the exact authorized base branch",
    );
  }
  if (!isSafeBranchName(livePullRequest.headRefName) || livePullRequest.headRefName !== context.pullRequest.head_branch) {
    addFinding(
      findings,
      "The live pull-request head branch differs from PrePrReadyGate.",
      "reload the pull request for the exact authorized head branch",
    );
  }
  if (
    !isSha(livePullRequest.headRefOid) ||
    livePullRequest.headRefOid.toLowerCase() !== context.expectedHeadSha.toLowerCase()
  ) {
    addFinding(
      findings,
      "The live head SHA differs from PrePrReadyGate.expected_head_sha.",
      "refresh the authorized head SHA before marking the pull request ready",
    );
  }
  if (typeof livePullRequest.isDraft !== "boolean") {
    addFinding(
      findings,
      "The live pull-request Draft phase is missing or malformed.",
      "reload the exact pull request phase before writing",
    );
  }
  const linkedIssues = livePullRequest.closingIssuesReferences;
  if (!Array.isArray(linkedIssues) || linkedIssues.length !== 1) {
    addFinding(
      findings,
      "The live pull request does not expose exactly one linked issue.",
      "reload the pull request and preserve one unique authorized issue link",
    );
  } else {
    const liveIssue = linkedIssues[0];
    const liveIssueRepository =
      isRecord(liveIssue) && isRecord(liveIssue.repository)
        ? liveIssue.repository.nameWithOwner
        : null;
    if (
      !isRecord(liveIssue) ||
      !Number.isInteger(liveIssue.number) ||
      !isHttpUrl(liveIssue.url) ||
      !validateRepositoryName(liveIssueRepository) ||
      liveIssue.number !== context.linkedIssue.number ||
      liveIssue.url !== context.linkedIssue.url ||
      normalizeRepository(liveIssueRepository) !== normalizeRepository(context.linkedIssue.repository)
    ) {
      addFinding(
        findings,
        "The live linked issue differs from the unique issue bound by PrePrReadyGate.",
        "reload the exact pull-request issue relationship",
      );
    }
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
    if (likelyReadyCommand(command)) {
      return makeDeny([
        {
          key: "parse",
          requirement:
            identified.reason ??
            "The command appears to contain a Ready-for-Review write that cannot be identified safely.",
          nextStep: "run one direct, explicit, canonical Ready-for-Review operation",
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
  if (identified.hasShellSeparator) {
    addFinding(
      findings,
      "The shell command contains a compound or redirected operation.",
      "run exactly one standalone Ready-for-Review operation without shell separators or redirection",
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
    };
  } else {
    const parsed = parseReviewerArgs(invocation.args, findings);
    spec = {
      kind: "api-reviewers",
      repository: parsed.repository,
      number: parsed.number,
      payloadPath: parsed.payloadPath,
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
  if (findings.length > 0) {
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

  const expectedOperation = spec.kind === "pr-ready"
    ? "pre-pr-ready"
    : "pre-reviewer-request";
  const gate = readGate(repositoryRoot, findings, expectedOperation);
  if (gate === null) {
    return makeDeny(findings);
  }
  const context = validateGate(gate, repositoryRoot, findings, expectedOperation);
  if (context === null) {
    return makeDeny(findings);
  }
  compareCommandToGate(spec, context, findings);
  const reviewerPayload =
    spec.kind === "api-reviewers"
      ? readReviewerPayload(invocation.targetDirectory, spec.payloadPath, findings)
      : null;
  if (spec.kind === "api-reviewers") {
    compareReviewerPayload(reviewerPayload, context, findings);
  }
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
