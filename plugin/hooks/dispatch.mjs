import { spawn, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  POST_HOOK_BUDGET_MS,
  PRE_HOOK_BUDGET_MS,
} from "./lib/run-command.mjs";
import { readHookInput } from "./lib/read-hook-input.mjs";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_CHECKER_OUTPUT_BYTES = 2 * 1024 * 1024;
const CHECKER_FILES = new Set([
  "pre-commit.mjs",
  "pre-rebase.mjs",
  "pre-pr-create.mjs",
  "pre-review-submit.mjs",
  "pre-pr-ready.mjs",
  "pre-merge.mjs",
  "post-merge.mjs",
]);
let activeInput;
const PRE_CHECKERS = new Map([
  ["commit", "pre-commit.mjs"],
  ["rebase", "pre-rebase.mjs"],
  ["pr-create", "pre-pr-create.mjs"],
  ["review", "pre-review-submit.mjs"],
  ["ready", "pre-pr-ready.mjs"],
  ["merge", "pre-merge.mjs"],
]);

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const isCodexInput = (input) =>
  input?.hook_event_name === "PreToolUse" ||
  input?.hook_event_name === "PostToolUse" ||
  typeof input?.tool_name === "string" ||
  isRecord(input?.tool_input);

const isPostInput = (input) =>
  input?.hook_event_name === "PostToolUse" ||
  input?.hook_event_name === "afterShellExecution";

const commandFromInput = (input) => {
  if (!isRecord(input)) return null;
  if (typeof input.command === "string") return input.command;
  if (isRecord(input.tool_input) && typeof input.tool_input.command === "string") {
    return input.tool_input.command;
  }
  return null;
};

const cwdFromInput = (input) => {
  if (!isRecord(input)) return process.cwd();
  if (typeof input.cwd === "string" && input.cwd.trim().length > 0) return input.cwd;
  if (isRecord(input.tool_input) && typeof input.tool_input.cwd === "string" && input.tool_input.cwd.trim().length > 0) {
    return input.tool_input.cwd;
  }
  return process.cwd();
};

const executableName = (value) => {
  const normalized = String(value ?? "").replaceAll("\\", "/").split("/").at(-1) ?? "";
  return normalized.replace(/\.(?:exe|cmd|bat)$/i, "").toLowerCase();
};

