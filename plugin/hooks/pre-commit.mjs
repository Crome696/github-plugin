import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve } from "node:path";

import { readHookInput } from "./lib/read-hook-input.mjs";
import { claimGate, CANONICAL_STATE_RELATIVE_PATH } from "./lib/gate-state.mjs";
import { loadRepositoryPolicy, policyEnforces } from "./lib/repository-policy.mjs";
import { runCommand as runBoundedCommand } from "./lib/run-command.mjs";

const GATE_FILE_NAME = "pre-commit.json";
const GATE_RELATIVE_PATH = `${CANONICAL_STATE_RELATIVE_PATH}${GATE_FILE_NAME}`;
const PRE_COMMIT_GATE_VERSION = 4;
const MAX_SCANNED_FILE_BYTES = 25 * 1024 * 1024;
const STAGED_INDEX_FINGERPRINT_FORMAT =
  "git-diff-cached-raw-z-no-renames-full-index-abbrev-40-v1";
const STAGED_INDEX_FINGERPRINT_ARGS = [
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
const ALLOWED_AUTHORIZATION_SOURCES = new Set([
  "explicit_user",
  "task_intent",
  "plan_build",
  "repository_policy",
  "session_continuity",
]);
const VALID_CHECK_RESULTS = new Set(["pass", "fail", "skipped", "not_run"]);
const VALID_CRITERION_RESULTS = new Set(["pass", "fail", "unverified"]);
const VALID_PLAN_STEP_RESULTS = new Set([
  "completed",
  "partial",
  "missing",
  "unexpected",
]);
const VALID_EVIDENCE_SOURCE_KINDS = new Set([
  "issue",
  "implementation_plan",
  "repository_policy",
  "external_capability",
]);
const VALID_EVIDENCE_STATUSES = new Set(["satisfied", "missing", "blocked"]);
const SECRET_CONTENT_PATTERNS = [
  {
    name: "private-key material",
    pattern: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i,
  },
  {
    name: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  {
    name: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    name: "credential-like assignment",
    pattern:
      /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret|private[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9/+_.-]{20,}/i,
  },
];
const SAFE_ENV_TEMPLATES = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
]);

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

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isIsoTimestamp(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
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
    segments.some((segment) => segment === ".." || segment === "." || segment.length === 0)
  ) {
    return null;
  }

  return segments.join("/");
}

function isWithinRoot(root, candidate) {
  const rootPath = normalizeAbsolutePath(root);
  const candidatePath = normalizeAbsolutePath(candidate);
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function formatPathList(paths) {
  const visible = paths.slice(0, 5);
  const suffix = paths.length > visible.length ? ` (+${paths.length - visible.length} more)` : "";
  return `${visible.join(", ")}${suffix}`;
}

function safeLabel(value) {
  return String(value).replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80);
}

function describeEvidenceRequirement(requirement) {
  const source = isRecord(requirement.source) ? requirement.source : {};
  const location = requirement.location === null ? "" : ` at ${safeLabel(requirement.location)}`;
  return `Explicit evidence requirement ${safeLabel(requirement.id)} (${safeLabel(requirement.requirement)}) from ${safeLabel(source.kind)}:${safeLabel(source.reference)} expects ${safeLabel(requirement.expected_kind)}${location} and is ${safeLabel(requirement.status)}.`;
}

function makeDeny(reason, nextStep) {
  return {
    decision: "deny",
    message:
      `AI commit blocked: ${reason} ` +
      `Next step: ${nextStep}. The hook made no file or Git-state changes.`,
  };
}

function makeAllow() {
  return { decision: "allow" };
}

function runGit(worktreePath, args) {
  try {
    return runBoundedCommand("git", ["-C", worktreePath, ...args], {
      cwd: worktreePath,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      operation: `git ${args[0] ?? "unknown"}`,
    }).trim();
  } catch {
    throw new GitCommandError(args[0] ?? "unknown");
  }
}

function runGitBuffer(worktreePath, args) {
  try {
    return runBoundedCommand("git", ["-C", worktreePath, ...args], {
      cwd: worktreePath,
      encoding: null,
      maxBuffer: MAX_SCANNED_FILE_BYTES + 1024,
    });
  } catch {
    throw new GitCommandError(args[0] ?? "unknown");
  }
}

