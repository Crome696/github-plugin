import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve } from "node:path";

import { readHookInput } from "./lib/read-hook-input.mjs";

const GATE_RELATIVE_PATH = ".cursor/hooks/state/pre-pr-create.json";
const MAX_BODY_FILE_BYTES = 25 * 1024 * 1024;
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
const REQUIRED_DESCRIPTION_HEADINGS = [
  {
    names: ["problem / issue context"],
    label: "Problem / issue context",
  },
  {
    names: ["solution summary"],
    label: "Solution summary",
  },
  {
    names: ["key changes", "key changes and scope"],
    label: "Key changes or Key changes and scope",
  },
  {
    names: ["tests and validations"],
    label: "Tests and validations",
  },
  {
    names: ["known limitations"],
    label: "Known limitations",
  },
  {
    names: ["risks"],
    label: "Risks",
  },
  {
    names: ["issue linkage"],
    label: "Issue linkage",
  },
];
const BLOCKED_CREATE_FLAGS = new Set([
  "--assignee",
  "--editor",
  "--fill",
  "--fill-verbose",
  "--label",
  "--milestone",
  "--project",
  "--recover",
  "--reviewer",
  "--template",
  "--web",
]);
const ALLOWED_CREATE_FLAGS = new Set([
  "--base",
  "--body",
  "--body-file",
  "--draft",
  "--head",
  "--repo",
  "--title",
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

function isIsoTimestamp(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function normalizeAbsolutePath(value) {
  return normalize(resolve(value)).toLowerCase();
}

function normalizeRepository(value) {
  return isNonEmptyString(value) ? value.toLowerCase() : null;
}

function validateRepositoryName(value) {
  return isNonEmptyString(value) && /^[^/\s]+\/[^/\s]+$/.test(value);
}

function safeLabel(value) {
  return String(value).replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 100);
}

function statePathForRoot(root) {
  return resolve(root, ...GATE_RELATIVE_PATH.split("/"));
}

function addFinding(findings, requirement, nextStep) {
  const key = `${requirement}\u0000${nextStep}`;
  if (findings.some((finding) => finding.key === key)) {
    return;
  }
  findings.push({ key, requirement, nextStep });
}

function makeDeny(findings) {
  const visibleFindings = findings.map((finding) => {
    return `- ${finding.requirement} Next step: ${finding.nextStep}.`;
  });
  return {
    decision: "deny",
    message:
      "Draft pull-request creation blocked by deterministic pre-pr-create checks. " +
      "Missing or invalid prerequisites:\n" +
      visibleFindings.join("\n") +
      "\nThe hook made no file, Git, or GitHub changes.",
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
  const wrappers = new Set(["command", "env", "exec", "nice", "nohup", "setsid", "sudo"]);
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

  if (value.includes("\0") || value === "~" || value.startsWith("~")) {
    return null;
  }

  return resolve(currentDirectory, value);
}

function isGhCreateSegment(segment) {
  const firstIndex = unwrapCommandWrappers(segment);
  const first = segment[firstIndex]?.toLowerCase();
  const firstExecutable = first?.replaceAll("\\", "/").split("/").at(-1);
  return (
    ["gh", "gh.exe", "gh.cmd", "gh.bat"].includes(firstExecutable) &&
    segment[firstIndex + 1]?.toLowerCase() === "pr" &&
    segment[firstIndex + 2]?.toLowerCase() === "create"
  );
}

function identifyPrCreateInvocations(command, initialDirectory) {
  if (!isNonEmptyString(initialDirectory)) {
    return { invocations: [], parseable: false, reason: "The hook did not receive the shell working directory." };
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
      const directoryArgument = segment[directoryIndex];
      const resolvedDirectory = resolveCommandDirectory(currentDirectory, directoryArgument);
      if (resolvedDirectory === null) {
        parseError = "The Draft PR target directory could not be resolved safely.";
      } else {
        currentDirectory = resolvedDirectory;
      }
      continue;
    }

    if (!isGhCreateSegment(segment)) {
      continue;
    }

    if (parseError !== null) {
      invocations.push({
        targetDirectory: currentDirectory,
        args: [],
        parseError,
      });
      continue;
    }

    invocations.push({
      targetDirectory: currentDirectory,
      args: segment.slice(firstIndex + 3),
      parseError: null,
    });
  }

  return { invocations, parseable: true, reason: null };
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

function parseCreateArguments(args, findings) {
  const values = new Map();
  let draft = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--") {
      addFinding(
        findings,
        "The gh pr create command uses the end-of-options marker, so its exact target cannot be verified.",
        "run gh pr create with only the supported named options",
      );
      continue;
    }

    if (!token.startsWith("-")) {
      addFinding(
        findings,
        "The gh pr create command contains an unsupported positional argument.",
        "remove positional arguments and use the exact approved Draft PR options",
      );
      continue;
    }

    const option = splitLongOption(token);
    if (option.name.startsWith("-") === false || !option.name.startsWith("--")) {
      addFinding(
        findings,
        `The gh pr create command uses an unsupported short option (${safeLabel(token)}).`,
        "use --repo, --base, --head, --title, --body-file, and --draft explicitly",
      );
      continue;
    }

    if (BLOCKED_CREATE_FLAGS.has(option.name)) {
      addFinding(
        findings,
        `The gh pr create command uses the disallowed metadata or interactive flag ${safeLabel(option.name)}.`,
        "remove metadata and interactive flags from the Draft PR command",
      );
      if (option.inlineValue === null && index + 1 < args.length && !args[index + 1].startsWith("-")) {
        index += 1;
      }
      continue;
    }

    if (!ALLOWED_CREATE_FLAGS.has(option.name)) {
      addFinding(
        findings,
        `The gh pr create command uses an unsupported option ${safeLabel(option.name)}.`,
        "use only the exact approved Draft PR options",
      );
      if (option.inlineValue === null && index + 1 < args.length && !args[index + 1].startsWith("-")) {
        index += 1;
      }
      continue;
    }

    if (option.name === "--draft") {
      if (option.inlineValue !== null && option.inlineValue.toLowerCase() !== "true") {
        addFinding(
          findings,
          "The gh pr create command does not request Draft state with --draft=true.",
          "use the literal --draft flag",
        );
      }
      if (values.has(option.name)) {
        addFinding(
          findings,
          "The gh pr create command specifies --draft more than once.",
          "keep one literal --draft flag",
        );
      }
      values.set(option.name, option.inlineValue ?? true);
      draft = option.inlineValue === null || option.inlineValue.toLowerCase() === "true";
      continue;
    }

    if (values.has(option.name)) {
      addFinding(
        findings,
        `The gh pr create command specifies ${safeLabel(option.name)} more than once.`,
        "provide one exact value for each Draft PR option",
      );
    }

    let value = option.inlineValue;
    if (value === null) {
      if (index + 1 >= args.length || args[index + 1].startsWith("-")) {
        addFinding(
          findings,
          `The gh pr create option ${safeLabel(option.name)} has no explicit value.`,
          "provide the exact approved value for the option",
        );
        value = null;
      } else {
        index += 1;
        value = args[index];
      }
    }
    values.set(option.name, value);
  }

  return {
    values,
    draft,
  };
}

function requireValue(values, name, findings) {
  const value = values.get(name);
  if (!isNonEmptyString(value)) {
    addFinding(
      findings,
      `The gh pr create command is missing the exact ${safeLabel(name)} value.`,
      "use the approved Draft PR payload without inventing a value",
    );
    return null;
  }
  return value;
}

function validateValidationResult(validation, findings) {
  if (!isRecord(validation)) {
    addFinding(
      findings,
      "The local gate does not contain a complete ValidationResult.",
      "run validate-implementation-result and write a fresh PrePrCreateGate",
    );
    return;
  }

  if (validation.schema !== "ValidationResult" || validation.version !== 1) {
    addFinding(
      findings,
      "ValidationResult is not the supported version-1 handoff.",
      "run validate-implementation-result and write a fresh PrePrCreateGate",
    );
  }
  if (validation.status !== "passed") {
    addFinding(
      findings,
      `ValidationResult.status is ${safeLabel(validation.status ?? "missing")}, not passed.`,
      "run validate-implementation-result until the result is passed",
    );
  }

  if (!isRecord(validation.workspace)) {
    addFinding(
      findings,
      "ValidationResult.workspace is missing.",
      "verify-worktree and validate-implementation-result for the current workspace",
    );
  } else if (
    !isNonEmptyString(validation.workspace.path) ||
    !isAbsolute(validation.workspace.path) ||
    !isNonEmptyString(validation.workspace.branch) ||
    !isSha(validation.workspace.head_sha)
  ) {
    addFinding(
      findings,
      "ValidationResult.workspace is incomplete or malformed.",
      "refresh the verified workspace and validation handoffs",
    );
  }

  if (!isRecord(validation.source)) {
    addFinding(
      findings,
      "ValidationResult.source is missing.",
      "run validate-implementation-result with all source handoffs",
    );
  } else {
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
      addFinding(
        findings,
        "ValidationResult.source is incomplete.",
        "run validate-implementation-result with complete source evidence",
      );
    }
  }

  if (!Array.isArray(validation.checks)) {
    addFinding(
      findings,
      "ValidationResult.checks is missing or malformed.",
      "run the required validations and record every check",
    );
  } else {
    for (const check of validation.checks) {
      if (
        !isRecord(check) ||
        !isNonEmptyString(check.id) ||
        !isNonEmptyString(check.command) ||
        !isNonEmptyString(check.evidence) ||
        !VALID_CHECK_RESULTS.has(check.result) ||
        typeof check.required !== "boolean"
      ) {
        addFinding(
          findings,
          "ValidationResult contains a malformed check.",
          "record deterministic result and evidence for every validation check",
        );
        continue;
      }
      if (check.required && check.result !== "pass") {
        addFinding(
          findings,
          `Required validation check ${safeLabel(check.id)} is ${safeLabel(check.result)}, not pass.`,
          "rerun or resolve the required validation check",
        );
      }
    }
  }

  if (validation.required_checks_passed !== true) {
    addFinding(
      findings,
      "ValidationResult.required_checks_passed is not true.",
      "pass every required validation check",
    );
  }

  if (!isRecord(validation.evaluation)) {
    addFinding(
      findings,
      "ValidationResult.evaluation is missing.",
      "run validate-implementation-result with complete scope and completion evidence",
    );
  } else {
    if (
      !isRecord(validation.evaluation.scope) ||
      validation.evaluation.scope.status !== "aligned" ||
      !Array.isArray(validation.evaluation.scope.evidence) ||
      validation.evaluation.scope.evidence.length === 0
    ) {
      addFinding(
        findings,
        "ValidationResult scope is not aligned with non-empty evidence.",
        "resolve scope drift and validate the current implementation again",
      );
    }

    validateCriteria(
      validation.evaluation.acceptance_criteria,
      "acceptance",
      findings,
    );
    validateCriteria(
      validation.evaluation.completion_criteria,
      "completion",
      findings,
    );
    validatePlanSteps(validation.evaluation.planned_steps, findings);

    if (
      !Array.isArray(validation.evaluation.unexpected_changes) ||
      validation.evaluation.unexpected_changes.length > 0
    ) {
      addFinding(
        findings,
        "ValidationResult contains unexpected changes.",
        "resolve scope drift and produce a fresh validation result",
      );
    }

    if (!Array.isArray(validation.evaluation.documented_deviations)) {
      addFinding(
        findings,
        "ValidationResult documented deviations are missing.",
        "record every deviation and validate its current status",
      );
    } else if (
      validation.evaluation.documented_deviations.some(
        (deviation) => !isRecord(deviation) || deviation.documented !== true,
      )
    ) {
      addFinding(
        findings,
        "ValidationResult contains an undocumented deviation.",
        "document or resolve every implementation deviation before publishing",
      );
    }
  }

  if (!Array.isArray(validation.blockers)) {
    addFinding(
      findings,
      "ValidationResult.blockers is missing or malformed.",
      "run validate-implementation-result with blocker evidence",
    );
  } else if (validation.blockers.length > 0) {
    addFinding(
      findings,
      `ValidationResult has ${validation.blockers.length} open blocker(s).`,
      "resolve all validation blockers before Draft PR creation",
    );
  }

  if (!Array.isArray(validation.warnings)) {
    addFinding(
      findings,
      "ValidationResult.warnings is missing or malformed.",
      "run validate-implementation-result with complete warning evidence",
    );
  }

  if (
    !isRecord(validation.readiness) ||
    validation.readiness.commit_preparation_allowed !== true ||
    validation.readiness.draft_pr_preparation_allowed !== true ||
    !Array.isArray(validation.readiness.reasons)
  ) {
    addFinding(
      findings,
      "ValidationResult readiness does not allow Draft PR preparation.",
      "run validate-implementation-result with draft_pr_preparation_allowed=true",
    );
  }

  if (validation.failure !== null) {
    addFinding(
      findings,
      "ValidationResult.failure is not null.",
      "resolve the validation failure and produce a fresh passed result",
    );
  }

  if (
    !Object.hasOwn(validation, "recommended_next_skill") ||
    (validation.recommended_next_skill !== null &&
      !isNonEmptyString(validation.recommended_next_skill))
  ) {
    addFinding(
      findings,
      "ValidationResult.recommended_next_skill is missing or malformed.",
      "write a complete version-1 ValidationResult",
    );
  }
}