const tokenize = (command) => {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;
  let started = false;
  const push = () => {
    if (started || current.length > 0) tokens.push(current);
    current = "";
    started = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    const next = command[index + 1];
    if (quote === "'") {
      started = true;
      if (character === "'") quote = null;
      else current += character;
      continue;
    }
    if (quote === '"') {
      started = true;
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
      started = true;
      current += character;
      escaped = false;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (character === "\\" && (next === '"' || next === "'" || next === "\\")) {
      escaped = true;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      push();
      continue;
    }
    if (character === "&" && next === "&") {
      push();
      tokens.push("&&");
      index += 1;
      continue;
    }
    if (character === "|" && next === "|") {
      push();
      tokens.push("||");
      index += 1;
      continue;
    }
    if ([";", "|", "&", "(", ")", ">", "<"].includes(character)) {
      push();
      tokens.push(character);
      continue;
    }
    current += character;
    started = true;
  }
  if (quote !== null || escaped) return null;
  push();
  return tokens;
};

const splitSegments = (tokens) => {
  const separators = new Set([";", "&&", "||", "|", "&", "(", ")", ">", "<"]);
  const segments = [];
  let segment = [];
  for (const token of tokens) {
    if (separators.has(token)) {
      if (segment.length > 0) segments.push(segment);
      segment = [];
    } else {
      segment.push(token);
    }
  }
  if (segment.length > 0) segments.push(segment);
  return segments;
};

const unwrap = (segment) => {
  const wrappers = new Set(["sudo", "env", "command", "exec", "nohup", "nice", "setsid"]);
  let index = 0;
  while (index < segment.length) {
    const token = String(segment[index]).toLowerCase();
    if (token === "env") {
      index += 1;
      while (index < segment.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[index])) index += 1;
      continue;
    }
    if (wrappers.has(token)) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
};

const identifySegment = (segment) => {
  const start = unwrap(segment);
  const executable = executableName(segment[start]);
  const args = segment.slice(start + 1);
  if (executable === "git") {
    const operationIndex = args.findIndex((token) => ["commit", "rebase"].includes(String(token).toLowerCase()));
    if (operationIndex !== -1) {
      return String(args[operationIndex]).toLowerCase() === "commit" ? "commit" : "rebase";
    }
    return null;
  }
  if (executable !== "gh") return null;
  const normalized = args.map((value) => String(value).toLowerCase());
  if (normalized[0] === "pr" && ["create", "review", "ready", "merge"].includes(normalized[1])) {
    return normalized[1] === "create"
      ? "pr-create"
      : normalized[1] === "review"
        ? "review"
        : normalized[1];
  }
  if (normalized[0] !== "api") return null;
  const apiValue = normalized.join(" ");
  if (/\/pulls\/[1-9]\d*\/reviews(?:\s|$)/.test(apiValue)) return "review";
  if (/\/pulls\/[1-9]\d*\/requested_reviewers(?:\s|$)/.test(apiValue)) return "ready";
  if (/\/pulls\/[1-9]\d*\/merge(?:\s|$)/.test(apiValue)) return "merge";
  return null;
};

const likelyOperation = (command) => {
  const checks = [
    ["commit", /(?:^|[;&|]\s*)(?:(?:sudo|env|command|exec|nohup)\s+)*git(?:\.exe|\.cmd|\.bat)?\b[\s\S]*\bcommit\b/i],
    ["rebase", /(?:^|[;&|]\s*)(?:(?:sudo|env|command|exec|nohup)\s+)*git(?:\.exe|\.cmd|\.bat)?\b[\s\S]*\brebase\b/i],
    ["pr-create", /(?:^|[;&|]\s*)(?:(?:sudo|env|command|exec|nohup)\s+)*gh(?:\.exe|\.cmd|\.bat)?\s+pr\s+create\b/i],
    ["review", /(?:^|[;&|]\s*)(?:(?:sudo|env|command|exec|nohup)\s+)*gh(?:\.exe|\.cmd|\.bat)?\s+(?:pr\s+review\b|api\b[\s\S]*\/pulls\/[1-9]\d*\/reviews\b)/i],
    ["ready", /(?:^|[;&|]\s*)(?:(?:sudo|env|command|exec|nohup)\s+)*gh(?:\.exe|\.cmd|\.bat)?\s+(?:pr\s+ready\b|api\b[\s\S]*\/pulls\/[1-9]\d*\/requested_reviewers\b)/i],
    ["merge", /(?:^|[;&|]\s*)(?:(?:sudo|env|command|exec|nohup)\s+)*gh(?:\.exe|\.cmd|\.bat)?\s+(?:pr\s+merge\b|api\b[\s\S]*\/pulls\/[1-9]\d*\/merge\b)/i],
  ];
  return checks.filter(([, pattern]) => pattern.test(command)).map(([operation]) => operation);
};

export const classifyCommand = (command) => {
  if (typeof command !== "string") return { kind: "irrelevant", operation: null, reason: null };
  const tokens = tokenize(command);
  if (tokens === null) {
    const likely = likelyOperation(command);
    return likely.length === 1
      ? { kind: "protected", operation: likely[0], malformed: true, reason: null }
      : likely.length > 1
        ? { kind: "ambiguous", operation: null, reason: "The command contains multiple protected operations or cannot be parsed safely." }
        : { kind: "irrelevant", operation: null, reason: null };
  }
  const operations = splitSegments(tokens).map(identifySegment).filter(Boolean);
  const uniqueOperations = [...new Set(operations)];
  if (uniqueOperations.length > 1 || operations.length > 1) {
    return { kind: "ambiguous", operation: null, reason: "The command contains more than one protected operation." };
  }
  if (uniqueOperations.length === 1) return { kind: "protected", operation: uniqueOperations[0], malformed: false, reason: null };
  return { kind: "irrelevant", operation: null, reason: null };
};

const nativePreResponse = (input, decision, reason) => {
  if (isCodexInput(input)) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        ...(decision === "deny" ? { permissionDecisionReason: reason } : {}),
      },
    };
  }
  return decision === "deny"
    ? { permission: "deny", user_message: reason, agent_message: reason }
    : { permission: "allow" };
};

