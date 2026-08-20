import { execFileSync, spawn, spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

const asBuffer = (value) => Buffer.isBuffer(value) ? value : Buffer.from(value ?? "");

const terminateProcessTree = (child) => {
  if (!Number.isInteger(child?.pid)) return;

  if (isWindows) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // The process may already have exited. Reaping below remains authoritative.
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // The process may already have exited.
  }
};

const decodeRequest = () => {
  const encoded = process.argv[2];
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new Error("Missing bounded command request.");
  }
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
};

const emitResult = (result) => {
  process.stdout.write(JSON.stringify(result));
};

const run = async () => {
  const request = decodeRequest();
  const executable = request?.executable;
  const args = request?.args;
  const cwd = request?.cwd;
  const timeoutMs = Number(request?.timeoutMs);
  const maxBuffer = Number(request?.maxBuffer);

  if (
    typeof executable !== "string" ||
    !Array.isArray(args) ||
    typeof cwd !== "string" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(maxBuffer) ||
    maxBuffer <= 0
  ) {
    throw new Error("Malformed bounded command request.");
  }

  if (typeof process.env.CROMESDK_RUNTIME_FAKE_RUNNER === "string") {
    try {
      const stdout = asBuffer(execFileSync(executable, args, {
        cwd,
        encoding: null,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer,
        timeout: timeoutMs,
        windowsHide: true,
        killSignal: "SIGTERM",
      }));
      emitResult({
        ok: true,
        errorType: null,
        error: null,
        status: 0,
        signal: null,
        stdout: stdout.toString("base64"),
        stderr: "",
        stdoutBytes: stdout.byteLength,
        stderrBytes: 0,
      });
      return;
    } catch (error) {
      const stdout = asBuffer(error?.stdout);
      const stderr = asBuffer(error?.stderr);
      emitResult({
        ok: false,
        errorType: error?.timedOut || error?.code === "ETIMEDOUT"
          ? "timeout"
          : error?.overflow || error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
            ? "output_overflow"
            : "command_failure",
        error: error instanceof Error ? error.message : String(error),
        status: Number.isInteger(error?.status) ? error.status : null,
        signal: error?.signal ?? null,
        stdout: stdout.toString("base64"),
        stderr: stderr.toString("base64"),
        stdoutBytes: stdout.byteLength,
        stderrBytes: stderr.byteLength,
      });
      return;
    }
  }

  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let overflow = null;
  let timedOut = false;
  let settled = false;
  let timer;

  const child = spawn(executable, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: !isWindows,
  });

  const append = (target, chunk, currentBytes, stream) => {
    const bytes = asBuffer(chunk);
    const nextBytes = currentBytes + bytes.byteLength;
    if (nextBytes > maxBuffer) {
      overflow = stream;
      terminateProcessTree(child);
      return nextBytes;
    }
    target.push(bytes);
    return nextBytes;
  };

  child.stdout.on("data", (chunk) => {
    stdoutBytes = append(stdout, chunk, stdoutBytes, "stdout");
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes = append(stderr, chunk, stderrBytes, "stderr");
  });

  const result = await new Promise((resolve) => {
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);

    child.once("error", (error) => {
      finish({ error: error instanceof Error ? error.message : String(error) });
    });
    child.once("close", (status, signal) => {
      finish({ status, signal });
    });
  });

  const errorType = overflow
    ? "output_overflow"
    : timedOut
      ? "timeout"
      : result.error
        ? "spawn_failure"
        : result.status === 0
          ? null
          : "command_failure";

  emitResult({
      ok: errorType === null,
      errorType,
      error: result.error ?? null,
      status: Number.isInteger(result.status) ? result.status : null,
      signal: result.signal ?? null,
      stdout: Buffer.concat(stdout).toString("base64"),
      stderr: Buffer.concat(stderr).toString("base64"),
      stdoutBytes,
      stderrBytes,
    });
};

run().catch((error) => {
  emitResult({
      ok: false,
      errorType: "worker_failure",
      error: error instanceof Error ? error.message : String(error),
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      stdoutBytes: 0,
      stderrBytes: 0,
    });
  process.exitCode = 1;
});
