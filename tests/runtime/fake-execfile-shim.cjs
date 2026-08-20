const childProcess = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");

const originalExecFileSync = childProcess.execFileSync;
const runnerPath = process.env.CROMESDK_RUNTIME_FAKE_RUNNER;
const timeoutMs = Number(process.env.CROMESDK_RUNTIME_FAKE_TIMEOUT_MS ?? 5000);

const asOutput = (stdout, encoding) => {
  const buffer = Buffer.from(stdout ?? "", "utf8");
  return encoding && encoding !== "buffer" ? buffer.toString(encoding) : buffer;
};

childProcess.execFileSync = (file, args = [], options = {}) => {
  if (
    (file !== "git" && file !== "gh") ||
    typeof runnerPath !== "string" ||
    runnerPath.length === 0
  ) {
    return originalExecFileSync(file, args, options);
  }

  const result = childProcess.spawnSync(
    process.execPath,
    [runnerPath, file, ...args],
    {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
    },
  );
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error || result.status !== 0) {
    if (result.error?.code === "ETIMEDOUT" && process.platform === "win32" && result.pid) {
      childProcess.spawnSync("taskkill", ["/PID", String(result.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    }
    const error = new Error(
      `Fake ${file} command failed with exit ${result.status ?? "unknown"}.`,
    );
    error.name = "FakeCommandError";
    error.status = result.status ?? 1;
    error.code = result.error?.code ?? (result.error ? "ETIMEDOUT" : "FAKE_COMMAND_FAILED");
    error.timedOut = result.error?.code === "ETIMEDOUT";
    error.overflow = false;
    error.stdout = asOutput(stdout, options.encoding);
    error.stderr = asOutput(stderr, options.encoding);
    throw error;
  }
  const maxBuffer = Number(options.maxBuffer);
  if (Number.isFinite(maxBuffer) && (Buffer.byteLength(stdout, "utf8") > maxBuffer || Buffer.byteLength(stderr, "utf8") > maxBuffer)) {
    const error = new Error(`Fake ${file} command exceeded maxBuffer.`);
    error.name = "FakeCommandOutputOverflow";
    error.status = null;
    error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    error.overflow = true;
    error.stdout = asOutput(stdout.slice(0, maxBuffer + 1), options.encoding);
    error.stderr = asOutput(stderr.slice(0, maxBuffer + 1), options.encoding);
    throw error;
  }
  return asOutput(stdout, options.encoding);
};

syncBuiltinESMExports();