const postFailureResponse = (input, reason) => {
  const status = {
    schema: "PostMergeStatus",
    version: 1,
    status: "partial",
    repository: null,
    pull_request: {
      number: null,
      url: null,
      state: "unknown",
      base_branch: null,
      head_branch: null,
    },
    merge: {
      observed: false,
      merged_at: null,
      merge_commit_sha: null,
      target_branch: null,
      target_contains_merge_commit: "unavailable",
      evidence: ["The post-merge checker did not complete."],
    },
    issue_closure: {
      expected: null,
      observed: "unknown",
      attribution: "unavailable",
      issue: null,
      relationship_evidence: {
        status: "unavailable",
        keyword_evidence: [],
        github_evidence: [],
      },
      evidence: ["Issue-relationship evidence is unavailable."],
    },
    cleanup: {
      available_actions: [],
      performed_by_hook: [],
      approval_required: true,
      evidence: ["Cleanup availability was not inspected."],
    },
    deviations: [{
      id: "post-dispatch-failure",
      description: reason,
      impact: "The merge result remains partially observed and no cleanup action is authorized.",
      evidence: ["The dispatcher preserved a read-only failure status."],
    }],
    open_actions: [],
    evidence: {
      status: "unavailable",
      sources: [{
        name: "post-merge-checker",
        status: "unavailable",
        evidence: [reason],
      }],
    },
    rationale: "Post-merge verification stopped without performing any mutation.",
    checked_at: new Date().toISOString(),
    failure: { code: "api_failure", description: reason },
  };
  const serialized = JSON.stringify(status);
  return isCodexInput(input)
    ? { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: serialized } }
    : { additional_context: serialized };
};

const writeJson = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

const denyReason = (message) =>
  `Protected hook operation blocked by deterministic dispatch: ${message} The hook made no Git or GitHub write.`;

const recordDispatch = (checker, operation, decision) => {
  const path = process.env.CROMESDK_HOOK_DISPATCH_LOG;
  if (typeof path !== "string" || path.length === 0) return;
  try {
    appendFileSync(path, `${JSON.stringify({ checker, operation, decision })}\n`, "utf8");
  } catch {
    // Test-only instrumentation must never affect a host hook decision.
  }
};

