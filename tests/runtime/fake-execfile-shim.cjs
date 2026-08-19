const childProcess = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");

const originalExecFileSync = childProcess.execFileSync;
const runnerPath = process.env.CROMESDK_RUNTIME_FAKE_RUNNER;
const timeoutMs = Number(process.env.CROMESDK_RUNTIME_FAKE_TIMEOUT_MS ?? 500);

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
    const error = new Error(
      `Fake ${file} command failed with exit ${result.status ?? "unknown"}.`,
    );
    error.name = "FakeCommandError";
    error.status = result.status ?? 1;
    error.stdout = asOutput(stdout, options.encoding);
    error.stderr = asOutput(stderr, options.encoding);
    throw error;
  }
  return asOutput(stdout, options.encoding);
};

syncBuiltinESMExports();
