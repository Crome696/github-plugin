import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULT_CHILD_TIMEOUT_MS = 5_000;
export const PRE_HOOK_BUDGET_MS = 25_000;
export const POST_HOOK_BUDGET_MS = 40_000;
export const DEFAULT_COMMAND_MAX_BUFFER = 16 * 1024 * 1024;

const WORKER_PATH = fileURLToPath(new URL("./run-command-worker.mjs", import.meta.url));
const WORKER_OVERHEAD_MS = 1_500;

const phaseBudget = () =>
  process.env.CROMESDK_HOOK_PHASE === "post"
    ? POST_HOOK_BUDGET_MS
    : PRE_HOOK_BUDGET_MS;

const LOCAL_DEADLINE_AT = Date.now() + phaseBudget();

const deadlineAt = () => {
  const configured = Number(process.env.CROMESDK_HOOK_DEADLINE_AT);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return LOCAL_DEADLINE_AT;
};

const textValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
};

const classifyFailure = (stdout, stderr, errorType, status) => {
  if (errorType === "timeout") return "timeout";
  if (errorType === "output_overflow") return "output_overflow";
  if (errorType === "worker_failure" || errorType === "spawn_failure") return "spawn_failure";
  const text = `${stdout} ${stderr}`.toLowerCase();
  if (
    /\b(401|403)\b/.test(text) ||
    text.includes("authentication") ||
    text.includes("bad credentials") ||
    text.includes("not logged in") ||
    text.includes("login required")
  ) {
    return "authentication_failure";
  }
  if (
    text.includes("network") ||
    text.includes("timed out") ||
    text.includes("timeout") ||
    text.includes("could not resolve host") ||
    text.includes("connection refused") ||
    text.includes("connection reset")
  ) {
    return "network_failure";
  }
  return status === 0 ? "malformed_output" : "command_failure";
};

export class BoundedCommandError extends Error {
  constructor({ executable, args, operation, kind, status, signal, stdout, stderr, cause }) {
    super(`Bounded ${executable} command failed: ${operation ?? args[0] ?? executable} (${kind}).`);
    this.name = "BoundedCommandError";
    this.executable = executable;
    this.args = args;
    this.operation = operation ?? args[0] ?? executable;
    this.kind = kind;
    this.status = status;
    this.signal = signal;
    this.stdout = stdout;
    this.stderr = stderr;
    this.cause = cause;
  }
}

const decodeBase64 = (value) => {
  try {
    return Buffer.from(typeof value === "string" ? value : "", "base64");
  } catch {
    return Buffer.alloc(0);
  }
};

const runWorker = (request, workerTimeoutMs) => {
  const encoded = Buffer.from(JSON.stringify(request), "utf8").toString("base64url");
  try {
    return execFileSync(process.execPath, [WORKER_PATH, encoded], {
      cwd: request.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: Math.max(request.maxBuffer * 2, 2 * 1024 * 1024),
      timeout: workerTimeoutMs,
      windowsHide: true,
      killSignal: "SIGTERM",
    });
  } catch (error) {
    const stdout = textValue(error?.stdout);
    const stderr = textValue(error?.stderr);
    throw new BoundedCommandError({
      executable: request.executable,
      args: request.args,
      operation: request.operation,
      kind: error?.code === "ETIMEDOUT" || error?.killed ? "timeout" : "spawn_failure",
      status: Number.isInteger(error?.status) ? error.status : null,
      signal: error?.signal ?? null,
      stdout,
      stderr,
      cause: error,
    });
  }
};

export const runCommand = (
  executable,
  args,
  {
    cwd = process.cwd(),
    encoding = "utf8",
    maxBuffer = DEFAULT_COMMAND_MAX_BUFFER,
    operation = args?.[0] ?? executable,
  } = {},
) => {
  const normalizedArgs = Array.isArray(args) ? args.map(String) : [];
  const deadline = deadlineAt();
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new BoundedCommandError({
      executable,
      args: normalizedArgs,
      operation,
      kind: "deadline_exceeded",
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
    });
  }

  const timeoutMs = Math.min(DEFAULT_CHILD_TIMEOUT_MS, remaining);
  const workerTimeoutMs = Math.max(1, timeoutMs);
  let raw;
  try {
    raw = runWorker(
      {
        executable,
        args: normalizedArgs,
        cwd,
        maxBuffer,
        timeoutMs,
        operation,
      },
      Math.min(remaining + WORKER_OVERHEAD_MS, DEFAULT_CHILD_TIMEOUT_MS + WORKER_OVERHEAD_MS),
    );
  } catch (error) {
    if (error instanceof BoundedCommandError) throw error;
    throw new BoundedCommandError({
      executable,
      args: normalizedArgs,
      operation,
      kind: "spawn_failure",
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      cause: error,
    });
  }

  let result;
  try {
    result = JSON.parse(raw);
  } catch (error) {
    throw new BoundedCommandError({
      executable,
      args: normalizedArgs,
      operation,
      kind: "malformed_output",
      status: null,
      signal: null,
      stdout: raw,
      stderr: "",
      cause: error,
    });
  }

  const stdoutBuffer = decodeBase64(result.stdout);
  const stderrBuffer = decodeBase64(result.stderr);
  const stdout = encoding === null ? stdoutBuffer : stdoutBuffer.toString(encoding);
  const stderr = stderrBuffer.toString("utf8");
  if (result.ok !== true) {
    throw new BoundedCommandError({
      executable,
      args: normalizedArgs,
      operation,
      kind: result.errorType === "timeout"
        ? "timeout"
        : result.errorType === "output_overflow"
          ? "output_overflow"
          : classifyFailure(stdoutBuffer.toString("utf8"), stderr, result.errorType, result.status),
      status: Number.isInteger(result.status) ? result.status : null,
      signal: result.signal ?? null,
      stdout,
      stderr,
      cause: result.error ?? null,
    });
  }

  return stdout;
};

export const runCommandResult = (executable, args, options = {}) => {
  try {
    return {
      ok: true,
      stdout: runCommand(executable, args, options),
      stderr: "",
      status: 0,
      operation: options.operation ?? args?.[0] ?? executable,
      errorType: null,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? "",
      status: Number.isInteger(error?.status) ? error.status : null,
      signal: error?.signal ?? null,
      operation: options.operation ?? args?.[0] ?? executable,
      errorType: error?.kind ?? "spawn_failure",
    };
  }
};