function validateCriteria(criteria, label, findings) {
  if (!Array.isArray(criteria)) {
    addFinding(
      findings,
      `ValidationResult ${label} criteria are missing.`,
      "run validate-implementation-result with complete criteria evidence",
    );
    return;
  }

  for (const criterion of criteria) {
    if (
      !isRecord(criterion) ||
      !isNonEmptyString(criterion.criterion) ||
      !VALID_CRITERION_RESULTS.has(criterion.status) ||
      !Array.isArray(criterion.evidence) ||
      criterion.evidence.length === 0
    ) {
      addFinding(
        findings,
        `ValidationResult contains a malformed ${label} criterion.`,
        "record evidence for every acceptance and completion criterion",
      );
      continue;
    }
    if (criterion.status !== "pass") {
      addFinding(
        findings,
        `ValidationResult contains an unpassed ${label} criterion.`,
        "satisfy every acceptance and completion criterion",
      );
    }
  }
}

function validatePlanSteps(steps, findings) {
  if (!Array.isArray(steps)) {
    addFinding(
      findings,
      "ValidationResult planned steps are missing.",
      "run validate-implementation-result with complete plan-step evidence",
    );
    return;
  }

  for (const step of steps) {
    if (
      !isRecord(step) ||
      !isNonEmptyString(step.id) ||
      !VALID_PLAN_STEP_RESULTS.has(step.status) ||
      !Array.isArray(step.evidence) ||
      step.evidence.length === 0
    ) {
      addFinding(
        findings,
        "ValidationResult contains a malformed planned step.",
        "record evidence for every completed implementation step",
      );
      continue;
    }
    if (step.status !== "completed") {
      addFinding(
        findings,
        `ValidationResult planned step ${safeLabel(step.id)} is not completed.`,
        "complete or explicitly resolve every planned implementation step",
      );
    }
  }
}