const terminateCheckerTree = (child) => {
  if (!Number.isInteger(child?.pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  try { child.kill("SIGTERM"); } catch {}
};

const runChecker = (checkerPath, inputText, cwd, budget, phase) => new Promise((resolve) => {
  const deadlineAt = Date.now() + budget;
  const child = spawn(process.execPath, [checkerPath], {
    cwd,
    env: {
      ...process.env,
      CROMESDK_HOOK_PHASE: phase,
      CROMESDK_HOOK_DEADLINE_AT: String(deadlineAt),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let overflow = false;
  let timedOut = false;
  let settled = false;
  let timer;
  const append = (target, chunk, stream) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const currentBytes = stream === "stdout" ? stdoutBytes : stderrBytes;
    if (currentBytes + buffer.byteLength > MAX_CHECKER_OUTPUT_BYTES) {
      overflow = true;
      terminateCheckerTree(child);
      return;
    }
    target.push(buffer);
    if (stream === "stdout") stdoutBytes += buffer.byteLength;
    else stderrBytes += buffer.byteLength;
  };
  child.stdout.on("data", (chunk) => append(stdout, chunk, "stdout"));
  child.stderr.on("data", (chunk) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    append(stderr, buffer, "stderr");
  });
  const finish = (status, signal, error = null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve({
      status,
      signal,
      error,
      timedOut,
      overflow,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    });
  };
  timer = setTimeout(() => {
    timedOut = true;
    terminateCheckerTree(child);
  }, budget);
  child.once("error", (error) => finish(null, null, error));
  child.once("close", (status, signal) => finish(status, signal));
  child.stdin.end(inputText);
});

const main = async () => {
  let input;
  try {
    input = readHookInput(0, MAX_INPUT_BYTES);
    activeInput = input;
  } catch {
    const reason = denyReason("Hook input is missing, too large, or invalid JSON.");
    writeJson(nativePreResponse({}, "deny", reason));
    process.exitCode = 2;
    return;
  }

  const command = commandFromInput(input);
  const classification = classifyCommand(command);
  const post = isPostInput(input);
  if (!post && command === null) {
    const reason = denyReason("Hook input does not contain a shell command.");
    writeJson(nativePreResponse(input, "deny", reason));
    process.exitCode = 2;
    return;
  }
  if (post && (classification.kind !== "protected" || classification.operation !== "merge")) {
    recordDispatch(null, classification.operation, "irrelevant");
    writeJson({});
    process.exitCode = 0;
    return;
  }
  if (!post && classification.kind === "irrelevant") {
    recordDispatch(null, null, "allow");
    writeJson(nativePreResponse(input, "allow", null));
    process.exitCode = 0;
    return;
  }
  if (classification.kind === "ambiguous") {
    recordDispatch(null, null, "deny");
    const reason = denyReason(classification.reason ?? "The command is ambiguous.");
    writeJson(post ? {} : nativePreResponse(input, "deny", reason));
    process.exitCode = post ? 0 : 2;
    return;
  }

  const checkerName = post ? "post-merge.mjs" : PRE_CHECKERS.get(classification.operation);
  if (!checkerName || !CHECKER_FILES.has(checkerName)) {
    recordDispatch(null, classification.operation, "deny");
    const reason = denyReason("The protected operation has no safe checker route.");
    writeJson(post ? {} : nativePreResponse(input, "deny", reason));
    process.exitCode = post ? 0 : 2;
    return;
  }

  const checkerPath = fileURLToPath(new URL(`./${checkerName}`, import.meta.url));
  recordDispatch(checkerName, classification.operation, "route");
  const phase = post ? "post" : "pre";
  const budget = post ? POST_HOOK_BUDGET_MS : PRE_HOOK_BUDGET_MS;
  const result = await runChecker(
    checkerPath,
    `${JSON.stringify(input)}\n`,
    cwdFromInput(input),
    budget,
    phase,
  );
  if (result.timedOut || result.overflow || result.error || result.status === null || result.signal !== null || result.stdout.trim().length === 0) {
    const reason = denyReason(
      result.timedOut
        ? `The ${phase} checker exceeded its ${budget / 1000}-second total budget.`
        : result.overflow
          ? "The checker response exceeded the bounded output limit."
          : "The selected checker failed before emitting a native response envelope.",
    );
    if (post) {
      writeJson(postFailureResponse(input, reason));
      process.exitCode = 0;
    } else {
      writeJson(nativePreResponse(input, "deny", reason));
      process.exitCode = 2;
    }
    return;
  }
  process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  process.stderr.write(result.stderr);
  process.exitCode = Number.isInteger(result.status) ? result.status : (post ? 0 : 2);
};

main().catch((error) => {
  const reason = denyReason(`The dispatcher failed closed with ${error?.name ?? "unknown-error"}.`);
  if (isPostInput(activeInput)) {
    writeJson(postFailureResponse(activeInput, reason));
    process.exitCode = 0;
  } else {
    writeJson(nativePreResponse({}, "deny", reason));
    process.exitCode = 2;
  }
});
