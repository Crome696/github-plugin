import { appendFileSync, readFileSync } from "node:fs";

const configPath = process.env.CROMESDK_RUNTIME_FAKE_CONFIG;
const logPath = process.env.CROMESDK_RUNTIME_FAKE_LOG;
const executable = process.argv[2] ?? "unknown";
const args = process.argv.slice(3);

const writeLog = (entry) => {
  if (typeof logPath === "string" && logPath.length > 0) {
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  }
};

const wait = (delayMs) => {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, delayMs);
};

const loadConfig = () => {
  if (typeof configPath !== "string" || configPath.length === 0) {
    return { rules: [], defaultDelayMs: 0 };
  }
  try {
    const value = JSON.parse(readFileSync(configPath, "utf8"));
    return value && typeof value === "object" ? value : { rules: [] };
  } catch (error) {
    return {
      rules: [],
      configurationError: error instanceof Error ? error.message : "invalid config",
    };
  }
};

const config = loadConfig();
const rules = Array.isArray(config.rules) ? config.rules : [];

const exactMatch = (rule) =>
  rule?.executable === executable &&
  Array.isArray(rule.args) &&
  rule.args.length === args.length &&
  rule.args.every((value, index) => value === args[index]);

const graphqlMatch = (rule) => {
  if (
    rule?.executable !== executable ||
    rule?.match !== "graphql" ||
    typeof rule.queryIncludes !== "string"
  ) {
    return false;
  }
  return (
    args[0] === "api" &&
    args[1] === "graphql" &&
    args.some(
      (value) =>
        typeof value === "string" &&
        value.startsWith("query=") &&
        value.includes(rule.queryIncludes),
    )
  );
};

const rule = rules.find((candidate) => exactMatch(candidate) || graphqlMatch(candidate));
const delayMs = Number.isFinite(rule?.delayMs)
  ? rule.delayMs
  : Number.isFinite(config.defaultDelayMs)
    ? config.defaultDelayMs
    : 0;

if (!rule) {
  const stderr = `Unexpected fake command: ${executable} ${args.join(" ")}`;
  const entry = {
    executable,
    args,
    cwd: process.cwd(),
    stdout: "",
    stderr,
    exitCode: 127,
    delayMs,
    matched: false,
  };
  writeLog(entry);
  process.stderr.write(`${stderr}\n`);
  process.exitCode = 127;
} else {
  const stdout = typeof rule.stdout === "string" ? rule.stdout : "";
  const stderr = typeof rule.stderr === "string" ? rule.stderr : "";
  const exitCode = Number.isInteger(rule.exitCode) ? rule.exitCode : 0;
  wait(delayMs);
  writeLog({
    executable,
    args,
    cwd: process.cwd(),
    stdout,
    stderr,
    exitCode,
    delayMs,
    matched: true,
  });
  if (stdout.length > 0) process.stdout.write(stdout);
  if (stderr.length > 0) process.stderr.write(stderr);
  process.exitCode = exitCode;
}