function validateCommitProposal(commitProposal, findings) {
  if (!isRecord(commitProposal)) {
    addFinding(
      findings,
      "The local gate does not contain a CommitProposal.",
      "create and verify the commit before Draft PR creation",
    );
    return;
  }

  if (commitProposal.schema !== "CommitProposal" || commitProposal.version !== 1) {
    addFinding(
      findings,
      "CommitProposal is not the supported version-1 handoff.",
      "create a fresh version-1 CommitProposal",
    );
  }
  if (commitProposal.status !== "created") {
    addFinding(
      findings,
      `CommitProposal.status is ${safeLabel(commitProposal.status ?? "missing")}, not created.`,
      "create and verify one commit before Draft PR creation",
    );
  }
  if (!validateRepositoryName(commitProposal.repository)) {
    addFinding(
      findings,
      "CommitProposal.repository is missing or malformed.",
      "use the verified owner/repository identity",
    );
  }
  if (!isNonEmptyString(commitProposal.branch)) {
    addFinding(
      findings,
      "CommitProposal.branch is missing.",
      "create a commit on the verified feature branch",
    );
  }
  if (!isRecord(commitProposal.commit)) {
    addFinding(
      findings,
      "CommitProposal.commit is missing.",
      "verify the created commit and record its result",
    );
  } else {
    if (!isSha(commitProposal.commit.sha)) {
      addFinding(
        findings,
        "CommitProposal.commit.sha is missing or malformed.",
        "verify the created commit SHA",
      );
    }
    if (!isIsoTimestamp(commitProposal.commit.created_at)) {
      addFinding(
        findings,
        "CommitProposal.commit.created_at is missing or malformed.",
        "record the verified commit timestamp",
      );
    }
    if (
      !Array.isArray(commitProposal.commit.files_committed) ||
      commitProposal.commit.files_committed.length === 0
    ) {
      addFinding(
        findings,
        "CommitProposal.commit.files_committed is missing, empty, or malformed.",
        "verify the committed file scope",
      );
    }
  }

  if (!isRecord(commitProposal.files) || !isRecord(commitProposal.message)) {
    addFinding(
      findings,
      "CommitProposal scope or message is missing.",
      "preserve the exact created CommitProposal in the gate",
    );
  }
  if (!isRecord(commitProposal.authorization)) {
    addFinding(
      findings,
      "CommitProposal authorization is missing.",
      "preserve the task-scoped authorization evidence",
    );
  } else if (
    commitProposal.authorization.exact_scope_approved !== true ||
    commitProposal.authorization.commit_authorized !== true ||
    !ALLOWED_AUTHORIZATION_SOURCES.has(commitProposal.authorization.source) ||
    !isNonEmptyString(commitProposal.authorization.task_scope) ||
    !isNonEmptyString(commitProposal.authorization.evidence)
  ) {
    addFinding(
      findings,
      "CommitProposal authorization does not prove the exact committed scope.",
      "preserve the verified task-scoped commit authorization",
    );
  }
  if (isRecord(commitProposal.validation)) {
    if (
      commitProposal.validation.result_status !== "passed" ||
      !Array.isArray(commitProposal.validation.evidence) ||
      commitProposal.validation.evidence.length === 0
    ) {
      addFinding(
        findings,
        "CommitProposal does not carry passed validation evidence.",
        "refresh the commit handoff from the current passed ValidationResult",
      );
    }
  }
}