function tokenizeCommand(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  const pushCurrent = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    const next = command[index + 1];

    if (quote === "'") {
      if (character === "'") {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (quote === '"') {
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
      current += character;
      escaped = false;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "\\" && (next === '"' || next === "'" || next === "\\")) {
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

    if ([";", "|", "&", "(", ")", ">", "<"].includes(character)) {
      pushCurrent();
      tokens.push(character);
      continue;
    }

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
  const separators = new Set([";", "&&", "||", "|", "&", "(", ")", ">", "<"]);

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
  const wrappers = new Set(["sudo", "env", "command", "exec", "nohup", "nice", "setsid"]);
  let index = 0;

  while (index < segment.length) {
    const token = segment[index].toLowerCase();
    if (token === "env") {
      index += 1;
      while (index < segment.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[index])) {
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
  if (!isNonEmptyString(value)) {
    return null;
  }

  const cleaned = value.replace(/^\/d$/i, "").trim();
  if (!cleaned) {
    return null;
  }

  return resolve(currentDirectory, cleaned);
}

function locateCommitSubcommand(segment) {
  const firstIndex = unwrapCommandWrappers(segment);
  const first = segment[firstIndex]?.toLowerCase();
  const firstExecutable = first?.replaceAll("\\", "/").split("/").at(-1);
  if (!["git", "git.exe", "git.cmd", "git.bat"].includes(firstExecutable)) {
    return null;
  }

  let index = firstIndex + 1;
  while (index < segment.length) {
    const token = segment[index];
    if (token === "-C" || token.startsWith("-C")) {
      index += token === "-C" ? 2 : 1;
      continue;
    }
    if (!token.startsWith("-")) {
      return token.toLowerCase() === "commit"
        ? { firstIndex, subcommandIndex: index }
        : null;
    }
    index += 1;
    if (["-c", "--config-env", "--exec-path", "--upload-pack"].includes(token)) {
      index += 1;
    }
  }

  return null;
}

function identifyCommitInvocation(command, initialDirectory) {
  const tokens = tokenizeCommand(command);
  if (tokens === null) {
    const possibleCommit =
      /\bgit(?:\.exe|\.cmd|\.bat)?\b[\s\S]*\bcommit\b/i.test(
        command,
      );
    return {
      isCommit: possibleCommit,
      parseable: false,
      targetDirectory: initialDirectory,
      reason: "The shell command could not be parsed safely.",
    };
  }

  const segments = splitCommandSegments(tokens);
  const hasShellSeparator = tokens.some((token) =>
    [";", "&&", "||", "|", "&", "(", ")", ">", "<"].includes(token),
  );
  const shellExpansion = /`|\$\(|\$\{/.test(command);
  const located = segments
    .map((segment) => ({ segment, location: locateCommitSubcommand(segment) }))
    .find((entry) => entry.location !== null);

  if (!located || !located.location) {
    return { isCommit: false, parseable: true };
  }

  const { segment, location } = located;
  const { firstIndex, subcommandIndex } = location;
  let index = firstIndex + 1;
  let targetDirectory = initialDirectory;
  let hasGitTarget = false;
  let unsupportedTarget = false;
  let parseError = null;

  while (index < segment.length && index < subcommandIndex) {
    const token = segment[index];
    if (token === "-C") {
      const directoryArgument = segment[index + 1];
      const resolvedDirectory = resolveCommandDirectory(initialDirectory, directoryArgument);
      if (resolvedDirectory === null) {
        parseError = "The Git -C target directory is missing or invalid.";
        break;
      }
      targetDirectory = resolvedDirectory;
      hasGitTarget = true;
      index += 2;
      continue;
    }

    if (token.startsWith("-C") && token.length > 2) {
      targetDirectory = resolveCommandDirectory(initialDirectory, token.slice(2));
      if (targetDirectory === null) {
        parseError = "The Git -C target directory is invalid.";
        break;
      }
      hasGitTarget = true;
      index += 1;
      continue;
    }

    if (
      token === "--git-dir" ||
      token.startsWith("--git-dir=") ||
      token === "--work-tree" ||
      token.startsWith("--work-tree=")
    ) {
      unsupportedTarget = true;
    }

    index += 1;
    if (["-c", "--config-env", "--exec-path", "--upload-pack"].includes(token)) {
      index += 1;
    }
  }

  const commitArguments = segment.slice(subcommandIndex + 1);
  const bypassArgument = commitArguments.find((argument) => {
    const lower = argument.toLowerCase();
    return (
      lower === "--no-verify" ||
      lower.startsWith("--no-gpg-sign") ||
      lower === "--amend" ||
      lower === "-a" ||
      lower === "--all" ||
      lower.startsWith("--all=") ||
      (lower.startsWith("-") && !lower.startsWith("--") && lower.includes("a"))
    );
  });

  return {
    isCommit: true,
    parseable: parseError === null,
    targetDirectory,
    unsupportedTarget,
    bypassArgument,
    gitArguments: segment.slice(firstIndex + 1, subcommandIndex),
    commitArguments,
    wrapped: firstIndex !== 0,
    compound: hasShellSeparator || segments.length !== 1,
    shellExpansion,
    hasGitTarget,
    reason: parseError,
  };
}

function parseStatus(output) {
  const records = output.split("\0");
  const entries = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) {
      continue;
    }

    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Unexpected porcelain status record.");
    }

    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const currentPath = record.slice(3);
    const isRenameOrCopy = indexStatus === "R" || indexStatus === "C";
    const previousPath = isRenameOrCopy ? records[++index] || null : null;

    entries.push({
      indexStatus,
      worktreeStatus,
      path: currentPath,
      previousPath,
      paths: previousPath ? [currentPath, previousPath] : [currentPath],
    });
  }

  return entries;
}

function isStatePath(root, repositoryRelativePath) {
  const candidate = resolve(root, ...repositoryRelativePath.split("/"));
  return normalizeRelativePath(relative(root, candidate))?.startsWith(CANONICAL_STATE_RELATIVE_PATH) ?? false;
}

function validateRepositoryName(value) {
  return isNonEmptyString(value) && /^[^/\s]+\/[^/\s]+$/.test(value);
}

function validateFileList(files) {
  if (!isRecord(files)) {
    return { error: "CommitProposal.files is missing or malformed." };
  }

  const categories = ["added", "modified", "deleted"];
  const allPaths = [];
  for (const category of categories) {
    if (!Array.isArray(files[category])) {
      return { error: `CommitProposal.files.${category} is missing or malformed.` };
    }
    for (const pathValue of files[category]) {
      const normalizedPath = normalizeRelativePath(pathValue);
      if (normalizedPath === null) {
        return {
          error: `CommitProposal.files.${category} contains an invalid repository-relative path.`,
        };
      }
      allPaths.push(normalizedPath);
    }
  }

  const uniquePaths = new Set(allPaths);
  if (uniquePaths.size === 0) {
    return { error: "CommitProposal.files is empty." };
  }
  if (uniquePaths.size !== allPaths.length) {
    return { error: "CommitProposal.files contains duplicate or overlapping paths." };
  }

  return { paths: [...uniquePaths] };
}

function validateCommitProposal(proposal) {
  if (!isRecord(proposal)) {
    return "PreCommitGate.commit_proposal is missing or malformed.";
  }
  if (proposal.schema !== "CommitProposal" || proposal.version !== 1) {
    return "PreCommitGate.commit_proposal is not a version-1 CommitProposal.";
  }
  if (proposal.status !== "approved") {
    return "CommitProposal.status is not approved.";
  }
  if (!validateRepositoryName(proposal.repository)) {
    return "CommitProposal.repository is missing or malformed.";
  }
  if (!isNonEmptyString(proposal.branch)) {
    return "CommitProposal.branch is missing.";
  }
  const fileResult = validateFileList(proposal.files);
  if (fileResult.error) {
    return fileResult.error;
  }
  if (!isRecord(proposal.message) || !isNonEmptyString(proposal.message.subject)) {
    return "CommitProposal.message.subject is missing.";
  }
  if (typeof proposal.message.body !== "string") {
    return "CommitProposal.message.body is missing or malformed.";
  }
  if (!isRecord(proposal.authorization)) {
    return "CommitProposal.authorization is missing.";
  }
  if (
    proposal.authorization.exact_scope_approved !== true ||
    proposal.authorization.commit_authorized !== true
  ) {
    return "CommitProposal authorization does not cover the exact commit scope.";
  }
  if (!ALLOWED_AUTHORIZATION_SOURCES.has(proposal.authorization.source)) {
    return "CommitProposal authorization source is missing or unsupported.";
  }
  if (!isNonEmptyString(proposal.authorization.task_scope)) {
    return "CommitProposal authorization task scope is missing.";
  }
  if (!isNonEmptyString(proposal.authorization.evidence)) {
    return "CommitProposal authorization evidence is missing.";
  }
  if (proposal.base_sha !== null && proposal.base_sha !== undefined && !isSha(proposal.base_sha)) {
    return "CommitProposal.base_sha is malformed.";
  }
  if (proposal.validation !== undefined) {
    if (
      !isRecord(proposal.validation) ||
      proposal.validation.result_status !== "passed" ||
      !Array.isArray(proposal.validation.evidence) ||
      proposal.validation.evidence.length === 0
    ) {
      return "CommitProposal.validation is not a passed, evidence-backed result.";
    }
  }
  if (proposal.commit !== undefined) {
    if (!isRecord(proposal.commit)) {
      return "CommitProposal.commit is malformed.";
    }
    if (proposal.commit.sha !== undefined && proposal.commit.sha !== null) {
      return "CommitProposal already contains a commit SHA.";
    }
    if (proposal.commit.created_at !== undefined && proposal.commit.created_at !== null) {
      return "CommitProposal already contains a commit timestamp.";
    }
    if (
      proposal.commit.files_committed !== undefined &&
      (!Array.isArray(proposal.commit.files_committed) || proposal.commit.files_committed.length > 0)
    ) {
      return "CommitProposal already contains committed files.";
    }
  }

  return { paths: fileResult.paths };
}

function validateValidationResult(validation) {
  if (!isRecord(validation)) {
    return "PreCommitGate.validation is missing or malformed.";
  }
  if (validation.schema !== "ValidationResult" || validation.version !== 2) {
    return "PreCommitGate.validation is not a version-2 ValidationResult.";
  }
  if (validation.status !== "passed") {
    return "ValidationResult.status is not passed.";
  }
  if (!isRecord(validation.workspace)) {
    return "ValidationResult.workspace is missing.";
  }
  if (
    !isNonEmptyString(validation.workspace.path) ||
    !isAbsolute(validation.workspace.path) ||
    !isNonEmptyString(validation.workspace.branch) ||
    !isSha(validation.workspace.head_sha)
  ) {
    return "ValidationResult.workspace is incomplete.";
  }
  if (!isRecord(validation.source)) {
    return "ValidationResult.source is missing.";
  }
  const sourceFields = [
    "implementation_plan_version",
    "working_tree_inspection_version",
    "change_classification_version",
    "unrelated_change_detection_version",
    "loaded_issue_version",
    "issue_analysis_version",
    "branch_workspace_version",
  ];
  if (
    sourceFields.some((field) => !Object.hasOwn(validation.source, field)) ||
    !Array.isArray(validation.source.references) ||
    !Array.isArray(validation.source.unavailable_inputs)
  ) {
    return "ValidationResult.source is incomplete.";
  }
  if (!Array.isArray(validation.evidence_requirements)) {
    return "ValidationResult.evidence_requirements is missing or malformed.";
  }
  const evidenceRequirementIds = new Set();
  for (const requirement of validation.evidence_requirements) {
    if (
      !isRecord(requirement) ||
      !isNonEmptyString(requirement.id) ||
      !isNonEmptyString(requirement.requirement) ||
      !isRecord(requirement.source) ||
      !VALID_EVIDENCE_SOURCE_KINDS.has(requirement.source.kind) ||
      !isNonEmptyString(requirement.source.reference) ||
      !isNonEmptyString(requirement.expected_kind) ||
      (requirement.location !== null && !isNonEmptyString(requirement.location)) ||
      !VALID_EVIDENCE_STATUSES.has(requirement.status) ||
      !Array.isArray(requirement.evidence) ||
      requirement.evidence.length === 0 ||
      requirement.evidence.some((evidence) => !isNonEmptyString(evidence)) ||
      (requirement.location !== null && normalizeRelativePath(requirement.location) === null)
    ) {
      return "ValidationResult contains a malformed evidence requirement.";
    }
    if (evidenceRequirementIds.has(requirement.id)) {
      return `ValidationResult contains duplicate evidence requirement ${safeLabel(requirement.id)}.`;
    }
    evidenceRequirementIds.add(requirement.id);
    if (requirement.status !== "satisfied") {
      return describeEvidenceRequirement(requirement);
    }
    if (
      requirement.required_capability !== undefined &&
      requirement.required_capability !== null &&
      !isNonEmptyString(requirement.required_capability)
    ) {
      return `Explicit evidence requirement ${safeLabel(requirement.id)} has an invalid required capability.`;
    }
  }
  if (!Array.isArray(validation.checks)) {
    return "ValidationResult.checks is missing or malformed.";
  }
  for (const check of validation.checks) {
    if (
      !isRecord(check) ||
      !isNonEmptyString(check.id) ||
      !isNonEmptyString(check.command) ||
      !isNonEmptyString(check.evidence) ||
      !VALID_CHECK_RESULTS.has(check.result) ||
      typeof check.required !== "boolean"
    ) {
      return "ValidationResult contains a malformed check.";
    }
    if (check.required && check.result !== "pass") {
      return `Required validation check ${safeLabel(check.id)} is not passed.`;
    }
  }
  if (validation.required_checks_passed !== true) {
    return "ValidationResult.required_checks_passed is not true.";
  }
  if (!isRecord(validation.evaluation)) {
    return "ValidationResult.evaluation is missing.";
  }
  if (
    !isRecord(validation.evaluation.scope) ||
    validation.evaluation.scope.status !== "aligned" ||
    !Array.isArray(validation.evaluation.scope.evidence) ||
    validation.evaluation.scope.evidence.length === 0
  ) {
    return "ValidationResult scope is not aligned with evidence.";
  }
  if (!Array.isArray(validation.evaluation.acceptance_criteria)) {
    return "ValidationResult acceptance criteria are missing.";
  }
  for (const criterion of validation.evaluation.acceptance_criteria) {
    if (
      !isRecord(criterion) ||
      !VALID_CRITERION_RESULTS.has(criterion.status) ||
      !Array.isArray(criterion.evidence) ||
      criterion.evidence.length === 0
    ) {
      return "ValidationResult contains a malformed acceptance criterion.";
    }
    if (criterion.status !== "pass") {
      return "ValidationResult contains an unpassed acceptance criterion.";
    }
  }
  if (!Array.isArray(validation.evaluation.completion_criteria)) {
    return "ValidationResult completion criteria are missing.";
  }
  for (const criterion of validation.evaluation.completion_criteria) {
    if (
      !isRecord(criterion) ||
      !VALID_CRITERION_RESULTS.has(criterion.status) ||
      !Array.isArray(criterion.evidence) ||
      criterion.evidence.length === 0
    ) {
      return "ValidationResult contains a malformed completion criterion.";
    }
    if (criterion.status !== "pass") {
      return "ValidationResult contains an unpassed completion criterion.";
    }
  }
  if (!Array.isArray(validation.evaluation.planned_steps)) {
    return "ValidationResult planned steps are missing.";
  }
  for (const step of validation.evaluation.planned_steps) {
    if (
      !isRecord(step) ||
      !isNonEmptyString(step.id) ||
      !VALID_PLAN_STEP_RESULTS.has(step.status) ||
      !Array.isArray(step.evidence) ||
      step.evidence.length === 0
    ) {
      return "ValidationResult contains a malformed planned step.";
    }
    if (step.status !== "completed") {
      return "ValidationResult contains an incomplete planned step.";
    }
  }
  if (
    !Array.isArray(validation.evaluation.unexpected_changes) ||
    validation.evaluation.unexpected_changes.length > 0
  ) {
    return "ValidationResult contains unresolved unexpected changes.";
  }
  if (!Array.isArray(validation.evaluation.documented_deviations)) {
    return "ValidationResult documented deviations are missing.";
  }
  if (validation.evaluation.documented_deviations.some((deviation) => deviation?.documented !== true)) {
    return "ValidationResult contains an undocumented scope deviation.";
  }
  if (!Array.isArray(validation.blockers) || validation.blockers.length > 0) {
    return "ValidationResult contains blocking findings.";
  }
  if (!Array.isArray(validation.warnings)) {
    return "ValidationResult warnings are missing.";
  }
  if (!isRecord(validation.readiness) || validation.readiness.commit_preparation_allowed !== true) {
    return "ValidationResult does not allow commit preparation.";
  }
  if (
    !Array.isArray(validation.readiness.reasons) ||
    !Object.hasOwn(validation, "recommended_next_skill") ||
    (validation.recommended_next_skill !== null &&
      !isNonEmptyString(validation.recommended_next_skill))
  ) {
    return "ValidationResult readiness or follow-up fields are incomplete.";
  }
  if (validation.failure !== null) {
    return "ValidationResult.failure is not null.";
  }

  return null;
}

function validateGate(gate) {
  if (!isRecord(gate)) {
    return "PreCommitGate is missing or malformed.";
  }
  if (gate.schema !== "PreCommitGate" || gate.version !== PRE_COMMIT_GATE_VERSION) {
    return `PreCommitGate must use version ${PRE_COMMIT_GATE_VERSION}; older snapshots fail closed.`;
  }
  if (!isRecord(gate.workspace)) {
    return "PreCommitGate.workspace is missing.";
  }
  if (
    !validateRepositoryName(gate.workspace.repository) ||
    !isNonEmptyString(gate.workspace.path) ||
    !isAbsolute(gate.workspace.path) ||
    !isNonEmptyString(gate.workspace.branch) ||
    !isSha(gate.workspace.head_sha)
  ) {
    return "PreCommitGate.workspace is incomplete or malformed.";
  }
  if (!isIsoTimestamp(gate.written_at)) {
    return "PreCommitGate.written_at is missing or malformed.";
  }

  const validationError = validateValidationResult(gate.validation);
  if (validationError) {
    return validationError;
  }

  const proposalError = validateCommitProposal(gate.commit_proposal);
  if (typeof proposalError === "string") {
    return proposalError;
  }

  if (gate.commit_proposal.repository !== gate.workspace.repository) {
    return "PreCommitGate repository identities do not match.";
  }
  if (gate.commit_proposal.branch !== gate.workspace.branch) {
    return "PreCommitGate branch identities do not match.";
  }
  if (
    normalizeAbsolutePath(gate.validation.workspace.path) !==
      normalizeAbsolutePath(gate.workspace.path) ||
    gate.validation.workspace.branch !== gate.workspace.branch ||
    gate.validation.workspace.head_sha.toLowerCase() !== gate.workspace.head_sha.toLowerCase()
  ) {
    return "PreCommitGate and ValidationResult workspace identities do not match.";
  }
  if (
    !isRecord(gate.commit_proposal.validation) ||
    gate.commit_proposal.validation.result_status !== "passed" ||
    !Array.isArray(gate.commit_proposal.validation.evidence) ||
    gate.commit_proposal.validation.evidence.length === 0
  ) {
    return "CommitProposal does not carry passed validation evidence.";
  }

  const binding = gate.commit_binding;
  if (!isRecord(binding) || !isRecord(binding.message_file) || !isRecord(binding.staged_index)) {
    return "PreCommitGate.commit_binding is missing or malformed.";
  }
  if (
    !isNonEmptyString(binding.message_file.path) ||
    !isAbsolute(binding.message_file.path) ||
    binding.message_file.path.includes("\0") ||
    !isSha256(binding.message_file.sha256) ||
    !Number.isSafeInteger(binding.message_file.byte_length) ||
    binding.message_file.byte_length < 0
  ) {
    return "PreCommitGate.commit_binding.message_file is incomplete or malformed.";
  }
  if (
    binding.staged_index.format !== STAGED_INDEX_FINGERPRINT_FORMAT ||
    !isSha256(binding.staged_index.sha256) ||
    !Number.isSafeInteger(binding.staged_index.byte_length) ||
    binding.staged_index.byte_length < 0
  ) {
    return "PreCommitGate.commit_binding.staged_index is incomplete or malformed.";
  }

  return {
    paths: proposalError.paths,
    binding: {
      messagePath: binding.message_file.path,
      messageSha256: binding.message_file.sha256.toLowerCase(),
      messageByteLength: binding.message_file.byte_length,
      stagedIndexSha256: binding.staged_index.sha256.toLowerCase(),
      stagedIndexByteLength: binding.staged_index.byte_length,
    },
  };
}

function canonicalCommitMessageBytes(proposal) {
  const body = proposal.message.body;
  const message = body.length > 0
    ? `${proposal.message.subject}\n\n${body}`
    : proposal.message.subject;
  return Buffer.from(`${message}\n`, "utf8");
}

function validateCanonicalCommitInvocation(invocation) {
  if (invocation.compound || invocation.shellExpansion) {
    return "The commit command must be one standalone shell invocation without expansion or redirection.";
  }
  if (invocation.wrapped) {
    return "The commit command must invoke Git directly without a shell wrapper.";
  }
  if (!invocation.hasGitTarget || !Array.isArray(invocation.gitArguments)) {
    return "The commit command must use an explicit -C verified-worktree target.";
  }
  if (invocation.gitArguments.length !== 2 || invocation.gitArguments[0] !== "-C") {
    return "The commit command must use only the canonical Git -C option.";
  }
  if (!Array.isArray(invocation.commitArguments) || invocation.commitArguments.length !== 2) {
    return "The commit command must use only --cleanup=verbatim and --file=<approved-message-file>.";
  }
  if (invocation.commitArguments[0] !== "--cleanup=verbatim") {
    return "The commit command must use --cleanup=verbatim exactly.";
  }
  const messageArgument = invocation.commitArguments[1];
  if (
    !messageArgument.startsWith("--file=") ||
    !isAbsolute(messageArgument.slice("--file=".length))
  ) {
    return "The commit command must use the approved message file as --file=<path>.";
  }
  return { messagePath: messageArgument.slice("--file=".length) };
}

function parseStagedIndexDiff(output) {
  const records = output.toString("utf8").split("\0").filter(Boolean);
  const entries = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const tabIndex = record.indexOf("\t");
    let header = tabIndex >= 0 ? record.slice(0, tabIndex) : record;
    let pathValue = tabIndex >= 0 ? record.slice(tabIndex + 1) : records[++index];
    if (typeof pathValue !== "string" || pathValue.length === 0) {
      throw new Error("Staged index diff record is missing a path.");
    }

    const match = /^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])(?:\d+)?$/.exec(header);
    if (!match) {
      throw new Error("Staged index diff record is malformed.");
    }
    const normalizedPath = normalizeRelativePath(pathValue);
    if (normalizedPath === null) {
      throw new Error("Staged index diff contains an invalid repository path.");
    }
    if (!["A", "M", "D", "T"].includes(match[5])) {
      throw new Error("Staged index diff contains an unsupported change type.");
    }

    entries.push({
      path: normalizedPath,
      status: match[5],
      oldMode: match[1],
      newMode: match[2],
      oldSha: match[3],
      newSha: match[4],
    });
  }

  return entries;
}

function stagedIndexBinding(worktreePath) {
  const bytes = runGitBuffer(worktreePath, STAGED_INDEX_FINGERPRINT_ARGS);
  return {
    bytes,
    sha256: sha256(bytes),
    byteLength: bytes.length,
  };
}

function validateStagedIndex(entries, proposal) {
  const expectedByPath = new Map();
  for (const pathValue of proposal.files.added) expectedByPath.set(normalizeRelativePath(pathValue), "A");
  for (const pathValue of proposal.files.modified) expectedByPath.set(normalizeRelativePath(pathValue), "M");
  for (const pathValue of proposal.files.deleted) expectedByPath.set(normalizeRelativePath(pathValue), "D");

  if (entries.length !== expectedByPath.size) {
    return "The staged index does not contain exactly the approved file set.";
  }

  const seen = new Set();
  for (const entry of entries) {
    const expectedStatus = expectedByPath.get(entry.path);
    if (!expectedStatus || seen.has(entry.path)) {
      return "The staged index does not contain exactly the approved file set.";
    }
    if (
      (expectedStatus === "A" && entry.status !== "A") ||
      (expectedStatus === "D" && entry.status !== "D") ||
      (expectedStatus === "M" && !["M", "T"].includes(entry.status))
    ) {
      return "The staged index change type does not match the approved file category.";
    }
    seen.add(entry.path);
  }

  return seen.size === expectedByPath.size
    ? null
    : "The staged index does not contain exactly the approved file set.";
}

function validateMessageFileBinding(messagePath, binding, proposal) {
  if (normalizeAbsolutePath(messagePath) !== normalizeAbsolutePath(binding.messagePath)) {
    return "The commit message file does not match the approved message binding.";
  }

  let bytes;
  try {
    bytes = readFileSync(binding.messagePath);
  } catch {
    return "The approved commit message file is missing or unreadable.";
  }

  const expected = canonicalCommitMessageBytes(proposal);
  if (
    bytes.length !== binding.messageByteLength ||
    sha256(bytes) !== binding.messageSha256 ||
    !bytes.equals(expected)
  ) {
    return "The commit message bytes do not match the approved binding.";
  }

  return null;
}

function parseInProgressOperations(worktreePath) {
  const operationPaths = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
    "rebase-merge",
    "rebase-apply",
  ];

  for (const operationPath of operationPaths) {
    let gitPath;
    try {
      gitPath = runGit(worktreePath, ["rev-parse", "--git-path", operationPath]);
    } catch {
      return "Git administrative state could not be inspected.";
    }

    const absoluteGitPath = isAbsolute(gitPath) ? gitPath : resolve(worktreePath, gitPath);
    if (existsSync(absoluteGitPath)) {
      return `Git reports an in-progress ${operationPath} operation.`;
    }
  }

  return null;
}

function scanFileName(repositoryRelativePath, filenamePatterns = []) {
  const basename = repositoryRelativePath.split("/").at(-1).toLowerCase();
  const compatibilityFinding =
    (basename === ".env" || (basename.startsWith(".env.") && !SAFE_ENV_TEMPLATES.has(basename))) ||
    basename === ".npmrc" ||
    basename === ".pypirc" ||
    basename === ".netrc" ||
    basename === ".dockerconfigjson" ||
    /^(?:credentials?|secrets?)(?:\.(?:json|ya?ml|toml|ini|cfg|env|txt))?$/.test(basename) ||
    /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|key|p12|pfx|jks))$/.test(basename)
  ;
  if (compatibilityFinding && filenamePatterns.includes("credential-like")) {
    return "credential-like filename";
  }
  if (filenamePatterns.includes("environment-secret") && basename.startsWith(".env.") && !SAFE_ENV_TEMPLATES.has(basename)) return "credential-like filename";
  if (filenamePatterns.includes("private-key-like") && /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|key|p12|pfx|jks))$/.test(basename)) return "credential-like filename";
  if (filenamePatterns.some((pattern) => typeof pattern === "string" && pattern.startsWith("regex:"))) {
    for (const pattern of filenamePatterns.filter((value) => value.startsWith("regex:"))) {
      try { if (new RegExp(pattern.slice(6), "i").test(basename)) return "policy-configured credential-like filename"; } catch { return "invalid policy filename pattern"; }
    }
  }
  return null;
}

function readIndexAndWorkingTree(worktreePath, repositoryRelativePath) {
  const contents = [];
  try {
    contents.push(runGitBuffer(worktreePath, ["show", `:${repositoryRelativePath}`]));
  } catch {
    // An untracked path has no index blob; its working-tree content is scanned below.
  }

  const absolutePath = resolve(worktreePath, ...repositoryRelativePath.split("/"));
  if (isWithinRoot(worktreePath, absolutePath) && existsSync(absolutePath)) {
    try {
      const fileStats = statSync(absolutePath);
      if (fileStats.size > MAX_SCANNED_FILE_BYTES) {
        contents.push(Buffer.alloc(MAX_SCANNED_FILE_BYTES + 1));
      } else {
        contents.push(readFileSync(absolutePath));
      }
    } catch {
      return null;
    }
  }

  return contents.length > 0 ? contents : null;
}

function scanApprovedFiles(worktreePath, approvedPaths, statusEntries, policy) {
  if (!policyEnforces(policy?.secrets)) return null;
  const filenamePatterns = policy.secrets.filename_patterns;
  const contentPatterns = policy.secrets.content_patterns.map((entry) => ({
    name: entry.name,
    pattern: new RegExp(entry.source, entry.flags),
  }));
  const entryByPath = new Map();
  for (const entry of statusEntries) {
    for (const pathValue of entry.paths) {
      entryByPath.set(normalizeRelativePath(pathValue), entry);
    }
  }

  for (const repositoryRelativePath of approvedPaths) {
    const filenameFinding = scanFileName(repositoryRelativePath, filenamePatterns);
    if (filenameFinding) {
      return {
        path: repositoryRelativePath,
        finding: filenameFinding,
      };
    }

    const entry = entryByPath.get(repositoryRelativePath);
    const isDeleted =
      entry &&
      (entry.indexStatus === "D" ||
        (entry.worktreeStatus === "D" && !existsSync(resolve(worktreePath, ...repositoryRelativePath.split("/")))));
    if (isDeleted) {
      continue;
    }

    const contents = readIndexAndWorkingTree(worktreePath, repositoryRelativePath);
    if (contents === null) {
      return {
        path: repositoryRelativePath,
        finding: "approved file could not be read for secret scanning",
      };
    }
    for (const content of contents) {
      if (content.length > MAX_SCANNED_FILE_BYTES) {
        return {
          path: repositoryRelativePath,
          finding: "file exceeds the deterministic secret-scan size limit",
        };
      }
      const text = content.toString("utf8");
      for (const secretPattern of contentPatterns) {
        if (secretPattern.pattern.test(text)) {
          return {
            path: repositoryRelativePath,
            finding: secretPattern.name,
          };
        }
      }
    }
  }

  return null;
}

function evaluate(input) {
  if (!isRecord(input)) {
    return makeDeny("Hook input is not a JSON object", "verify the host hook configuration");
  }

  const command =
    typeof input.command === "string"
      ? input.command
      : isRecord(input.tool_input) && typeof input.tool_input.command === "string"
        ? input.tool_input.command
        : null;

  if (command === null) {
    return makeDeny("Hook input does not contain a shell command", "verify the host hook configuration");
  }

  const initialDirectory =
    typeof input.cwd === "string" && input.cwd.trim().length > 0
      ? resolve(input.cwd)
      : isRecord(input.tool_input) &&
          typeof input.tool_input.cwd === "string" &&
          input.tool_input.cwd.trim().length > 0
        ? resolve(input.tool_input.cwd)
        : null;
  const invocation = identifyCommitInvocation(command, initialDirectory ?? process.cwd());
  if (!invocation.isCommit) {
    return makeAllow();
  }
  if (!invocation.parseable) {
    return makeDeny(invocation.reason, "create-commit without shell-command indirection");
  }
  const commandError = validateCanonicalCommitInvocation(invocation);
  if (typeof commandError === "string") {
    return makeDeny(commandError, "create-commit with the exact canonical command");
  }
  if (invocation.unsupportedTarget) {
    return makeDeny(
      "The commit uses --git-dir or --work-tree, so the target worktree cannot be verified safely",
      "verify-worktree",
    );
  }
  if (invocation.bypassArgument) {
    return makeDeny(
      `The commit uses the bypass or history-changing option ${safeLabel(invocation.bypassArgument)}`,
      "create-commit without bypass flags",
    );
  }
  if (initialDirectory === null) {
    return makeDeny("The hook did not receive the commit working directory", "verify-worktree");
  }
  if (!existsSync(invocation.targetDirectory)) {
    return makeDeny("The commit target worktree does not exist", "verify-worktree");
  }

  let repositoryRoot;
  let branch;
  let headSha;
  try {
    repositoryRoot = runGit(invocation.targetDirectory, ["rev-parse", "--show-toplevel"]);
    branch = runGit(invocation.targetDirectory, ["branch", "--show-current"]);
    headSha = runGit(invocation.targetDirectory, ["rev-parse", "--verify", "HEAD^{commit}"]);
  } catch (error) {
    const operation = error instanceof GitCommandError ? error.operation : "repository identity";
    return makeDeny(`Git ${operation} verification failed`, "verify-worktree");
  }

  if (!isNonEmptyString(branch)) {
    return makeDeny("The commit worktree is detached or has no current branch", "verify-worktree");
  }

  const policy = loadRepositoryPolicy(repositoryRoot);

  const claim = claimGate(repositoryRoot, GATE_FILE_NAME, "pre-commit");
  const gate = claim.gate;
  if (gate === null) {
    return makeDeny(
      `The local PreCommitGate could not be claimed from ${GATE_RELATIVE_PATH}: ${claim.error ?? "unknown lifecycle error"}`,
      "validate-implementation-result and create a fresh PreCommitGate",
    );
  }

  const gateError = validateGate(gate);
  if (typeof gateError === "string") {
    return makeDeny(gateError, "validate-implementation-result and create a fresh PreCommitGate");
  }

  if (normalizeAbsolutePath(gate.workspace.path) !== normalizeAbsolutePath(repositoryRoot)) {
    return makeDeny("PreCommitGate worktree path does not match the live Git root", "verify-worktree");
  }
  if (gate.workspace.branch !== branch || gate.validation.workspace.branch !== branch) {
    return makeDeny("PreCommitGate branch does not match the live branch", "verify-worktree");
  }
  if (
    gate.workspace.head_sha.toLowerCase() !== headSha.toLowerCase() ||
    gate.validation.workspace.head_sha.toLowerCase() !== headSha.toLowerCase()
  ) {
    return makeDeny("PreCommitGate validation is bound to a different HEAD", "validate-implementation-result");
  }
  if (
    gate.commit_proposal.base_sha !== null &&
    gate.commit_proposal.base_sha !== undefined &&
    gate.commit_proposal.base_sha.toLowerCase() !== headSha.toLowerCase()
  ) {
    return makeDeny("CommitProposal.base_sha does not match the live HEAD", "verify-worktree");
  }
  if (gate.commit_proposal.branch !== branch) {
    return makeDeny("CommitProposal branch does not match the live branch", "verify-worktree");
  }

  if (normalizeAbsolutePath(invocation.targetDirectory) !== normalizeAbsolutePath(repositoryRoot)) {
    return makeDeny("The commit -C target does not match the live Git root", "verify-worktree");
  }
  if (!isAbsolute(invocation.gitArguments[1])) {
    return makeDeny("The commit -C target must be an absolute verified worktree path", "verify-worktree");
  }
  if (normalizeAbsolutePath(invocation.gitArguments[1]) !== normalizeAbsolutePath(repositoryRoot)) {
    return makeDeny("The commit -C target does not match the live Git root", "verify-worktree");
  }

  const messageBindingError = validateMessageFileBinding(
    commandError.messagePath,
    gateError.binding,
    gate.commit_proposal,
  );
  if (messageBindingError) {
    return makeDeny(messageBindingError, "create-commit with the approved message bytes");
  }

  let stagedBinding;
  let stagedEntries;
  try {
    stagedBinding = stagedIndexBinding(repositoryRoot);
    stagedEntries = parseStagedIndexDiff(stagedBinding.bytes);
  } catch {
    return makeDeny("The staged index fingerprint could not be captured safely", "inspect-working-tree");
  }
  if (
    stagedBinding.byteLength !== gateError.binding.stagedIndexByteLength ||
    stagedBinding.sha256 !== gateError.binding.stagedIndexSha256
  ) {
    return makeDeny("The staged index changed after approval", "inspect-working-tree and create a fresh PreCommitGate");
  }
  const stagedIndexError = validateStagedIndex(stagedEntries, gate.commit_proposal);
  if (stagedIndexError) {
    return makeDeny(stagedIndexError, "inspect-working-tree and create a fresh PreCommitGate");
  }

  let operationError;
  try {
    operationError = parseInProgressOperations(repositoryRoot);
  } catch {
    operationError = "Git administrative state could not be inspected.";
  }
  if (operationError) {
    return makeDeny(operationError, "verify-worktree");
  }

  let statusEntries;
  let unmergedIndex;
  try {
    statusEntries = parseStatus(
      runBoundedCommand(
        "git",
        ["-C", repositoryRoot, "status", "--porcelain=v1", "--untracked-files=all", "-z"],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
          operation: "git status",
        },
      ),
    );
    unmergedIndex = runGit(repositoryRoot, ["ls-files", "-u"]);
  } catch {
    return makeDeny("Git status or index verification failed", "inspect-working-tree");
  }

  const statePaths = [];
  const unmergedPaths = [];
  const observedPaths = new Set();
  for (const entry of statusEntries) {
    for (const pathValue of entry.paths) {
      const normalizedPath = normalizeRelativePath(pathValue);
      if (normalizedPath === null) {
        return makeDeny("Git status returned an invalid repository path", "inspect-working-tree");
      }
      observedPaths.add(normalizedPath);
      if (isStatePath(repositoryRoot, normalizedPath)) {
        statePaths.push(normalizedPath);
      }
      if (
        entry.indexStatus === "U" ||
        entry.worktreeStatus === "U" ||
        entry.indexStatus === "A" && entry.worktreeStatus === "A"
      ) {
        unmergedPaths.push(normalizedPath);
      }
    }
  }

  if (unmergedIndex.trim().length > 0 || unmergedPaths.length > 0) {
    return makeDeny("The index contains unmerged entries or conflicts", "verify-worktree");
  }
  if (statePaths.length > 0) {
    return makeDeny(
      "The local hook state path is present in the commit status and must never be staged",
      "inspect-working-tree",
    );
  }

  const approvedPaths = new Set(gate.commit_proposal.files.added
    .concat(gate.commit_proposal.files.modified, gate.commit_proposal.files.deleted)
    .map(normalizeRelativePath));
  const extraPaths = [...observedPaths].filter((pathValue) => !approvedPaths.has(pathValue));
  if (extraPaths.length > 0) {
    return makeDeny(
      `Working-tree scope contains unexpected paths: ${formatPathList(extraPaths)}`,
      "inspect-working-tree",
    );
  }
  const secretFinding = scanApprovedFiles(repositoryRoot, [...approvedPaths], statusEntries, policy);
  if (secretFinding) {
    return makeDeny(
      `Approved path ${secretFinding.path} matches ${secretFinding.finding}`,
      "validate-implementation-result",
    );
  }

  return makeAllow();
}

function writeResponse(input, result) {
  const isCodex =
    input?.hook_event_name === "PreToolUse" ||
    typeof input?.tool_name === "string" ||
    isRecord(input?.tool_input);

  if (isCodex) {
    if (result.decision === "deny") {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: result.message,
          },
        }) + "\n",
      );
      return;
    }

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
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
    const result = makeDeny("Hook input is missing or invalid JSON", "verify the host hook configuration");
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
    result = makeDeny(
      `The deterministic pre-commit check failed closed with ${errorType}`,
      "verify-worktree",
    );
  }

  writeResponse(input, result);
  if (result.decision === "deny") {
    process.exitCode = 2;
  }
}

main();