function validateBranchPush(branchPush, findings) {
  if (!isRecord(branchPush)) {
    addFinding(
      findings,
      "The local gate does not contain a BranchPush handoff.",
      "push the feature branch without force and record verified remote evidence",
    );
    return;
  }

  if (branchPush.schema !== "BranchPush" || branchPush.version !== 1) {
    addFinding(
      findings,
      "BranchPush is not the supported version-1 handoff.",
      "write a fresh version-1 BranchPush result",
    );
  }
  if (branchPush.status !== "verified") {
    addFinding(
      findings,
      `BranchPush.status is ${safeLabel(branchPush.status ?? "missing")}, not verified.`,
      "push the branch and verify the remote SHA",
    );
  }
  if (!validateRepositoryName(branchPush.repository)) {
    addFinding(
      findings,
      "BranchPush.repository is missing or malformed.",
      "use the verified owner/repository identity",
    );
  }
  if (!isNonEmptyString(branchPush.branch_name)) {
    addFinding(
      findings,
      "BranchPush.branch_name is missing.",
      "record the exact pushed feature branch",
    );
  }
  if (!isNonEmptyString(branchPush.worktree_path) || !isAbsolute(branchPush.worktree_path)) {
    addFinding(
      findings,
      "BranchPush.worktree_path is missing or not absolute.",
      "verify the expected worktree before publishing",
    );
  }

  if (!isRecord(branchPush.remote) || !isNonEmptyString(branchPush.remote.name)) {
    addFinding(
      findings,
      "BranchPush.remote.name is missing.",
      "record the verified remote name",
    );
  } else if (!/^[A-Za-z0-9._-]+$/.test(branchPush.remote.name)) {
    addFinding(
      findings,
      "BranchPush.remote.name is not a safe Git remote name.",
      "use the verified named remote without URL or option syntax",
    );
  }
  if (isRecord(branchPush.remote) && !validateRepositoryName(branchPush.remote.owner_repository)) {
    addFinding(
      findings,
      "BranchPush.remote.owner_repository is missing or malformed.",
      "verify the remote repository identity",
    );
  }

  if (!isRecord(branchPush.upstream)) {
    addFinding(
      findings,
      "BranchPush.upstream evidence is missing.",
      "verify the configured upstream branch",
    );
  } else if (
    branchPush.upstream.exists !== true ||
    !isNonEmptyString(branchPush.upstream.ref) ||
    !Number.isInteger(branchPush.upstream.ahead) ||
    branchPush.upstream.ahead < 0 ||
    !Number.isInteger(branchPush.upstream.behind) ||
    branchPush.upstream.behind < 0
  ) {
    addFinding(
      findings,
      "BranchPush.upstream does not prove a configured, synchronized upstream.",
      "push and verify the exact upstream branch",
    );
  }

  if (!isRecord(branchPush.authorization)) {
    addFinding(
      findings,
      "BranchPush.authorization is missing.",
      "preserve the authorization evidence for the branch push",
    );
  } else if (
    branchPush.authorization.push_authorized !== true ||
    branchPush.authorization.force_push_authorized !== false
  ) {
    addFinding(
      findings,
      "BranchPush authorization does not prove a routine non-force push.",
      "use the task-scoped non-force push authorization",
    );
  }

  if (!isRecord(branchPush.local)) {
    addFinding(
      findings,
      "BranchPush.local evidence is missing.",
      "record the local branch and commit state after the push",
    );
  } else {
    if (!isSha(branchPush.local.head_sha)) {
      addFinding(
        findings,
        "BranchPush.local.head_sha is missing or malformed.",
        "record the pushed local HEAD SHA",
      );
    }
    if (branchPush.local.branch_match !== true || branchPush.local.detached !== false) {
      addFinding(
        findings,
        "BranchPush does not prove a matching non-detached branch.",
        "verify the feature branch before pushing again",
      );
    }
    if (branchPush.local.in_progress_operation !== null) {
      addFinding(
        findings,
        "BranchPush records an in-progress Git operation.",
        "finish or safely resolve the Git operation before publishing",
      );
    }
  }

  if (!isRecord(branchPush.push)) {
    addFinding(
      findings,
      "BranchPush.push evidence is missing.",
      "record the exact non-force push result",
    );
  } else {
    if (
      branchPush.push.forced !== false ||
      ![undefined, null, "none"].includes(branchPush.push.force_mode)
    ) {
      addFinding(
        findings,
        "BranchPush does not prove a non-force push.",
        "push the branch without force",
      );
    }
    if (!isSha(branchPush.push.remote_sha)) {
      addFinding(
        findings,
        "BranchPush.push.remote_sha is missing or malformed.",
        "verify the remote branch SHA",
      );
    }
    if (!isNonEmptyString(branchPush.push.remote_ref)) {
      addFinding(
        findings,
        "BranchPush.push.remote_ref is missing.",
        "record the exact remote branch ref",
      );
    } else if (
      isNonEmptyString(branchPush.branch_name) &&
      branchPush.push.remote_ref !== `refs/heads/${branchPush.branch_name}`
    ) {
      addFinding(
        findings,
        "BranchPush.push.remote_ref does not match the pushed feature branch.",
        "refresh the BranchPush result for the exact remote branch",
      );
    }
    if (!["success", "up_to_date"].includes(branchPush.push.result)) {
      addFinding(
        findings,
        "BranchPush.push.result does not prove a successful push.",
        "push and verify the branch without force",
      );
    }
  }

  if (!isRecord(branchPush.verification)) {
    addFinding(
      findings,
      "BranchPush.verification is missing.",
      "verify repository, branch, remote existence, SHA, and upstream",
    );
  } else {
    for (const field of [
      "repository_match",
      "branch_match",
      "remote_branch_exists",
      "sha_match",
      "upstream_configured",
    ]) {
      if (branchPush.verification[field] !== "pass") {
        addFinding(
          findings,
          `BranchPush.verification.${safeLabel(field)} is not pass.`,
          "refresh and verify the pushed branch evidence",
        );
      }
    }
  }
  if (Object.hasOwn(branchPush, "failure") && branchPush.failure !== null) {
    addFinding(
      findings,
      "BranchPush.failure is not null.",
      "resolve the push failure and refresh the verified BranchPush result",
    );
  }
}

function validatePullRequestDraft(draft, findings) {
  if (!isRecord(draft)) {
    addFinding(
      findings,
      "The local gate does not contain a PullRequestDraft.",
      "compose an exact Draft PR payload from verified evidence",
    );
    return;
  }

  if (draft.schema !== "PullRequestDraft" || draft.version !== 1) {
    addFinding(
      findings,
      "PullRequestDraft is not the supported version-1 handoff.",
      "compose a fresh version-1 PullRequestDraft",
    );
  }
  if (draft.status !== "draft") {
    addFinding(
      findings,
      `PullRequestDraft.status is ${safeLabel(draft.status ?? "missing")}, not draft.`,
      "compose a new unpublished Draft PR payload",
    );
  }
  if (!validateRepositoryName(draft.repository)) {
    addFinding(
      findings,
      "PullRequestDraft.repository is missing or malformed.",
      "use the verified owner/repository identity",
    );
  }
  if (!isNonEmptyString(draft.title)) {
    addFinding(
      findings,
      "PullRequestDraft.title is missing.",
      "compose the exact approved title without inventing one",
    );
  } else if (/^\s*\[draft\]\b/i.test(draft.title)) {
    addFinding(
      findings,
      "PullRequestDraft.title contains a [Draft] prefix.",
      "remove the prefix and keep draft state in the --draft flag",
    );
  }
  if (!isNonEmptyString(draft.body)) {
    addFinding(
      findings,
      "PullRequestDraft.body is missing.",
      "compose the complete approved body without inventing sections",
    );
  }
  if (!isNonEmptyString(draft.base_branch) || !isNonEmptyString(draft.head_branch)) {
    addFinding(
      findings,
      "PullRequestDraft base or head branch is missing.",
      "use the verified base and feature branches",
    );
  } else if (draft.base_branch === draft.head_branch) {
    addFinding(
      findings,
      "PullRequestDraft base and head branches are identical.",
      "use a distinct verified feature branch for the Draft PR",
    );
  }
  if (!isSha(draft.head_sha)) {
    addFinding(
      findings,
      "PullRequestDraft.head_sha is missing or malformed.",
      "bind the Draft PR payload to the verified commit SHA",
    );
  }
  if (draft.draft !== true) {
    addFinding(
      findings,
      "PullRequestDraft.draft is not true.",
      "compose and create only a Draft pull request",
    );
  }
  if (draft.number !== undefined && draft.number !== null) {
    addFinding(
      findings,
      "PullRequestDraft already contains a published pull-request number.",
      "use an unpublished Draft PR payload",
    );
  }
  if (draft.url !== undefined && draft.url !== null) {
    addFinding(
      findings,
      "PullRequestDraft already contains a published pull-request URL.",
      "use an unpublished Draft PR payload",
    );
  }
  if (draft.created_at !== undefined && draft.created_at !== null) {
    addFinding(
      findings,
      "PullRequestDraft already contains a publication timestamp.",
      "use an unpublished Draft PR payload",
    );
  }

  if (!Array.isArray(draft.linked_issues) || draft.linked_issues.length !== 1) {
    addFinding(
      findings,
      "PullRequestDraft does not contain exactly one linked issue.",
      "resolve issue linkage and preserve exactly one verified issue",
    );
  } else {
    const issue = draft.linked_issues[0];
    if (
      !isRecord(issue) ||
      !validateRepositoryName(issue.repository) ||
      !Number.isInteger(issue.number) ||
      issue.number < 1
    ) {
      addFinding(
        findings,
        "PullRequestDraft linked issue identity is malformed.",
        "use one verified owner/repository and positive issue number",
      );
    }
  }

  if (
    !isRecord(draft.validation) ||
    draft.validation.result_status !== "passed" ||
    !Array.isArray(draft.validation.evidence) ||
    draft.validation.evidence.length === 0
  ) {
    addFinding(
      findings,
      "PullRequestDraft does not carry passed validation evidence.",
      "compose the Draft PR from the current passed ValidationResult",
    );
  }

  if (!isRecord(draft.authorization)) {
    addFinding(
      findings,
      "PullRequestDraft authorization is missing.",
      "preserve the exact task-scoped Draft PR authorization",
    );
  } else if (
    draft.authorization.push_authorized !== true ||
    draft.authorization.draft_pull_request_authorized !== true ||
    !ALLOWED_AUTHORIZATION_SOURCES.has(draft.authorization.source) ||
    !isNonEmptyString(draft.authorization.task_scope) ||
    !isNonEmptyString(draft.authorization.evidence)
  ) {
    addFinding(
      findings,
      "PullRequestDraft authorization does not cover this exact publication.",
      "preserve verified task-scoped push and Draft PR authorization",
    );
  }
}

function validateIssueLink(issueLink, findings) {
  if (!isRecord(issueLink)) {
    addFinding(
      findings,
      "The local gate does not contain a PullRequestIssueLink.",
      "resolve exactly one issue link before Draft PR creation",
    );
    return;
  }

  if (issueLink.schema !== "PullRequestIssueLink" || issueLink.version !== 1) {
    addFinding(
      findings,
      "PullRequestIssueLink is not the supported version-1 handoff.",
      "write a fresh version-1 PullRequestIssueLink",
    );
  }
  if (issueLink.status !== "linked") {
    addFinding(
      findings,
      `PullRequestIssueLink.status is ${safeLabel(issueLink.status ?? "missing")}, not linked.`,
      "resolve the issue relationship without selecting an ambiguous issue",
    );
  }
  if (!validateRepositoryName(issueLink.repository)) {
    addFinding(
      findings,
      "PullRequestIssueLink.repository is missing or malformed.",
      "use the verified owner/repository identity",
    );
  }

  if (
    !isRecord(issueLink.issue) ||
    !validateRepositoryName(issueLink.issue.repository) ||
    !Number.isInteger(issueLink.issue.number) ||
    issueLink.issue.number < 1
  ) {
    addFinding(
      findings,
      "PullRequestIssueLink.issue is missing or malformed.",
      "load and link exactly one verified issue",
    );
  }

  if (!isRecord(issueLink.pull_request)) {
    addFinding(
      findings,
      "PullRequestIssueLink.pull_request is missing.",
      "bind the issue link to the exact Draft PR branches and SHA",
    );
  } else {
    if (!validateRepositoryName(issueLink.pull_request.repository)) {
      addFinding(
        findings,
        "PullRequestIssueLink.pull_request.repository is missing or malformed.",
        "use the verified owner/repository identity",
      );
    }
    if (!isNonEmptyString(issueLink.pull_request.base_branch) || !isNonEmptyString(issueLink.pull_request.head_branch)) {
      addFinding(
        findings,
        "PullRequestIssueLink.pull_request branch identity is incomplete.",
        "bind the issue link to the exact base and head branches",
      );
    }
    if (!isSha(issueLink.pull_request.head_sha)) {
      addFinding(
        findings,
        "PullRequestIssueLink.pull_request.head_sha is missing or malformed.",
        "bind the issue link to the verified commit SHA",
      );
    }
    if (issueLink.pull_request.draft !== true) {
      addFinding(
        findings,
        "PullRequestIssueLink.pull_request.draft is not true.",
        "link the issue only to the Draft PR payload",
      );
    }
  }

  if (!isNonEmptyString(issueLink.keyword_text)) {
    addFinding(
      findings,
      "PullRequestIssueLink.keyword_text is missing.",
      "preserve the exact verified issue-reference text in the PR body",
    );
  }
  if (!Array.isArray(issueLink.linked_issues) || issueLink.linked_issues.length !== 1) {
    addFinding(
      findings,
      "PullRequestIssueLink does not contain exactly one linked issue.",
      "resolve ambiguous issue candidates before publishing",
    );
  }
  if (!Array.isArray(issueLink.evidence) || issueLink.evidence.length === 0) {
    addFinding(
      findings,
      "PullRequestIssueLink evidence is missing.",
      "record the evidence for the unique issue relationship",
    );
  }
  if (!Array.isArray(issueLink.blockers)) {
    addFinding(
      findings,
      "PullRequestIssueLink.blockers is missing or malformed.",
      "resolve the issue-link handoff before publishing",
    );
  } else if (issueLink.blockers.length > 0) {
    addFinding(
      findings,
      `PullRequestIssueLink has ${issueLink.blockers.length} open blocker(s).`,
      "resolve every issue-link blocker",
    );
  }
  if (!Array.isArray(issueLink.ambiguous_candidates)) {
    addFinding(
      findings,
      "PullRequestIssueLink.ambiguous_candidates is missing or malformed.",
      "resolve issue candidates deterministically",
    );
  } else if (issueLink.ambiguous_candidates.length > 0) {
    addFinding(
      findings,
      `PullRequestIssueLink has ${issueLink.ambiguous_candidates.length} ambiguous issue candidate(s).`,
      "select one verified issue through the linkage workflow",
    );
  }
  if (!isNonEmptyString(issueLink.rationale)) {
    addFinding(
      findings,
      "PullRequestIssueLink.rationale is missing.",
      "preserve the evidence-backed linkage rationale",
    );
  }
  if (issueLink.failure !== null) {
    addFinding(
      findings,
      "PullRequestIssueLink.failure is not null.",
      "resolve the issue-link failure and produce a fresh linked result",
    );
  }
}

function compareIssueIdentity(left, right) {
  return (
    isRecord(left) &&
    isRecord(right) &&
    normalizeRepository(left.repository) === normalizeRepository(right.repository) &&
    left.number === right.number
  );
}

function validateGate(gate, findings) {
  if (!isRecord(gate)) {
    addFinding(
      findings,
      "PrePrCreateGate is missing or malformed.",
      "write a fresh version-1 PrePrCreateGate before gh pr create",
    );
    return;
  }
  if (gate.schema !== "PrePrCreateGate" || gate.version !== 1) {
    addFinding(
      findings,
      "PrePrCreateGate has an unsupported schema version.",
      "write a fresh version-1 PrePrCreateGate",
    );
  }
  if (!isIsoTimestamp(gate.written_at)) {
    addFinding(
      findings,
      "PrePrCreateGate.written_at is missing or malformed.",
      "write a fresh current PrePrCreateGate",
    );
  }

  if (!isRecord(gate.workspace)) {
    addFinding(
      findings,
      "PrePrCreateGate.workspace is missing.",
      "verify the current worktree before Draft PR creation",
    );
  } else if (
    !validateRepositoryName(gate.workspace.repository) ||
    !isNonEmptyString(gate.workspace.path) ||
    !isAbsolute(gate.workspace.path) ||
    !isNonEmptyString(gate.workspace.branch) ||
    !isSha(gate.workspace.head_sha)
  ) {
    addFinding(
      findings,
      "PrePrCreateGate.workspace is incomplete or malformed.",
      "refresh repository, worktree, branch, and HEAD evidence",
    );
  }

  validateValidationResult(gate.validation, findings);
  validateCommitProposal(gate.commit_proposal, findings);
  validateBranchPush(gate.branch_push, findings);
  validatePullRequestDraft(gate.pull_request_draft, findings);
  validateIssueLink(gate.issue_link, findings);
}

function compareGateIdentities(gate, repositoryRoot, branch, headSha, commandValues, findings) {
  const workspace = gate.workspace;
  const validation = gate.validation;
  const commitProposal = gate.commit_proposal;
  const branchPush = gate.branch_push;
  const draft = gate.pull_request_draft;
  const issueLink = gate.issue_link;

  if (!isRecord(workspace)) {
    return;
  }

  const repository = workspace.repository;
  const workspacePathValid = isNonEmptyString(workspace.path) && isAbsolute(workspace.path);
  if (workspacePathValid) {
    if (normalizeAbsolutePath(workspace.path) !== normalizeAbsolutePath(repositoryRoot)) {
      addFinding(
        findings,
        "PrePrCreateGate.workspace.path does not match the live Git root.",
        "run the publication workflow from the verified implementation worktree",
      );
    }
  }
  if (workspace.branch !== branch) {
    addFinding(
      findings,
      "PrePrCreateGate.workspace.branch does not match the live feature branch.",
      "refresh the gate from the currently checked-out feature branch",
    );
  }
  if (
    isSha(workspace.head_sha) &&
    workspace.head_sha.toLowerCase() !== headSha.toLowerCase()
  ) {
    addFinding(
      findings,
      "PrePrCreateGate.workspace.head_sha does not match the live HEAD.",
      "create a fresh identity-matched publication gate",
    );
  }
  const identityValues = [
    ...(workspacePathValid
      ? [
          ["ValidationResult.workspace", validation?.workspace?.path, workspace.path, "path"],
          ["BranchPush.worktree_path", branchPush?.worktree_path, workspace.path, "path"],
        ]
      : []),
  ];
  for (const [label, actual, expected, kind] of identityValues) {
    if (!isNonEmptyString(actual)) {
      continue;
    }
    const matches =
      kind === "path"
        ? normalizeAbsolutePath(actual) === normalizeAbsolutePath(expected)
        : actual === expected;
    if (!matches) {
      addFinding(
        findings,
        `${label} does not match the PrePrCreateGate worktree.`,
        "refresh every handoff from the same verified worktree",
      );
    }
  }

  const repositoryValues = [
    ["CommitProposal.repository", commitProposal?.repository],
    ["BranchPush.repository", branchPush?.repository],
    ["BranchPush.remote.owner_repository", branchPush?.remote?.owner_repository],
    ["PullRequestDraft.repository", draft?.repository],
    ["PullRequestIssueLink.repository", issueLink?.repository],
    ["PullRequestIssueLink.issue.repository", issueLink?.issue?.repository],
    ["PullRequestIssueLink.pull_request.repository", issueLink?.pull_request?.repository],
  ];
  for (const [label, actual] of repositoryValues) {
    if (isNonEmptyString(actual) && normalizeRepository(actual) !== normalizeRepository(repository)) {
      addFinding(
        findings,
        `${label} does not match the verified repository.`,
        "refresh all handoffs for one explicit owner/repository",
      );
    }
  }

  const branchValues = [
    ["ValidationResult.workspace.branch", validation?.workspace?.branch],
    ["CommitProposal.branch", commitProposal?.branch],
    ["BranchPush.branch_name", branchPush?.branch_name],
    ["PullRequestDraft.head_branch", draft?.head_branch],
    ["PullRequestIssueLink.pull_request.head_branch", issueLink?.pull_request?.head_branch],
  ];
  for (const [label, actual] of branchValues) {
    if (isNonEmptyString(actual) && actual !== branch) {
      addFinding(
        findings,
        `${label} does not match the live feature branch.`,
        "refresh all handoffs for the currently checked-out feature branch",
      );
    }
  }

  const shaValues = [
    ["ValidationResult.workspace.head_sha", validation?.workspace?.head_sha],
    ["CommitProposal.commit.sha", commitProposal?.commit?.sha],
    ["BranchPush.local.head_sha", branchPush?.local?.head_sha],
    ["BranchPush.push.remote_sha", branchPush?.push?.remote_sha],
    ["PullRequestDraft.head_sha", draft?.head_sha],
    ["PullRequestIssueLink.pull_request.head_sha", issueLink?.pull_request?.head_sha],
  ];
  for (const [label, actual] of shaValues) {
    if (isSha(actual) && actual.toLowerCase() !== headSha.toLowerCase()) {
      addFinding(
        findings,
        `${label} does not match the live HEAD.`,
        "create a fresh identity-matched commit and publication gate",
      );
    }
  }

  if (isRecord(draft) && isRecord(issueLink)) {
    if (!compareIssueIdentity(draft.linked_issues?.[0], issueLink.linked_issues?.[0])) {
      addFinding(
        findings,
        "PullRequestDraft and PullRequestIssueLink do not identify the same single issue.",
        "resolve and preserve exactly one matching issue link",
      );
    }
    if (!compareIssueIdentity(draft.linked_issues?.[0], issueLink.issue)) {
      addFinding(
        findings,
        "The Draft PR issue and the linked issue handoff do not match.",
        "refresh the issue-link handoff without inferring another issue",
      );
    }
    if (isNonEmptyString(issueLink.keyword_text) && isNonEmptyString(draft.body)) {
      if (!draft.body.includes(issueLink.keyword_text)) {
        addFinding(
          findings,
          "PullRequestDraft.body does not contain the exact verified issue-reference text.",
          "recompose the body from the verified issue link without editing it in the hook",
        );
      }
    }
    if (
      issueLink.pull_request?.base_branch !== draft.base_branch ||
      issueLink.pull_request?.head_branch !== draft.head_branch ||
      issueLink.pull_request?.draft !== true
    ) {
      addFinding(
        findings,
        "PullRequestIssueLink.pull_request does not match the Draft PR identity.",
        "refresh the issue-link handoff for the exact Draft PR target",
      );
    }
  }

  const commandRepository = commandValues.get("--repo");
  const commandBase = commandValues.get("--base");
  const commandHead = commandValues.get("--head");
  if (isNonEmptyString(commandRepository) && normalizeRepository(commandRepository) !== normalizeRepository(repository)) {
    addFinding(
      findings,
      "The command --repo target does not match the verified gate repository.",
      "use the exact repository from the approved Draft PR payload",
    );
  }
  if (isRecord(draft) && isNonEmptyString(commandBase) && commandBase !== draft.base_branch) {
    addFinding(
      findings,
      "The command --base target does not match the approved Draft PR base branch.",
      "use the exact approved base branch",
    );
  }
  if (isNonEmptyString(commandHead) && commandHead !== branch) {
    addFinding(
      findings,
      "The command --head target does not match the live feature branch.",
      "use the exact pushed feature branch",
    );
  }
}

function validateDescription(draft, commandValues, bodyText, findings) {
  if (!isRecord(draft)) {
    return;
  }

  const title = commandValues.get("--title");
  if (isNonEmptyString(title) && title !== draft.title) {
    addFinding(
      findings,
      "The command title differs from the exact approved PullRequestDraft.title.",
      "use the approved title without rewriting it",
    );
  }
  if (bodyText !== null && bodyText !== draft.body) {
    addFinding(
      findings,
      "The command body differs from the exact approved PullRequestDraft.body.",
      "use the approved body without rewriting or completing it in the hook",
    );
  }

  if (!isNonEmptyString(draft.body)) {
    return;
  }

  const headings = new Set();
  for (const line of draft.body.split(/\r?\n/)) {
    const match = line.match(/^\s*(#{2,3})\s+(.+?)\s*#*\s*$/i);
    if (match) {
      headings.add(match[2].trim().toLowerCase());
    }
  }

  const missingHeadings = REQUIRED_DESCRIPTION_HEADINGS.filter(
    (heading) => !heading.names.some((name) => headings.has(name)),
  ).map((heading) => heading.label);
  if (missingHeadings.length > 0) {
    addFinding(
      findings,
      `PullRequestDraft.body is missing required sections: ${missingHeadings.join(", ")}.`,
      "recompose the complete English Draft PR description from supplied evidence",
    );
  }
}

function readCommandBody(invocation, commandValues, findings) {
  const inlineBody = commandValues.get("--body");
  const bodyFile = commandValues.get("--body-file");

  if (inlineBody !== undefined && bodyFile !== undefined) {
    addFinding(
      findings,
      "The gh pr create command specifies both --body and --body-file.",
      "use exactly one approved body source",
    );
    return null;
  }

  if (bodyFile !== undefined) {
    if (!isNonEmptyString(bodyFile) || bodyFile === "-") {
      addFinding(
        findings,
        "The gh pr create --body-file value is missing or reads from stdin.",
        "use the approved readable temporary body file",
      );
      return null;
    }
    const bodyPath = isAbsolute(bodyFile)
      ? bodyFile
      : resolve(invocation.targetDirectory, bodyFile);
    try {
      const fileStats = statSync(bodyPath);
      if (!fileStats.isFile()) {
        addFinding(
          findings,
          "The gh pr create body file is not a regular file.",
          "provide the exact approved body file",
        );
        return null;
      }
      if (fileStats.size > MAX_BODY_FILE_BYTES) {
        addFinding(
          findings,
          "The gh pr create body file exceeds the deterministic size limit.",
          "use the exact approved body file within the supported size limit",
        );
        return null;
      }
      return readFileSync(bodyPath).toString("utf8");
    } catch {
      addFinding(
        findings,
        "The gh pr create body file is missing or unreadable.",
        "write and pass the exact approved body file",
      );
      return null;
    }
  }

  if (inlineBody !== undefined) {
    if (typeof inlineBody !== "string") {
      addFinding(
        findings,
        "The gh pr create --body value is malformed.",
        "use the exact approved body text",
      );
      return null;
    }
    return inlineBody;
  }

  addFinding(
    findings,
    "The gh pr create command has no explicit --body or --body-file value.",
    "use the exact approved body without asking gh to infer it",
  );
  return null;
}

function readGate(repositoryRoot, findings) {
  const gatePath = statePathForRoot(repositoryRoot);
  try {
    return JSON.parse(readFileSync(gatePath, "utf8"));
  } catch {
    addFinding(
      findings,
      `The local PrePrCreateGate is missing or unreadable at ${GATE_RELATIVE_PATH}.`,
      "validate the implementation and write a fresh PrePrCreateGate",
    );
    return null;
  }
}

function verifyRemoteBranch(repositoryRoot, branchPush, branch, headSha, findings) {
  const remoteName = branchPush?.remote?.name;
  if (!isNonEmptyString(remoteName) || !/^[A-Za-z0-9._-]+$/.test(remoteName)) {
    return;
  }

  let output;
  try {
    output = runGit(repositoryRoot, ["ls-remote", "--heads", remoteName, branch]);
  } catch {
    addFinding(
      findings,
      "The live remote branch could not be verified with git ls-remote.",
      "verify remote access and push the exact feature branch without force",
    );
    return;
  }

  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const matchingLine = lines.find((line) => line.endsWith(`\trefs/heads/${branch}`));
  const remoteSha = matchingLine?.split(/\s+/)[0] ?? null;
  if (!isSha(remoteSha)) {
    addFinding(
      findings,
      "The live remote feature branch does not exist or has no verifiable SHA.",
      "push the exact feature branch and verify its remote SHA",
    );
    return;
  }
  if (remoteSha.toLowerCase() !== headSha.toLowerCase()) {
    addFinding(
      findings,
      "The live remote feature branch SHA does not match the current HEAD.",
      "push the current commit without force and refresh the gate",
    );
  }
  if (lines.length !== 1 || !matchingLine) {
    addFinding(
      findings,
      "The live remote query returned an ambiguous feature-branch result.",
      "verify one exact remote branch target before publishing",
    );
  }
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
  const initialDirectory = inputDirectory === null ? null : resolve(inputDirectory);
  const likelyCreate = /(?:^|[;&|]\s*)(?:(?:command|env|exec|nice|nohup|setsid|sudo)\s+)*(?:[^\s;&|()]+[\\/])?gh(?:\.exe|\.cmd|\.bat)?\s+pr\s+create(?:\s|$)/i.test(
    command,
  );
  const identified = identifyPrCreateInvocations(command, initialDirectory);

  if (identified.invocations.length === 0) {
    if (!identified.parseable && likelyCreate) {
      return makeDeny([
        {
          requirement: identified.reason ?? "The gh pr create command could not be parsed safely.",
          nextStep: "run gh pr create with explicit, parseable named options",
        },
      ]);
    }
    return makeAllow();
  }

  const findings = [];
  if (!identified.parseable) {
    addFinding(
      findings,
      identified.reason ?? "The gh pr create command could not be parsed safely.",
      "run gh pr create with explicit, parseable named options",
    );
  }
  if (identified.invocations.length > 1) {
    addFinding(
      findings,
      "The shell command contains more than one gh pr create invocation.",
      "run exactly one verified Draft PR creation command",
    );
  }

  const invocation = identified.invocations[0];
  if (invocation.parseError) {
    addFinding(findings, invocation.parseError, "run gh pr create from the verified worktree");
  }
  if (!isNonEmptyString(initialDirectory)) {
    addFinding(
      findings,
      "The hook did not receive the gh pr create working directory.",
      "run the command from the verified implementation worktree",
    );
    return makeDeny(findings);
  }
  if (!existsSync(invocation.targetDirectory)) {
    addFinding(
      findings,
      "The gh pr create target worktree does not exist.",
      "run the command from the verified implementation worktree",
    );
    return makeDeny(findings);
  }

  const commandArguments = parseCreateArguments(invocation.args, findings);
  const commandValues = commandArguments.values;
  if (!commandArguments.draft) {
    addFinding(
      findings,
      "The gh pr create command does not request Draft state.",
      "include the literal --draft flag",
    );
  }

  const commandRepository = requireValue(commandValues, "--repo", findings);
  const commandBase = requireValue(commandValues, "--base", findings);
  const commandHead = requireValue(commandValues, "--head", findings);
  const commandTitle = requireValue(commandValues, "--title", findings);
  if (commandRepository !== null && !validateRepositoryName(commandRepository)) {
    addFinding(
      findings,
      "The command --repo value is not an explicit owner/repository identity.",
      "use the exact owner/repository from the approved Draft PR payload",
    );
  }
  if (commandBase !== null && !isNonEmptyString(commandBase)) {
    addFinding(
      findings,
      "The command --base value is empty.",
      "use the exact approved base branch",
    );
  }
  if (commandHead !== null && !isNonEmptyString(commandHead)) {
    addFinding(
      findings,
      "The command --head value is empty.",
      "use the exact approved feature branch",
    );
  }
  if (commandTitle !== null && !isNonEmptyString(commandTitle)) {
    addFinding(
      findings,
      "The command --title value is empty.",
      "use the exact approved title",
    );
  }

  const bodyText = readCommandBody(invocation, commandValues, findings);

  let repositoryRoot;
  let branch;
  let headSha;
  try {
    repositoryRoot = runGit(invocation.targetDirectory, ["rev-parse", "--show-toplevel"]);
    branch = runGit(invocation.targetDirectory, ["branch", "--show-current"]);
    headSha = runGit(invocation.targetDirectory, ["rev-parse", "--verify", "HEAD^{commit}"]);
  } catch (error) {
    const operation = error instanceof GitCommandError ? error.operation : "repository identity";
    addFinding(
      findings,
      `Git ${safeLabel(operation)} verification failed.`,
      "verify-worktree and the current implementation branch",
    );
    return makeDeny(findings);
  }

  if (!isNonEmptyString(branch)) {
    addFinding(
      findings,
      "The Draft PR worktree is detached or has no current branch.",
      "check out the verified feature branch",
    );
  }
  if (!isSha(headSha)) {
    addFinding(
      findings,
      "The current Git HEAD is missing or malformed.",
      "create and verify a commit before Draft PR creation",
    );
  }

  const gate = readGate(repositoryRoot, findings);
  if (gate !== null) {
    validateGate(gate, findings);
    compareGateIdentities(gate, repositoryRoot, branch, headSha, commandValues, findings);
    validateDescription(gate.pull_request_draft, commandValues, bodyText, findings);
    verifyRemoteBranch(repositoryRoot, gate.branch_push, branch, headSha, findings);
  }

  return findings.length > 0 ? makeDeny(findings) : makeAllow();
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
        requirement: `The deterministic pre-pr-create check failed closed with ${errorType}.`,
        nextStep: "verify-worktree and write a fresh PrePrCreateGate",
      },
    ]);
  }

  writeResponse(input, result);
  if (result.decision === "deny") {
    process.exitCode = 2;
  }
}

main();
